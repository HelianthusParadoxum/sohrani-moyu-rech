import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { viewFor } from '../src/engine/view';
import { RuleError, coversStep } from '../src/engine/util';
import { passionPoints } from '../src/engine/scoring';
import type { GameState } from '../src/engine/types';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}` }));

function seeded(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function allCards(s: GameState): string[] {
  return [
    ...s.deck, ...s.discard, ...s.loadDeck, ...s.loadDiscard, ...s.tolkuchka, ...s.knigoobmen, ...s.raspredelitel,
    ...s.razval.filter((c): c is string => !!c), ...s.baraholka.filter((c): c is string => !!c),
    ...s.pending.flatMap((p) => (p.kind === 'posrednichestvoKeep' ? p.cards : [])),
    ...s.players.flatMap((p) => [...p.warehouse.map((w) => w.card), ...p.published, ...p.spetskhran]),
  ];
}

describe('подготовка', () => {
  it('раздаёт стартовые ресурсы', () => {
    const s = createGame({ players: players(3), seed: 1 });
    expect(s.players).toHaveLength(3);
    for (const p of s.players) {
      expect(p.warehouse).toHaveLength(4);
      expect(p.talons).toBe(5);
      expect(p.passionOptions).toHaveLength(2);
    }
    expect(s.sprouts).toHaveLength(4);
    expect(s.razval.every(Boolean)).toBe(true);
    expect(new Set(allCards(s)).size).toBe(131);
  });

  it('скрывает чужие Пристрастия и колоды', () => {
    const s = createGame({ players: players(2), seed: 2 });
    const v = viewFor(s, 'p1');
    const other = v.players.find((p) => p.id === 'p2')!;
    expect(other.passionOptions).toEqual([]);
    expect((v as any).deck).toBeUndefined();
  });

  it('не даёт ходить вне очереди', () => {
    let s = createGame({ players: players(2), seed: 3 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    expect(s.phase).toBe('orders');
    const notActive = s.order[1];
    expect(() => applyAction(s, notActive, { type: 'place', place: { address: 'zavoz' } })).toThrow(RuleError);
  });
});

describe('партия ботами', () => {
  for (const n of [2, 3, 4]) {
    it(`${n} игрока доигрывают до конца, карты не теряются`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const s = playOut(createGame({ players: players(n), seed }), seeded(seed));
        expect(s.phase).toBe('end');
        expect(s.result).toBeDefined();
        expect(s.round).toBe(5);
        const cards = allCards(s);
        expect(cards.length).toBe(131);
        expect(new Set(cards).size).toBe(131);
      }
    });
  }
});

describe('правила редакции октября', () => {
  function started(seed = 5) {
    let s = createGame({ players: players(2), seed });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    return s;
  }

  it('Толкучка: покупка — 2 Талона за книгу независимо от значков', () => {
    const s = started();
    const me = s.order[s.turn];
    const card = s.tolkuchka[0];
    const before = s.players.find((p) => p.id === me)!.talons;
    const next = applyAction(s, me, { type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'buy', card }] } });
    expect(next.players.find((p) => p.id === me)!.talons).toBe(before - 2);
  });

  it('пасовать можно только после Красного уголка, и пас — до конца Пятилетки', () => {
    let s = started();
    const me = s.order[s.turn];
    expect(() => applyAction(s, me, { type: 'pass' })).toThrow(RuleError);
    s = applyAction(s, me, { type: 'place', place: { address: 'redCorner', recycle: [] } });
    while (s.order[s.turn] !== me) {
      const other = s.order[s.turn];
      s = applyAction(s, other, { type: 'place', place: { address: 'zavoz' } });
    }
    s = applyAction(s, me, { type: 'pass' });
    const p = s.players.find((x) => x.id === me)!;
    expect(p.available).toBe(0);
    expect(s.order[s.turn]).not.toBe(me);
  });
});

describe('значок возвращения у двужанровой книги', () => {
  // «Восток — Запад»: Драматургия + Ирония.
  const dual = Object.values(createGame({ players: players(2), seed: 1 }).cards).find((c) => c.title === 'Восток — Запад')!;

  function withBook(passion: 'keeper_skit' | 'monogamist' | 'erudite') {
    const s = createGame({ players: players(2), seed: 9 });
    const p = s.players[0];
    p.warehouse = [{ card: dual.id, hidden: false }];
    p.passion = passion;
    s.restored[dual.id] = true;
    return { s, p };
  }

  it('считается одним значком в Пристрастии', () => {
    const { s, p } = withBook('keeper_skit');
    // ДР + ИР + 1 значок возвращения = 3 значка × 2 очка.
    expect(passionPoints(s, p)).toBe(6);
  });

  it('Однолюб выбирает жанр значка в свою пользу', () => {
    const { s, p } = withBook('monogamist');
    expect(passionPoints(s, p)).toBe(4);
  });

  it('закрывает ступень Ростка значком любого из двух жанров', () => {
    const { s } = withBook('erudite');
    expect(coversStep(s, [dual.id], 'drama', 2)).toBe(true);
    expect(coversStep(s, [dual.id], 'irony', 2)).toBe(true);
    expect(coversStep(s, [dual.id], 'drama', 3)).toBe(false);
  });
});

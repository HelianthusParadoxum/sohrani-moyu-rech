import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { viewFor } from '../src/engine/view';
import { RuleError, cacheLimit, coversStep } from '../src/engine/util';
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

describe('Нагрузка прикрывает', () => {
  it('каждые 2 Нагрузки на складе дают +1 место в Тайнике, даже сверх 5 и даже если Нагрузка спрятана', () => {
    const s = createGame({ players: players(2), seed: 4 });
    const loads = Object.values(s.cards).filter((c) => c.kind === 'load').slice(0, 4).map((c) => c.id);
    const p = s.players[0];
    p.cache = 5;
    p.capacity = 10;
    p.warehouse = loads.map((card, i) => ({ card, hidden: i === 0 }));
    expect(cacheLimit(s, p)).toBe(7);
  });
});

describe('полный режим', () => {
  for (const n of [2, 3, 4]) {
    it(`${n} игрока доигрывают полную партию ботами, карты не теряются`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const s = playOut(createGame({ players: players(n), seed, mode: 'full' }), seeded(seed));
        expect(s.phase).toBe('end');
        const cards = allCards(s);
        expect(new Set(cards).size).toBe(cards.length);
        expect(cards.length).toBe(131);
      }
    });
  }

  function fullGame(seed = 3) {
    let s = createGame({ players: players(2), seed, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    return s;
  }

  it('в Клубе 8 Завсегдатаев на 8 жанров, связь — за книгу жанра слота', () => {
    let s = fullGame();
    expect(s.patrons).toHaveLength(8);
    expect(new Set(s.patrons.map((x) => x.genre)).size).toBe(8);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    const book = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 1 && c.icons[0] !== 'album')!;
    p.warehouse.push({ card: book.id, hidden: false });
    s.deck = s.deck.filter((c) => c !== book.id);
    const patron = s.patrons.find((x) => x.genre === book.icons[0])!;
    s = applyAction(s, me, { type: 'place', place: { address: 'club', gifts: [{ patron: patron.id, card: book.id }] } });
    expect(s.patrons.find((x) => x.id === patron.id)!.connections).toContain(me);
  });

  it('Контора: сначала предупреждение остальным, потом решение; Сигнал удерживает Единомышленника', () => {
    let s = fullGame(11);
    const me = s.order[s.turn];
    const other = s.order.find((x) => x !== me)!;
    s = applyAction(s, me, { type: 'place', place: { address: 'kontora' } });
    if (s.pending[0].kind === 'kontoraWarning') s = applyAction(s, other, { type: 'kontoraHide', hidden: [] });
    expect(s.pending[0]).toMatchObject({ kind: 'kontoraDecide', player: me });
    const before = s.players.find((x) => x.id === other)!.available;
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { signal: other } });
    const o = s.players.find((x) => x.id === other)!;
    expect(o.held).toBe(1);
    expect(o.available).toBe(before - 1);
  });

  it('Фантастика считается значком любого жанра при питании Ростков', () => {
    const s = fullGame();
    const sf = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 1 && c.icons[0] === 'scifi')!;
    expect(coversStep(s, [sf.id], 'prose', 1, undefined, { wildScifi: true })).toBe(true);
    expect(coversStep(s, [sf.id], 'prose', 1)).toBe(false);
  });
});

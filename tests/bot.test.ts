import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { botMove, playOut } from '../src/engine/bot';
import { curatorSuspicion, rankActions } from '../src/engine/bot-smart';
import { BOT_GOALS, BOT_PRESETS, presetById } from '../src/engine/bot-presets';
import { isBanned, isGenreBook } from '../src/engine/util';
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
    ...s.players.flatMap((p) => [...p.warehouse.map((w) => w.card), ...p.published]),
    ...s.spetskhran,
  ];
}

// Партия, где все выбрали Пристрастие и идёт первая Пятилетка.
function started(seed: number, n = 3): GameState {
  let s = createGame({ players: players(n), seed });
  for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
  return s;
}

describe('пресеты ботов', () => {
  it('у каждого пресета свой id и веса всех целей на 5 Пятилеток от 0 до 10', () => {
    expect(new Set(BOT_PRESETS.map((p) => p.id)).size).toBe(BOT_PRESETS.length);
    for (const p of BOT_PRESETS) {
      for (const g of Object.keys(BOT_GOALS)) {
        const w = p.goals[g as keyof typeof BOT_GOALS];
        expect(w, `${p.id}.${g}`).toHaveLength(5);
        for (const x of w) expect(x >= 0 && x <= 10).toBe(true);
      }
      expect(p.character.caution >= 0 && p.character.caution <= 1).toBe(true);
    }
  });

  it('неизвестный пресет заменяется пресетом по умолчанию', () => {
    expect(presetById('нет такого').random).toBeFalsy();
  });
});

describe('думающий бот', () => {
  for (const n of [2, 3, 4]) {
    it(`${n} игрока доигрывают Райцентр, карты не теряются`, () => {
      for (let seed = 1; seed <= 2; seed++) {
        const s = playOut(createGame({ players: players(n), seed }), seeded(seed));
        expect(s.phase).toBe('end');
        expect(s.round).toBe(5);
        const cards = allCards(s);
        expect(cards.length).toBe(131);
        expect(new Set(cards).size).toBe(131);
      }
    }, 60_000);
  }

  it('доигрывает полный режим', () => {
    const s = playOut(createGame({ players: players(3), seed: 4, mode: 'full' }), seeded(4));
    expect(s.phase).toBe('end');
  }, 60_000);

  it('все пресеты доигрывают партию', () => {
    for (const p of BOT_PRESETS) {
      const s = playOut(createGame({ players: players(2), seed: 7 }), seeded(7), 5000, p.id);
      expect(s.phase, p.id).toBe('end');
    }
  }, 60_000);

  it('не подглядывает: порядок закрытой стопки и Барахолки не влияет на выбор', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const a = started(seed);
      const b: GameState = structuredClone(a);
      // Перетасуем закрытые карты по-другому: стопку и Барахолку вместе.
      const pool = [...b.deck, ...b.baraholka.filter((c): c is string => !!c)].reverse();
      b.baraholka = b.baraholka.map((c) => (c ? pool.pop()! : null));
      b.deck = pool;
      b.loadDeck = [...b.loadDeck].reverse();
      const me = a.order[a.turn];
      const preset = presetById('bookman');
      const ra = rankActions(a, me, preset, seeded(99));
      const rb = rankActions(b, me, preset, seeded(99));
      expect(ra.map((r) => r.a)).toEqual(rb.map((r) => r.a));
    }
  }, 60_000);

  it('играет лучше случайного бота', () => {
    let smart = 0;
    let random = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const s = playOut(createGame({ players: players(2), seed }), seeded(seed), 5000, { p1: 'bookman', p2: 'random' });
      const score = (id: string) => s.result!.scores.find((x) => x.player === id)!.total;
      smart += score('p1');
      random += score('p2');
    }
    expect(smart).toBeGreaterThan(random);
  }, 60_000);

  it('показывает на Посиделках опальные книги — это бесплатные очки', () => {
    let s = started(3, 2);
    // Доходим до Посиделок.
    const rand = seeded(3);
    while (s.phase === 'orders') s = botMove(s, s.pending[0]?.player ?? s.order[s.turn], rand);
    expect(s.phase).toBe('gathering');
    const me = s.order[0];
    const before = s.players.find((p) => p.id === me)!;
    const banned = before.warehouse.filter((w) => isGenreBook(s, w.card) && isBanned(s, w.card)).length;
    const points = before.points;
    s = botMove(s, me, rand);
    expect(s.players.find((p) => p.id === me)!.points).toBe(points + banned);
  }, 60_000);
});

describe('думающий бот в полном режиме', () => {
  it('все пресеты доигрывают полный режим на 3 и 4 игроков', () => {
    for (const n of [3, 4]) {
      for (let seed = 1; seed <= 2; seed++) {
        const ids = players(n).map((p) => p.id);
        const presets = Object.fromEntries(ids.map((id, i) => [id, BOT_PRESETS.filter((x) => !x.random)[(i + seed) % 5].id]));
        const s = playOut(createGame({ players: players(n), seed, mode: 'full' }), seeded(seed), 8000, presets);
        expect(s.phase, `${n} игроков, партия ${seed}`).toBe('end');
      }
    }
  }, 120_000);

  it('в свой ход прячет опальную книгу в Тайник: от Конторы потом не спрятаться', () => {
    let s = createGame({ players: players(3), seed: 5, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions.find((x) => x !== 'curator')! });
    const me = s.players.find((p) => p.id === s.order[s.turn])!;
    me.cache = 1;
    me.capacity = 10;
    for (const w of me.warehouse) w.hidden = false;
    const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    s.deck = s.deck.filter((c) => c !== book);
    me.warehouse.push({ card: book, hidden: false });
    s = botMove(s, me.id, seeded(1));
    expect(s.players.find((p) => p.id === me.id)!.warehouse.find((w) => w.card === book)!.hidden).toBe(true);
  });

  it('подозревает в Кураторе того, кто открыто берёт Пропаганду, — и только по открытой информации', () => {
    const s = createGame({ players: players(3), seed: 5, mode: 'full' });
    const [me, x, y] = s.players;
    x.propagandaTaken = 1;
    const prop = s.deck.find((c) => s.cards[c].kind === 'propaganda')!;
    x.warehouse.push({ card: prop, hidden: false });
    y.sproutsFed = ['ksp'];
    const sus = curatorSuspicion(s, me.id);
    expect(sus[x.id]).toBeGreaterThanOrEqual(0.5);
    expect(sus[y.id]).toBe(0);
    // Спрятанная Пропаганда не видна — и не выдаёт.
    x.propagandaTaken = 0;
    x.warehouse[x.warehouse.length - 1].hidden = true;
    expect(curatorSuspicion(s, me.id)[x.id]).toBe(0);
    // Без Куратора в колоде подозревать некого.
    expect(curatorSuspicion(createGame({ players: players(3), seed: 5, mode: 'full', curator: false }), me.id)).toEqual({});
  });

  it('Куратор не кормит Ростки и бережёт Пропаганду', () => {
    let feeds = 0;
    let curators = 0;
    let recycled = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const s0 = createGame({ players: players(3), seed, mode: 'full' });
      // Куратор — первому игроку.
      s0.players[0].passionOptions = ['curator', s0.players[0].passionOptions.find((x) => x !== 'curator')!];
      for (const p of s0.players.slice(1)) p.passionOptions = p.passionOptions.map((x) => (x === 'curator' ? 'erudite' : x));
      let s = s0;
      for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
      s = playOut(s, seeded(seed), 8000, 'bookman');
      const cur = s.players[0];
      curators++;
      feeds += s.log.filter((l) => l.text.startsWith(`${cur.name} питает Росток`)).length;
      // Пропаганда в конце срезает Ростки — Куратор её в макулатуру не сдаёт.
      const propaganda = Object.values(s.cards).filter((c) => c.kind === 'propaganda').map((c) => `«${c.title}»`);
      recycled += s.log.filter((l) => l.text.startsWith(`${cur.name} в Красном уголке`) && propaganda.some((t) => l.text.includes(t))).length;
    }
    expect(curators).toBe(4);
    expect(feeds / curators).toBeLessThan(1);
    expect(recycled).toBe(0);
  }, 120_000);
});

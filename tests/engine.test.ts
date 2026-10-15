import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { viewFor } from '../src/engine/view';
import { RuleError, cacheLimit, coversStep, isBanned, isEvidence, isLoad } from '../src/engine/util';
import { finalScoring, passionPoints } from '../src/engine/scoring';
import { RULES } from '../src/engine/content';
import type { GameState, PatronId } from '../src/engine/types';
import { GENRES } from '../src/engine/types';
import { removePatron } from '../src/engine/full';

// Действие и сразу «Закончить ход».
function act(s: GameState, who: string, a: Parameters<typeof applyAction>[2]): GameState {
  s = applyAction(s, who, a);
  return s.turnDone === who ? applyAction(s, who, { type: 'endTurn' }) : s;
}


// Пропустить раскладку стартовых Тайников: всё остаётся на виду.
function startOrders(s: GameState): GameState {
  for (const p of s.players) if (s.phase === 'setupCache') s = applyAction(s, p.id, { type: 'hiding', hidden: [] });
  return s;
}


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
    ...s.pending.flatMap((p) => (p.kind === 'posrednichestvoKeep' || p.kind === 'spisanieKeep' ? p.cards : [])),
    ...s.players.flatMap((p) => [...p.warehouse.map((w) => w.card), ...p.published]),
    ...s.spetskhran,
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
    expect(s.sprouts).toHaveLength(3); // Райцентр: Ростков по числу игроков
    expect(createGame({ players: players(3), seed: 1, mode: 'full' }).sprouts).toHaveLength(4); // полный: +1
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
    s = startOrders(s);
    expect(s.phase).toBe('orders');
    const notActive = s.order[1];
    expect(() => applyAction(s, notActive, { type: 'place', place: { address: 'zavoz' } })).toThrow(RuleError);
  });
});

describe('партия ботами', () => {
  for (const n of [2, 3, 4]) {
    it(`${n} игрока доигрывают до конца, карты не теряются`, () => {
      for (let seed = 1; seed <= 15; seed++) {
        const s = playOut(createGame({ players: players(n), seed }), seeded(seed), 5000, 'random');
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
    s = startOrders(s);
    return s;
  }

  it('Барахолка: тайно смотрим 2 книги и покупаем одну из них', () => {
    let s = started();
    const me = s.order[s.turn];
    const other = s.players.find((p) => p.id !== me)!.id;
    const [a, b] = [s.baraholka[1]!, s.baraholka[3]!];
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'baraholka', slots: [1] } })).toThrow(RuleError);
    s = applyAction(s, me, { type: 'place', place: { address: 'baraholka', slots: [1, 3] } });
    // Соперник не видит, какие книги смотрят.
    const theirs = JSON.stringify(viewFor(s, other).pending);
    expect(theirs).not.toContain(a);
    expect(theirs).not.toContain(b);
    expect(JSON.stringify(viewFor(s, me).pending)).toContain(b);
    expect(() => applyAction(s, me, { type: 'baraholkaBuy', slot: 0 })).toThrow(RuleError);
    expect(() => applyAction(s, me, { type: 'baraholkaBuy', next: 0 })).toThrow(RuleError);
    const talons = s.players.find((p) => p.id === me)!.talons;
    s = applyAction(s, me, { type: 'baraholkaBuy', slot: 3 });
    const p = s.players.find((x) => x.id === me)!;
    expect(p.warehouse.map((x) => x.card)).toContain(b);
    expect(p.talons).toBe(talons - RULES.baraholkaPrice);
    expect(s.baraholka[3]).toBeNull();
    expect(s.baraholka[1]).toBe(a); // вторая просмотренная книга остаётся на Барахолке
    expect(s.pending).toHaveLength(0);
  });

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
    s = act(s, me, { type: 'place', place: { address: 'redCorner', recycle: [] } });
    while (s.order[s.turn] !== me) {
      const other = s.order[s.turn];
      s = act(s, other, { type: 'place', place: { address: 'zavoz' } });
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

  it('Вольная душа выбирает жанр значка в свою пользу и не засчитывает его дважды', () => {
    const { s, p } = withBook('monogamist');
    // Лучший жанр — 2 значка (со значком возвращения), второй — 1.
    expect(passionPoints(s, p)).toBe(2 * RULES.passionMonogamist + 1 * RULES.monogamistSecond);
  });

  it('Эрудит засчитывает книгу в одном жанре: значки и бонус за жанр', () => {
    const { s, p } = withBook('erudite');
    // Одна книга — один жанр: 2 значка (со значком возвращения) и 1 жанр.
    expect(passionPoints(s, p)).toBe(2 * RULES.passionErudite + 1 * RULES.eruditePerGenre);
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
        const s = playOut(createGame({ players: players(n), seed, mode: 'full' }), seeded(seed), 5000, 'random');
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
    s = startOrders(s);
    return s;
  }

  it('с Завсегдатаем — одна связь за Пятилетку на всех игроков', () => {
    let s = fullGame();
    const [a, b] = [s.order[s.turn], s.order[(s.turn + 1) % 2]];
    const patron = s.patrons[0];
    const give = (who: string) => {
      const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.includes(patron.genre))!;
      s.deck = s.deck.filter((c) => c !== book);
      s.players.find((x) => x.id === who)!.warehouse.push({ card: book, hidden: false });
      return { patron: patron.id, card: book };
    };
    s.players.forEach((x) => (x.capacity = 10));
    s = applyAction(s, a, { type: 'clubGift', gift: give(a) });
    expect(s.patrons[0].since?.[a]).toBe(1);
    s = act(s, a, { type: 'place', place: { address: 'zavoz' } });
    expect(s.order[s.turn]).toBe(b);
    expect(() => applyAction(s, b, { type: 'clubGift', gift: give(b) })).toThrow('связь в эту Пятилетку уже завязана');
  });

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
    const available = p.available;
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'club', gifts: [{ patron: patron.id, card: book.id }] } })).toThrow(RuleError);
    s = applyAction(s, me, { type: 'clubGift', gift: { patron: patron.id, card: book.id } });
    expect(s.patrons.find((x) => x.id === patron.id)!.connections).toContain(me);
    // Свободное действие: Единомышленник не тратится, ход не переходит, но вторую книгу за ход отдать нельзя.
    expect(s.order[s.turn]).toBe(me);
    expect(s.players.find((x) => x.id === me)!.available).toBe(available);
    const other = s.patrons.find((x) => x.id !== patron.id)!;
    const book2 = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.includes(other.genre))!;
    s.players.find((x) => x.id === me)!.warehouse.push({ card: book2, hidden: false });
    expect(() => applyAction(s, me, { type: 'clubGift', gift: { patron: other.id, card: book2 } })).toThrow(RuleError);
    // После обычного действия ход переходит, и в следующий свой ход снова можно отдать книгу.
    s = applyAction(s, me, { type: 'place', place: { address: 'zavoz' } });
    expect(s.order[s.turn]).toBe(me); // ход ждёт «Закончить ход»
    s = applyAction(s, me, { type: 'endTurn' });
    expect(s.order[s.turn]).not.toBe(me);
    expect(s.clubGiftBy).toBeUndefined();
  });

  it('Контора: соперники не успевают перепрятать — сразу решение; Сигнал удерживает Единомышленника', () => {
    let s = fullGame(11);
    const me = s.order[s.turn];
    const other = s.order.find((x) => x !== me)!;
    // Без открытых опальных книг в Контору не пойти: нечем заплатить.
    for (const p of s.players) p.warehouse = p.warehouse.filter((w) => !isBanned(s, w.card));
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'kontora' } })).toThrow(RuleError);
    const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    s.deck = s.deck.filter((c) => c !== book);
    s.players.find((x) => x.id === other)!.warehouse.push({ card: book, hidden: false });
    s = applyAction(s, me, { type: 'place', place: { address: 'kontora' } });
    expect(s.pending).toHaveLength(1);
    expect(s.pending[0]).toMatchObject({ kind: 'kontoraDecide', player: me });
    expect(() => applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { signal: other } })).toThrow(RuleError);
    const before = s.players.find((x) => x.id === other)!.available;
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { signal: other, seize: { player: other, card: book } } });
    const o = s.players.find((x) => x.id === other)!;
    expect(o.held).toBe(1);
    expect(o.available).toBe(before - 1);
    expect(s.spetskhran).toContain(book);
  });

  it('Фантастика считается значком любого жанра при питании Ростков', () => {
    const s = fullGame();
    const sf = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 1 && c.icons[0] === 'scifi')!;
    expect(coversStep(s, [sf.id], 'prose', 1, undefined, { wildScifi: true })).toBe(true);
    expect(coversStep(s, [sf.id], 'prose', 1)).toBe(false);
  });
});

describe('Поэзия «Заучить»', () => {
  it('в свой ход, не тратя действия: заученный сборник не занимает место на Складе', () => {
    let s = createGame({ players: players(2), seed: 3, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const poem = s.deck.find((c) => s.cards[c].icons.includes('poetry'))!;
    s.deck = s.deck.filter((c) => c !== poem);
    s.players.find((x) => x.id === me)!.warehouse.push({ card: poem, hidden: false });
    const free = (st: typeof s) => { const p = st.players.find((x) => x.id === me)!; return p.capacity - p.warehouse.filter((w) => !w.memorized).length; };
    const before = free(s);
    s = applyAction(s, me, { type: 'memorize', card: poem });
    expect(free(s)).toBe(before + 1);
    expect(s.order[s.turn]).toBe(me);
  });
});

describe('Завсегдатаи: Ветеран, Лейтенант, Управдом', () => {
  function started(seed = 21) {
    let s = createGame({ players: players(2), seed, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    return s;
  }
  function connect(s: GameState, id: PatronId, who: string[]) {
    s.patrons[0] = { id, genre: s.patrons[0].genre, connections: who, turned: false, removed: false };
  }

  it('Ветеран: две книги с Барахолки за одно действие стоят 1 Талон', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'veteran', [me]);
    s.players.find((x) => x.id === me)!.capacity = 10;
    const talons = s.players.find((x) => x.id === me)!.talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'baraholka', slots: [0, 1] } });
    s = applyAction(s, me, { type: 'baraholkaBuy', slot: 0 });
    s = applyAction(s, me, { type: 'baraholkaBuy', slot: 1 });
    s = applyAction(s, me, { type: 'baraholkaBuy' });
    expect(s.pending).toHaveLength(0);
    const p = s.players.find((x) => x.id === me)!;
    expect(p.talons).toBe(talons - 1);
    expect(s.baraholka[0]).toBeNull();
    expect(s.baraholka[1]).toBeNull();
  });

  it('Лейтенант забирает книги, изъятые с адресов', () => {
    let found = false;
    for (let seed = 1; seed <= 10 && !found; seed++) {
      const s0 = createGame({ players: players(2), seed, mode: 'full' });
      connect(s0, 'lieutenant', ['p1', 'p2']);
      const s = playOut(s0, seeded(seed), 5000, 'random');
      expect(s.phase).toBe('end');
      found = s.log.some((l) => l.text.includes('Лейтенант приносит'));
    }
    expect(found).toBe(true);
  });

  it('Управдом: после Профилактики игрок сам выбирает, какие книги отдать', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'housekeeper', [me]);
    const p = s.players.find((x) => x.id === me)!;
    p.capacity += 2;
    p.patronBonus.capacity = 2;
    while (p.warehouse.length < p.capacity) p.warehouse.push({ card: s.deck.pop()!, hidden: false });
    removePatron(s, 'housekeeper');
    expect(s.pending[0]).toMatchObject({ kind: 'discardExcess', player: me, count: 2 });
    const give = p.warehouse.slice(0, 2).map((w) => w.card);
    s = applyAction(s, me, { type: 'discardExcess', cards: give });
    const after = s.players.find((x) => x.id === me)!;
    expect(after.warehouse.length).toBe(after.capacity);
    expect(after.warehouse.some((w) => give.includes(w.card))).toBe(false);
  });
});

describe('Главлитовец', () => {
  it('переносит опалу с одного жанра на другой; число опальных жанров не меняется', () => {
    let s = createGame({ players: players(2), seed: 8, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const slot = s.patrons[0];
    s.patrons[0] = { ...slot, id: 'glavlit' };
    const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.includes(slot.genre))!;
    s.deck = s.deck.filter((c) => c !== book);
    s.players.find((x) => x.id === me)!.warehouse.push({ card: book, hidden: false });
    s.players.find((x) => x.id === me)!.capacity = 10;
    s = applyAction(s, me, { type: 'clubGift', gift: { patron: 'glavlit', card: book } });
    expect(s.pending[0]).toMatchObject({ kind: 'glavlitSwap', player: me });
    const from = s.banned[0];
    const to = GENRES.find((g) => !s.banned.includes(g))!;
    const n = s.banned.length;
    s = applyAction(s, me, { type: 'glavlitSwap', from, to });
    expect(s.banned).toContain(to);
    expect(s.banned).not.toContain(from);
    expect(s.banned.length).toBe(n);
    expect(s.order[s.turn]).toBe(me); // связь — свободное действие: ход остаётся у игрока
  });

  it('боты с Главлитовцем доигрывают партии', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const s0 = createGame({ players: players(3), seed, mode: 'full' });
      s0.patrons[0] = { ...s0.patrons[0], id: 'glavlit', connections: ['p1', 'p2'] };
      const s = playOut(s0, seeded(seed), 5000, 'random');
      expect(s.phase).toBe('end');
      expect(s.log.some((l) => l.text.includes('(Главлитовец)'))).toBe(true);
    }
  });
});

describe('разбивка очков по источникам', () => {
  it('сумма по источникам равна очкам, набранным по ходу игры', () => {
    for (const mode of ['beginner', 'full'] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const s = playOut(createGame({ players: players(3), seed, mode }), seeded(seed), 5000, 'random');
        for (const p of s.players) {
          const sum = Object.values(p.pointsBy).reduce((a, n) => a + (n ?? 0), 0);
          expect(sum).toBe(p.points);
        }
      }
    }
  });
});

describe('Тиражирование', () => {
  it('нельзя бесплатно взять Улику или Пропаганду', () => {
    let s = createGame({ players: players(2), seed: 12 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const evidence = Object.values(s.cards).find((c) => c.kind === 'evidence')!.id;
    const genre = s.deck.find((c) => s.cards[c].kind === 'genre')!;
    s.deck = s.deck.filter((c) => c !== evidence && c !== genre);
    s.razval = [genre, evidence, s.razval[2], s.razval[3]];
    const p = s.players.find((x) => x.id === me)!;
    p.talons = 10;
    p.capacity = 10;
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'copyText', address: 'razval', buy: { address: 'razval', slot: 0 }, card: evidence } })).toThrow(RuleError);
  });
});

describe('настройка «без Куратора»', () => {
  it('Куратор не выпадает никому, если его отключили', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = createGame({ players: players(4), seed, mode: 'full', curator: false });
      expect(s.players.flatMap((p) => p.passionOptions)).not.toContain('curator');
    }
    // По умолчанию Куратор в колоде есть: хоть в одной из раздач он попадается.
    const dealt = Array.from({ length: 30 }, (_, i) => createGame({ players: players(4), seed: i + 1, mode: 'full' }))
      .some((s) => s.players.some((p) => p.passionOptions.includes('curator')));
    expect(dealt).toBe(true);
  });
});

describe('Главлит и обновлённые Завсегдатаи', () => {
  function started(mode: 'beginner' | 'full' = 'full', seed = 21) {
    let s = createGame({ players: players(2), seed, mode });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    return s;
  }
  function connect(s: GameState, id: PatronId, who: string[]) {
    s.patrons[0] = { id, genre: s.patrons[0].genre, connections: who, turned: false, removed: false };
  }
  // Положить на склад книгу из стопки, подходящую под условие.
  function give(s: GameState, who: string, ok: (icons: string[]) => boolean) {
    const card = s.deck.find((c) => s.cards[c].kind === 'genre' && ok(s.cards[c].icons))!;
    s.deck = s.deck.filter((c) => c !== card);
    const p = s.players.find((x) => x.id === who)!;
    p.capacity = 10;
    p.warehouse.push({ card, hidden: false });
    return card;
  }

  it('Главлит: сдать подцензурные книги (+1т за каждую) и взять столько же вслепую из выбранных стопок', () => {
    let s = started('beginner');
    const me = s.order[s.turn];
    const free = give(s, me, (icons) => !icons.some((g) => s.banned.includes(g as never)));
    const b1 = give(s, me, (icons) => icons.some((g) => s.banned.includes(g as never)) && !icons.includes('irony'));
    const b2 = give(s, me, (icons) => icons.some((g) => s.banned.includes(g as never)) && !icons.includes('irony'));
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'glavlit', cards: [free], draws: ['load'] } })).toThrow(RuleError);
    const p0 = s.players.find((x) => x.id === me)!;
    const [talons, size, loads] = [p0.talons, p0.warehouse.length, s.loadDeck.length];
    s = applyAction(s, me, { type: 'place', place: { address: 'glavlit', cards: [b1, b2], draws: ['load', 'unprinted'] } });
    const p = s.players.find((x) => x.id === me)!;
    expect(p.talons).toBe(talons + 2 * RULES.glavlitTalons);
    expect(p.warehouse.length).toBe(size);
    expect(s.loadDeck.length).toBe(loads - 1);
    expect(s.discard).toEqual(expect.arrayContaining([b1, b2]));
  });

  it('Главред: за каждую сданную в Главлит книгу — очко за значок', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'editor', [me]);
    const card = give(s, me, (icons) => icons.length === 2 && icons.some((g) => s.banned.includes(g as never)) && !icons.includes('irony') && !icons.includes('prose'));
    s = applyAction(s, me, { type: 'place', place: { address: 'glavlit', cards: [card], draws: ['unprinted'] } });
    expect(s.players.find((x) => x.id === me)!.pointsBy.editor).toBe(2);
  });

  it('Ветеран: на Развале несколько книг за одно действие, в сумме на 1 Талон дешевле', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'veteran', [me]);
    const p0 = s.players.find((x) => x.id === me)!;
    p0.capacity = 10;
    p0.talons = 10;
    const slots = [0, 1].filter((i) => s.razval[i]);
    const cost = slots.reduce((a, i) => a + RULES.razvalPrices[i], 0);
    s = applyAction(s, me, { type: 'place', place: { address: 'razval', slot: slots[0], slots } });
    expect(s.players.find((x) => x.id === me)!.talons).toBe(10 - (cost - 1));
    for (const i of slots) expect(s.razval[i]).toBeNull();
  });

  it('Корреспондент: +3 Талона за издание; Столяр: Закладка Тайника — +2 места', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'correspondent', [me]);
    const card = give(s, me, (icons) => icons.length === 1 && !icons.includes('irony'));
    const t = s.players.find((x) => x.id === me)!.talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'samizdat', card } });
    expect(s.players.find((x) => x.id === me)!.talons).toBe(t + RULES.samizdatTalons + RULES.correspondentTalons);

    let s2 = started();
    const me2 = s2.order[s2.turn];
    connect(s2, 'carpenter', [me2]);
    const cache = s2.players.find((x) => x.id === me2)!.cache;
    s2 = applyAction(s2, me2, { type: 'group', group: { action: 'expandCache' } });
    expect(s2.players.find((x) => x.id === me2)!.cache).toBe(cache + RULES.carpenterCache);
  });

  it('Подмастерье повторяет только уже сделанное действие Группы', () => {
    const s = started();
    const me = s.order[s.turn];
    connect(s, 'apprentice', [me]);
    const p = s.players.find((x) => x.id === me)!;
    p.groupUsed = ['expandWarehouse'];
    s.pending = [{ kind: 'extraGroup', player: me }];
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'expandCache' } })).toThrow(RuleError);
    const next = applyAction(s, me, { type: 'group', group: { action: 'expandWarehouse' } });
    expect(next.players.find((x) => x.id === me)!.capacity).toBe(p.capacity + 1);
  });

  it('Вызволение из бед: +2 очка за каждого вызволенного', () => {
    let s = started();
    const me = s.order[s.turn];
    const other = s.players.find((x) => x.id !== me)!;
    other.held = 2;
    other.available = Math.max(0, other.available - 2);
    s = applyAction(s, me, { type: 'group', group: { action: 'rescue', returns: { [other.id]: 2 } } });
    expect(s.players.find((x) => x.id === me)!.pointsBy.rescue).toBe(2 * RULES.rescuePoints);
  });

  it('Завмаг: Госкниготорг бесплатно, состав свободный', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'zavmag', [me]);
    const p0 = s.players.find((x) => x.id === me)!;
    p0.capacity = 10;
    p0.talons = 0;
    s = applyAction(s, me, { type: 'place', place: { address: 'gostorg', pairs: 1, mix: ['unprinted', 'unprinted'] } });
    const p = s.players.find((x) => x.id === me)!;
    expect(p.talons).toBe(0);
    expect(p.warehouse.length).toBe(p0.warehouse.length + 2);
  });

  it('Цеховик: каждое получение Талонов — на 1 больше; Маклер: +2 Талона за связь', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'tsekhovik', [me]);
    const t = s.players.find((x) => x.id === me)!.talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'zavoz' } });
    expect(s.players.find((x) => x.id === me)!.talons).toBe(t + RULES.zavozIncome + RULES.tsekhovikBonus);

    let s2 = started();
    const me2 = s2.order[s2.turn];
    connect(s2, 'broker', [me2]);
    const other = s2.patrons[1];
    const card = give(s2, me2, (icons) => icons.includes(other.genre) && !icons.includes('irony'));
    const t2 = s2.players.find((x) => x.id === me2)!.talons;
    s2 = applyAction(s2, me2, { type: 'clubGift', gift: { patron: other.id, card } });
    expect(s2.players.find((x) => x.id === me2)!.talons).toBe(t2 + RULES.brokerTalons);
  });

  it('Комсорг: в Красном уголке сколько угодно книг и +1 очко за каждую', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'komsorg', [me]);
    const books = [give(s, me, (i) => !i.includes('irony')), give(s, me, (i) => !i.includes('irony'))];
    s = applyAction(s, me, { type: 'place', place: { address: 'redCorner', recycle: books } });
    expect(s.players.find((x) => x.id === me)!.pointsBy.komsorg).toBe(2 * RULES.komsorgPoints);
  });
});

describe('Тайник и закрытые книги', () => {
  it('книга, взятая вслепую, сразу ложится в Тайник (если есть место), и соперник не видит, что это', () => {
    let s = createGame({ players: players(2), seed: 8 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const other = s.players.find((p) => p.id !== me)!.id;
    const p0 = s.players.find((p) => p.id === me)!;
    p0.cache = 1;
    p0.capacity = 10;
    s = applyAction(s, me, { type: 'place', place: { address: 'gostorg', pairs: 1 } });
    const p = s.players.find((x) => x.id === me)!;
    const hidden = p.warehouse.filter((x) => x.hidden);
    expect(hidden).toHaveLength(1); // Непечатная — в Тайник, Нагрузка — открыто
    const card = hidden[0].card;
    const theirs = viewFor(s, other);
    expect(theirs.players.find((x) => x.id === me)!.warehouse.map((x) => x.card)).not.toContain(card);
    expect(theirs.log.map((l) => l.text).join('\n')).not.toContain(s.cards[card].title);
    expect(theirs.log.map((l) => l.text).join('\n')).toContain('кладёт в Тайник');
    expect(viewFor(s, me).players.find((x) => x.id === me)!.warehouse.map((x) => x.card)).toContain(card);
  });
});

describe('Тайник в свой ход', () => {
  it('можно пересобрать Тайник, не тратя действие и не передавая ход; соперник не видит спрятанное', () => {
    let s = createGame({ players: players(2), seed: 8 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const other = s.players.find((p) => p.id !== me)!.id;
    const p0 = s.players.find((p) => p.id === me)!;
    p0.cache = 0; // одно место в Тайнике дают 2 стартовые Нагрузки
    const [a, b] = p0.warehouse.map((x) => x.card);
    s = applyAction(s, me, { type: 'hiding', hidden: [a] });
    expect(s.order[s.turn]).toBe(me);
    expect(s.players.find((p) => p.id === me)!.available).toBe(p0.available);
    expect(viewFor(s, other).players.find((p) => p.id === me)!.warehouse.map((x) => x.card)).not.toContain(a);
    expect(() => applyAction(s, me, { type: 'hiding', hidden: [a, b] })).toThrow(RuleError); // мест только 1
    s = applyAction(s, me, { type: 'hiding', hidden: [b] }); // переложить: a — открыто, b — в Тайник
    const w = s.players.find((p) => p.id === me)!.warehouse;
    expect(w.find((x) => x.card === a)!.hidden).toBe(false);
    expect(w.find((x) => x.card === b)!.hidden).toBe(true);
    expect(() => applyAction(s, other, { type: 'hiding', hidden: [] })).toThrow(RuleError); // не в свой ход
  });
});

describe('Срезы Куратора', () => {
  it('в журнале видно, сколько Пропаганды у Куратора и какие ступени он срезал', () => {
    const s = createGame({ players: players(3), seed: 4, mode: 'full' });
    const [cur] = s.players;
    cur.passion = 'curator';
    const props = s.deck.filter((c) => s.cards[c].kind === 'propaganda').slice(0, 2);
    cur.warehouse = props.map((card) => ({ card, hidden: true }));
    for (const sp of s.sprouts) sp.progress = 4;
    const r = finalScoring(s);
    expect(r.glasnost).toBe(true);
    const text = s.log.map((l) => l.text).join('\n');
    expect(text).toContain('Пропаганды у него на Складе и в Тайнике: 2');
    expect(text.match(/Срез: Росток/g)).toHaveLength(2);
    expect(text).toContain('ступень IV → III');
  });
});

describe('Ничья', () => {
  it('при равенстве очков в итоге расписано: значки → связи → Талоны', () => {
    const s = createGame({ players: players(2), seed: 4, mode: 'full', curator: false });
    for (const sp of s.sprouts) sp.progress = 3;
    for (const p of s.players) { p.warehouse = []; p.points = 10; p.talons = 3; }
    s.players[1].talons = 5;
    const r = finalScoring(s);
    expect(r.winners).toEqual([s.players[1].id]);
    expect(r.note).toContain('Ничья по очкам (10) → ничья по значкам (0) → ничья по связям (0) → победа по Талонам');
  });
});

describe('Нагрузка-улика', () => {
  it('до Возвращения смыслов — обычная Нагрузка, после — Улика (опальная, +5 очков)', () => {
    let s = createGame({ players: players(2), seed: 6, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const ev = Object.values(s.cards).find((c) => c.kind === 'loadEvidence')!.id;
    s.loadDeck = s.loadDeck.filter((c) => c !== ev);
    const p = s.players.find((x) => x.id === me)!;
    p.capacity = 10;
    p.warehouse.push({ card: ev, hidden: false });
    expect(isBanned(s, ev)).toBe(false);
    expect(isEvidence(s, ev)).toBe(false);
    expect(isLoad(s, ev)).toBe(true);
    s = applyAction(s, me, { type: 'group', group: { action: 'restore', card: ev } });
    expect(isBanned(s, ev)).toBe(true);
    expect(isEvidence(s, ev)).toBe(true);
    expect(isLoad(s, ev)).toBe(false);
  });
});

describe('Тайники перед началом', () => {
  it('после выбора Пристрастий все раскладывают Тайник; до этого чужие стартовые книги не видны', () => {
    let s = createGame({ players: players(2), seed: 12 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    expect(s.phase).toBe('setupCache');
    const [a, b] = s.players.map((p) => p.id);
    // Пока идёт раскладка, у соперника видны только рубашки.
    expect(viewFor(s, b).players.find((p) => p.id === a)!.warehouse.every((w) => w.card === null)).toBe(true);
    const secret = s.players[0].warehouse[0].card; // одно место дают 2 стартовые Нагрузки
    s = applyAction(s, a, { type: 'hiding', hidden: [secret] });
    expect(s.phase).toBe('setupCache');
    s = applyAction(s, b, { type: 'hiding', hidden: [] });
    expect(s.phase).toBe('orders');
    const seen = viewFor(s, b).players.find((p) => p.id === a)!.warehouse.map((w) => w.card);
    expect(seen).not.toContain(secret);
    expect(seen.filter(Boolean)).toHaveLength(s.players[0].warehouse.length - 1);
  });
});

describe('Последний Единомышленник', () => {
  it('может сделать Расширение сети, а другое действие — нет', () => {
    let s = createGame({ players: players(2), seed: 9 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    p.available = 1;
    p.talons = 10;
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'expandWarehouse' } })).toThrow(RuleError);
    s = applyAction(s, me, { type: 'group', group: { action: 'hire' } });
    const q = s.players.find((x) => x.id === me)!;
    expect(q.workers).toBe(p.workers + 1);
    expect(q.available).toBe(1); // новый Единомышленник — всё ещё последний, ему в Красный уголок
  });
});

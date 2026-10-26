import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyAction, createGame, startHide } from '../src/engine/engine';
import { playOut } from '../src/engine/bot';
import { curatorSuspicion, curatorSuspicionDetail } from '../src/engine/bot-smart';
import { gainedInfo, viewFor } from '../src/engine/view';
import { RuleError, cacheLimit, bestFeedBooks, coversStep, iconCount, title, iconsOf, isBanned, isEvidence, isLoad, isPropaganda, discard, seeSpetskhran, toSpetskhranPublic } from '../src/engine/util';
import { finalScoring, passionPoints, scoreLine } from '../src/engine/scoring';
import { PASSIONS, RULES, SPROUTS, limitFor, sproutBonusOptions } from '../src/engine/content';
import type { GameState, Genre, PatronId } from '../src/engine/types';
import { GENRES } from '../src/engine/types';
import { proseBonus, removePatron, takeFromSpetskhran } from '../src/engine/full';

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


// Колонка «ЧНЛ» финального подсчёта для игрока (минус ЧНЛ, плюс Разоблачения).
function finalScoringLine(s: GameState, id: string): number {
  return scoreLine(s, s.players.find((p) => p.id === id)!).propaganda;
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
    ...s.deck, ...s.discard, ...s.loadDeck, ...s.loadDiscard, ...s.tolkuchka, ...s.knigoobmen, ...s.raspredelitel, ...(s.agitpunkt ?? []),
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
    expect(createGame({ players: players(3), seed: 1, mode: 'full' }).sprouts).toHaveLength(3); // полный: по числу игроков (в «Заповеднике» +1)
    expect(s.razval.every(Boolean)).toBe(true);
    expect(new Set(allCards(s)).size).toBe(133);
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
        expect(cards.length).toBe(133);
        expect(new Set(cards).size).toBe(133);
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

  it('Спецхран: изъятое при всех знают все, Выдачу на руки — только взявший; взятую книгу забывают', () => {
    let s = createGame({ players: players(3), seed: 4, mode: 'full' });
    expect(Object.values(s.spetskhranSeen ?? {}).flat()).toEqual([]);
    const [p1, p2] = s.players;
    const card = s.deck[0];
    toSpetskhranPublic(s, [card]);
    expect(s.spetskhranSeen![p2.id]).toContain(card);
    s.pending = [];
    s.phase = 'orders';
    seeSpetskhran(s, p1.id, [...s.spetskhran]);
    expect(s.spetskhranSeen![p1.id]).toEqual(expect.arrayContaining(s.spetskhran));
    expect(s.spetskhranSeen![p2.id]).toEqual([card]);
    expect(viewFor(s, p2.id)).not.toHaveProperty('spetskhranSeen');
    takeFromSpetskhran(s, p1, card);
    expect(s.spetskhranSeen![p1.id]).not.toContain(card);
    expect(s.spetskhranSeen![p2.id]).toEqual([]);
  });

  it('Барахолка: игрок помнит увиденные книги, соперник — нет', () => {
    let s = started();
    const me = s.order[s.turn];
    const [a, b] = [s.baraholka[1]!, s.baraholka[3]!];
    s = applyAction(s, me, { type: 'place', place: { address: 'baraholka', slots: [1, 3] } });
    s = act(s, me, { type: 'baraholkaBuy' });
    expect(viewFor(s, me).baraholkaKnown).toEqual([null, a, null, b]);
    const other = s.order[s.turn];
    expect(other).not.toBe(me);
    expect(viewFor(s, other)).not.toHaveProperty('baraholkaSeen');
    expect(viewFor(s, other).baraholkaKnown.every((c) => c === null)).toBe(true);
    // Купленную книгу забывают все; обновление Барахолки стирает память.
    s = applyAction(s, other, { type: 'place', place: { address: 'baraholka', slots: [0, 3] } });
    s = act(s, other, { type: 'baraholkaBuy', slot: 3 });
    expect(viewFor(s, me).baraholkaKnown).toEqual([null, a, null, null]);
    expect(viewFor(s, other).baraholkaKnown[0]).toBe(s.baraholka[0]);
  });

  it('Толкучка: покупка — 2 Талона за книгу независимо от значков', () => {
    const s = started();
    const me = s.order[s.turn];
    const card = s.tolkuchka[0];
    const before = s.players.find((p) => p.id === me)!.talons;
    const next = applyAction(s, me, { type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'buy', card }] } });
    expect(next.players.find((p) => p.id === me)!.talons).toBe(before - 2);
    // Две книги за одно действие — только с Ветераном.
    const two = { type: 'place' as const, place: { address: 'tolkuchka' as const, ops: s.tolkuchka.slice(0, 2).map((c) => ({ op: 'buy' as const, card: c })) } };
    s.players.find((p) => p.id === me)!.talons = 10;
    expect(() => applyAction(s, me, two)).toThrow(/Ветераном/);
    // Продать тоже можно только одну книгу.
    const p = s.players.find((x) => x.id === me)!;
    const genre = s.deck.filter((c) => s.cards[c].kind === 'genre').slice(0, 2);
    s.deck = s.deck.filter((c) => !genre.includes(c));
    p.capacity = 10;
    p.warehouse.push(...genre.map((card) => ({ card, hidden: false })));
    const sellTwo = { type: 'place' as const, place: { address: 'tolkuchka' as const, ops: genre.map((c) => ({ op: 'sell' as const, card: c })) } };
    expect(() => applyAction(s, me, sellTwo)).toThrow(/Продать несколько/);
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'sell', card: genre[0] }, { op: 'buy', card }] } })).not.toThrow();
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
        expect(cards.length).toBe(133);
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
    expect(s.log.find((l) => l.club)).toMatchObject({ club: { player: a, round: 1 } });
    s = act(s, a, { type: 'place', place: { address: 'zavoz' } });
    expect(s.order[s.turn]).toBe(b);
    expect(() => applyAction(s, b, { type: 'clubGift', gift: give(b) })).toThrow('занят на Пятилетку');
  });

  it('в Клубе 8 Завсегдатаев на 8 жанров, связь — за книгу жанра слота', () => {
    let s = fullGame();
    expect(s.patrons).toHaveLength(8);
    expect(new Set(s.patrons.map((x) => x.genre)).size).toBe(8);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    // Завсегдатай без решения при завязке связи (Главлитовец сразу просит перенести опалу).
    const book = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 1 && c.icons[0] !== 'album'
      && s.patrons.find((x) => x.genre === c.icons[0])!.id !== 'glavlit')!;
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
    // Без доноса и без пунктов по выбору — нельзя.
    expect(() => applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { handout: true } })).toThrow(RuleError);
    expect(() => applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { denounce: { player: other, card: book } } })).toThrow(/от 1 до 3/);
    // В конце похода обязательно: Сигнал на того, на кого донос, и Изъятие книги из доноса.
    const before = s.players.find((x) => x.id === other)!.available;
    const others = s.players.filter((x) => x.id !== other && x.id !== me).map((x) => x.held);
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { handout: true, denounce: { player: other, card: book } } });
    if (s.pending[0]?.kind === 'kontoraHandout') s = applyAction(s, me, { type: 'kontoraHandout', card: s.pending[0].cards[0] });
    expect(s.players.filter((x) => x.id !== other && x.id !== me).map((x) => x.held)).toEqual(others);
    expect(s.spetskhran).toContain(book);
    expect(s.players.find((x) => x.id === other)!.warehouse.some((w) => w.card === book)).toBe(false);
    const o = s.players.find((x) => x.id === other)!;
    expect(o.held).toBe(1);
    expect(RULES.petitionMax).toBe(1);
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
  it('нельзя бесплатно взять Улику или ЧНЛ', () => {
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

  it('Ветеран: скидка без минимума — одна книга за 1 Талон достаётся даром', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'veteran', [me]);
    const p0 = s.players.find((x) => x.id === me)!;
    p0.capacity = 10;
    p0.talons = 5;
    const slot = RULES.razvalPrices.findIndex((c, i) => c === 1 && s.razval[i]);
    expect(slot).toBeGreaterThanOrEqual(0);
    s = applyAction(s, me, { type: 'place', place: { address: 'razval', slot } });
    expect(s.players.find((x) => x.id === me)!.talons).toBe(5);
  });

  it('Корреспондент: +1 Талон и +1 очко за издание; Столяр: Закладка Тайника — +2 места', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'correspondent', [me]);
    const card = give(s, me, (icons) => icons.length === 1 && !icons.includes('irony'));
    const t = s.players.find((x) => x.id === me)!.talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'samizdat', card } });
    expect(s.players.find((x) => x.id === me)!.talons).toBe(t + RULES.samizdatTalons + RULES.correspondentTalons);
    // Статистика: часть — Самиздату, часть — Корреспонденту.
    expect(s.players.find((x) => x.id === me)!.talonsBy).toMatchObject({ samizdat: RULES.samizdatTalons, correspondent: RULES.correspondentTalons });
    expect(s.players.find((x) => x.id === me)!.pointsBy.correspondent).toBe(RULES.correspondentPoints);
    // Профессор: за ступень Ростка ещё +1 Талон и +2 очка.
    let s4 = started();
    const me4 = s4.order[s4.turn];
    connect(s4, 'professor', [me4]);
    const sp = s4.sprouts[0];
    const main = SPROUTS.find((x) => x.id === sp.id)!.main;
    const card4 = give(s4, me4, (icons) => icons.length === 1 && icons[0] === main);
    const p4 = s4.players.find((x) => x.id === me4)!;
    const t4 = p4.talons;
    s4 = applyAction(s4, me4, { type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: [card4] }] } });
    const after4 = s4.players.find((x) => x.id === me4)!;
    expect(after4.pointsBy.professor).toBe(RULES.professorPoints);
    expect(after4.talonsBy?.professor).toBe(RULES.professorTalons);
    expect(after4.talons).toBeGreaterThanOrEqual(t4 + RULES.professorTalons);
    // С Цеховиком за одно издание — ещё ровно +1, хоть доход и из двух частей.
    let s3 = started();
    const me3 = s3.order[s3.turn];
    connect(s3, 'correspondent', [me3]);
    s3.patrons[1] = { id: 'tsekhovik', genre: s3.patrons[1].genre, connections: [me3], turned: false, removed: false };
    const card3 = give(s3, me3, (icons) => icons.length === 1 && !icons.includes('irony'));
    const t3 = s3.players.find((x) => x.id === me3)!.talons;
    s3 = applyAction(s3, me3, { type: 'place', place: { address: 'samizdat', card: card3 } });
    expect(s3.players.find((x) => x.id === me3)!.talons).toBe(t3 + RULES.samizdatTalons + RULES.correspondentTalons + RULES.tsekhovikBonus);

    let s2 = started();
    const me2 = s2.order[s2.turn];
    connect(s2, 'carpenter', [me2]);
    const cache = s2.players.find((x) => x.id === me2)!.cache;
    const talons = s2.players.find((x) => x.id === me2)!.talons;
    s2 = applyAction(s2, me2, { type: 'group', group: { action: 'expandCache' } });
    expect(s2.players.find((x) => x.id === me2)!.cache).toBe(cache + RULES.carpenterCache);
    expect(s2.players.find((x) => x.id === me2)!.talons).toBe(talons); // со Столяром — бесплатно
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

  it('Вызволение из бед: +2 очка за каждого вызволенного, не больше 2 за раз', () => {
    let s = started();
    const me = s.order[s.turn];
    const other = s.players.find((x) => x.id !== me)!;
    other.held = 2;
    other.available = Math.max(0, other.available - 2);
    other.held = 3;
    // Не больше двух за одно Вызволение.
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'rescue', returns: { [other.id]: 3 } } })).toThrow(/не больше 2/);
    s = applyAction(s, me, { type: 'group', group: { action: 'rescue', returns: { [other.id]: 2 } } });
    expect(s.players.find((x) => x.id === me)!.pointsBy.rescue).toBe(2 * RULES.rescuePoints);
    expect(s.players.find((x) => x.id === other.id)!.held).toBe(1);
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

  it(`Машинистка: Тиражирование без покупки — книга с любого адреса, на адрес никто не идёт; +${RULES.typistTalons}т`, () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'typist', [me]);
    const p = s.players.find((x) => x.id === me)!;
    p.capacity = 10;
    const card = s.tolkuchka.find((c) => s.cards[c].kind === 'genre')!;
    const t = p.talons;
    const available = p.available;
    s = applyAction(s, me, { type: 'group', group: { action: 'copyText', address: 'tolkuchka', card } });
    const after = s.players.find((x) => x.id === me)!;
    expect(after.warehouse.some((w) => w.card === card)).toBe(true);
    expect(after.talons).toBe(t + RULES.typistTalons);
    expect(after.available).toBe(available - 1);
    expect(s.occupancy.tolkuchka ?? []).not.toContain(me);
    // Без Машинистки так нельзя — Тиражирование только вместе с покупкой.
    const s2 = started();
    const me2 = s2.order[s2.turn];
    const card2 = s2.tolkuchka.find((c) => s2.cards[c].kind === 'genre')!;
    expect(() => applyAction(s2, me2, { type: 'group', group: { action: 'copyText', address: 'tolkuchka', card: card2 } })).toThrow(RuleError);
  });

  it('Цеховик: за действие, приносящее Талоны, — на 1 больше (раз за действие); Маклер: +2 Талона за связь', () => {
    let s = started();
    const me = s.order[s.turn];
    connect(s, 'tsekhovik', [me]);
    const t = s.players.find((x) => x.id === me)!.talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'zavoz' } });
    expect(s.players.find((x) => x.id === me)!.talons).toBe(t + RULES.zavozIncome + RULES.tsekhovikBonus);
    // Продажа иронии на Толкучке: Талоны за продажу и Ирония пущена в народ — а Цеховик всё равно +1 один раз.
    let s1 = started();
    const me1 = s1.order[s1.turn];
    connect(s1, 'tsekhovik', [me1]);
    const irony = give(s1, me1, (icons) => icons.length === 1 && icons[0] === 'irony');
    const t1 = s1.players.find((x) => x.id === me1)!.talons;
    s1 = applyAction(s1, me1, { type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'sell', card: irony }] } });
    const p1 = s1.players.find((x) => x.id === me1)!;
    expect(p1.talonsBy?.irony).toBe(1);
    expect(p1.talonsBy?.tsekhovik).toBe(RULES.tsekhovikBonus);
    expect(p1.talons).toBe(t1 + p1.talonsBy!.tolkuchka + 1 + RULES.tsekhovikBonus);

    let s2 = started();
    const me2 = s2.order[s2.turn];
    connect(s2, 'broker', [me2]);
    // Завсегдатай, для которого в стопке есть подходящая книга без Иронии.
    const other = s2.patrons.slice(1).find((pt) => s2.deck.some((c) => s2.cards[c].kind === 'genre' && s2.cards[c].icons.includes(pt.genre) && !s2.cards[c].icons.includes('irony')))!;
    const card = give(s2, me2, (icons) => icons.includes(other.genre) && !icons.includes('irony'));
    const t2 = s2.players.find((x) => x.id === me2)!.talons;
    s2 = applyAction(s2, me2, { type: 'clubGift', gift: { patron: other.id, card } });
    expect(s2.players.find((x) => x.id === me2)!.talons).toBe(t2 + RULES.brokerTalons);

    // Связь с самим Маклером Талонов не даёт.
    let s3 = started();
    const me3 = s3.order[s3.turn];
    connect(s3, 'broker', []);
    const card3 = give(s3, me3, (icons) => icons.includes(s3.patrons[0].genre) && !icons.includes('irony'));
    const t3 = s3.players.find((x) => x.id === me3)!.talons;
    s3 = applyAction(s3, me3, { type: 'clubGift', gift: { patron: 'broker', card: card3 } });
    expect(s3.patrons[0].connections).toContain(me3);
    expect(s3.players.find((x) => x.id === me3)!.talons).toBe(t3);
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
    // Обычная Нагрузка (ПСС Ленина — ЧНЛ, она тоже ушла бы в Тайник).
    s.loadDeck = s.loadDeck.filter((c) => s.cards[c].kind !== 'loadPropaganda');
    s = applyAction(s, me, { type: 'place', place: { address: 'gostorg', pairs: 1 } });
    const p = s.players.find((x) => x.id === me)!;
    const hidden = p.warehouse.filter((x) => x.hidden);
    expect(hidden).toHaveLength(1); // Непечатная — в Тайник, Нагрузка — открыто
    const card = hidden[0].card;
    const theirs = viewFor(s, other);
    expect(theirs.players.find((x) => x.id === me)!.warehouse.map((x) => x.card)).not.toContain(card);
    expect(theirs.log.map((l) => l.text).join('\n')).not.toContain(s.cards[card].title);
    expect(theirs.log.map((l) => l.text).join('\n')).toMatch(/• В Тайник: 1 книга/);
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
  it('в журнале видно, сколько ЧНЛ у Куратора и какие ступени он срезал', () => {
    const s = createGame({ players: players(3), seed: 4, mode: 'full' });
    const [cur] = s.players;
    cur.passion = 'curator';
    const props = s.deck.filter((c) => s.cards[c].kind === 'propaganda').slice(0, 2);
    cur.warehouse = props.map((card) => ({ card, hidden: true }));
    for (const sp of s.sprouts) sp.progress = 4;
    const r = finalScoring(s);
    expect(r.glasnost).toBe(true);
    const text = s.log.map((l) => l.text).join('\n');
    expect(text).toContain('ЧНЛ у него на Складе и в Тайнике: 2');
    expect(text.match(/Срез: Росток/g)).toHaveLength(2);
    expect(text).toContain('ступень IV → III');
  });

  it('ПСС Ленина — ЧНЛ у всех: срез у Куратора, −5 у книжника; Тайник не прикрывает; смыслы → Разоблачение', () => {
    const s = createGame({ players: players(3), seed: 4, mode: 'full' });
    const [cur, honest] = s.players;
    cur.passion = 'curator';
    const lenin = Object.values(s.cards).find((c) => c.kind === 'loadPropaganda')!.id;
    expect(s.loadDeck).toContain(lenin);
    expect(isPropaganda(s, lenin)).toBe(true);
    expect(isBanned(s, lenin)).toBe(true);
    expect(isLoad(s, lenin)).toBe(false); // не прикрывает Тайник
    const h = { ...honest, warehouse: [{ card: lenin, hidden: false }] };
    expect(scoreLine(s, h).propaganda).toBe(RULES.propagandaPoints);
    s.restored[lenin] = true;
    expect(scoreLine(s, h).propaganda).toBe(RULES.exposePoints);
    delete s.restored[lenin];
    cur.warehouse = [{ card: lenin, hidden: true }];
    for (const sp of s.sprouts) sp.progress = 4;
    finalScoring(s);
    const text = s.log.map((l) => l.text).join('\n');
    expect(text).toContain('ЧНЛ у него на Складе и в Тайнике: 1');
    expect(text.match(/Срез: Росток/g)).toHaveLength(1);
  });

  it('ПСС Ленина сдаётся в Красный уголок как Нагрузка (+2т), рядом с обычной Непечатной', () => {
    let s = createGame({ players: players(2), seed: 4, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    const lenin = Object.values(s.cards).find((c) => c.kind === 'loadPropaganda')!.id;
    s.loadDeck = s.loadDeck.filter((c) => c !== lenin);
    const book = s.deck.find((c) => s.cards[c].kind === 'genre')!;
    s.deck = s.deck.filter((c) => c !== book);
    p.capacity = 10;
    p.warehouse = [{ card: lenin, hidden: false }, { card: book, hidden: false }];
    const before = p.talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'redCorner', recycle: [book, lenin] } });
    const after = s.players.find((x) => x.id === me)!;
    expect(after.talons - before).toBe(RULES.redCornerLoad + RULES.redCornerUnprinted);
    expect(after.propagandaDumped).toBe(1);
    expect(s.loadDiscard).toContain(lenin);
  });
});

describe('Ничья', () => {
  it('при равенстве очков в итоге расписано: связи → значки → Талоны', () => {
    const s = createGame({ players: players(2), seed: 4, mode: 'full', curator: false });
    for (const sp of s.sprouts) sp.progress = 3;
    for (const p of s.players) { p.warehouse = []; p.points = 10; p.talons = 3; }
    s.players[1].talons = 5;
    const r = finalScoring(s);
    expect(r.winners).toEqual([s.players[1].id]);
    // 3 и 5 Талонов — по 1 очку за Талоны каждому, итог поровну.
    expect(r.note).toContain('Ничья по очкам (11) → ничья по связям (0) → ничья по значкам (0) → победа по Талонам');
    expect(r.scores.map((x) => x.talonPoints)).toEqual([1, 1]);
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

describe('Журнал: кружок действия', () => {
  it('кружок с номером действия — на строке действия, а не на следствии («↳ Ирония …»)', () => {
    let s = createGame({ players: players(2), seed: 21, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const irony = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.includes('irony'))!;
    s.deck = s.deck.filter((c) => c !== irony);
    const p = s.players.find((x) => x.id === me)!;
    p.capacity = 10;
    p.warehouse.push({ card: irony, hidden: false });
    const start = s.log.length;
    s = applyAction(s, me, { type: 'place', place: { address: 'samizdat', card: irony } });
    const fresh = s.log.slice(start);
    const marked = fresh.filter((l) => l.act);
    expect(marked).toHaveLength(1);
    expect(marked[0].text.startsWith(p.name)).toBe(true);
    expect(fresh.find((l) => l.text.startsWith('↳ Ирония'))?.act).toBeUndefined();
  });
});

describe('Засада на Посиделках', () => {
  function atGathering() {
    let s = createGame({ players: players(3), seed: 8, mode: 'full', forceCurator: true });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    s.phase = 'gathering';
    s.ready = [];
    s.shownAtGathering = {};
    const cur = 'p1';
    const [a, b] = s.players.filter((x) => x.id !== cur).map((x) => x.id);
    const banned = s.deck.filter((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g))).slice(0, 1);
    s.deck = s.deck.filter((c) => !banned.includes(c));
    for (const q of s.players) q.warehouse = q.warehouse.filter((w) => !isBanned(s, w.card));
    const pa = s.players.find((x) => x.id === a)!;
    pa.cache = 1;
    pa.warehouse.push({ card: banned[0], hidden: true });
    return { s, cur, a, b, book: banned[0] };
  }

  it('показ опальной книги в полном режиме — 2 очка; Куратор раскрывается и бьёт Конторой по показавшим', () => {
    let { s, cur, a, b, book } = atGathering();
    const pts = s.players.find((x) => x.id === a)!.points;
    s = applyAction(s, a, { type: 'gathering', show: [book] });
    expect(s.players.find((x) => x.id === a)!.points).toBe(pts + RULES.gatheringPoints);
    s = applyAction(s, b, { type: 'gathering', show: [] });
    s = applyAction(s, cur, { type: 'gathering', show: [] });
    expect(s.phase).toBe('ambush');
    expect(() => applyAction(s, a, { type: 'ambush', go: true })).toThrow(/только Куратор/);
    s = applyAction(s, a, { type: 'ambush', go: false });
    const held = s.players.find((x) => x.id === a)!.held;
    expect(() => applyAction(s, cur, { type: 'ambush', go: true, picks: { [a]: s.deck[0] } })).toThrow(/показанную/);
    s = applyAction(s, cur, { type: 'ambush', go: true, picks: { [a]: book } });
    expect(s.curatorRevealed).toBe(cur);
    expect(s.phase).toBe('hiding');
    expect(s.players.find((x) => x.id === a)!.held).toBe(held + 1);
    expect(s.spetskhran).toContain(book);
    expect(s.players.find((x) => x.id === b)!.held).toBe(0);
    expect(viewFor(s, b).players.find((x) => x.id === cur)!.passion).toBe('curator');
  });

  it('Засаду не на кого устраивать, если опальное показал только сам Куратор', () => {
    let { s, cur, a, b } = atGathering();
    const own = s.deck.find((c) => s.cards[c].kind === 'genre' && isBanned(s, c))!;
    s.deck = s.deck.filter((c) => c !== own);
    s.players.find((x) => x.id === cur)!.warehouse.push({ card: own, hidden: false });
    s = applyAction(s, a, { type: 'gathering', show: [] });
    s = applyAction(s, b, { type: 'gathering', show: [] });
    s = applyAction(s, cur, { type: 'gathering', show: [own] });
    expect(s.phase).toBe('ambush');
    expect(() => applyAction(s, cur, { type: 'ambush', go: true })).toThrow(/не на кого/);
  });

  it('раскрывшийся Куратор на Посиделки не допущен', () => {
    let { s, cur, a, b } = atGathering();
    s.curatorRevealed = cur;
    s.phase = 'orders';
    for (const q of s.players) { q.available = 0; q.bonusGroupTurns = 0; q.subscriptions = []; }
    s.players.find((x) => x.id === s.order[s.turn])!.available = 1;
    s = applyAction(s, s.order[s.turn], { type: 'place', place: { address: 'redCorner', recycle: [] } });
    s = applyAction(s, s.order[s.turn], { type: 'endTurn' });
    expect(s.phase).toBe('gathering');
    expect(s.ready).toEqual([cur]);
    expect(s.log.some((l) => l.text.endsWith('на Посиделки не допущен.'))).toBe(true);
    expect(() => applyAction(s, cur, { type: 'gathering', show: [] })).toThrow();
    s = applyAction(s, a, { type: 'gathering', show: [] });
    s = applyAction(s, b, { type: 'gathering', show: [] });
    expect(s.phase).toBe('hiding');
  });

  it('Драматургия «Разыграть»: в конце поручений +1 за каждую открытую на складе и изданную', () => {
    let { s, a } = atGathering();
    s.phase = 'orders';
    const dramas = s.deck.filter((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.includes('drama')).slice(0, 3);
    s.deck = s.deck.filter((c) => !dramas.includes(c));
    for (const q of s.players) {
      q.available = 0; q.bonusGroupTurns = 0; q.subscriptions = [];
      q.warehouse = q.warehouse.filter((w) => !s.cards[w.card].icons?.includes('drama'));
      q.published = q.published.filter((c) => !s.cards[c].icons?.includes('drama'));
    }
    const pa = s.players.find((x) => x.id === a)!;
    pa.warehouse.push({ card: dramas[0], hidden: false }, { card: dramas[1], hidden: true });
    pa.published.push(dramas[2]);
    const pts = pa.points;
    s.players.find((x) => x.id === s.order[s.turn])!.available = 1;
    s = applyAction(s, s.order[s.turn], { type: 'place', place: { address: 'redCorner', recycle: [] } });
    s = applyAction(s, s.order[s.turn], { type: 'endTurn' });
    expect(s.phase).toBe('gathering');
    expect(s.players.find((x) => x.id === a)!.points).toBe(pts + 2);
  });

  it('если опальное никто не показал, Засады нет — сразу Укрытие', () => {
    let { s } = atGathering();
    for (const p of s.players) s = applyAction(s, p.id, { type: 'gathering', show: [] });
    expect(s.phase).toBe('hiding');
  });
});

describe('Разоблачение', () => {
  // Опцию в тестах включаем явно: в игре её можно выключить.
  const was = RULES.exposePropaganda;
  beforeEach(() => { (RULES as { exposePropaganda: boolean }).exposePropaganda = true; });
  afterEach(() => { (RULES as { exposePropaganda: boolean }).exposePropaganda = was; });

  function withPropaganda() {
    let s = createGame({ players: players(2), seed: 31 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const prop = Object.values(s.cards).find((c) => c.kind === 'propaganda')!.id;
    s.deck = s.deck.filter((c) => c !== prop);
    s.baraholka = s.baraholka.map((c) => (c === prop ? null : c));
    const p = s.players.find((x) => x.id === me)!;
    p.capacity = 10;
    p.warehouse.push({ card: prop, hidden: false });
    return { s, me, prop };
  }

  it('Возвращение смыслов делает ЧНЛ Разоблачением: +2 очка, не опальна, издаётся как книга с 1 значком', () => {
    let { s, me, prop } = withPropaganda();
    expect(isBanned(s, prop)).toBe(true);
    s = applyAction(s, me, { type: 'group', group: { action: 'restore', card: prop } });
    expect(isBanned(s, prop)).toBe(false); // Разоблачение не опально
    const p = () => s.players.find((x) => x.id === me)!;
    const line = finalScoringLine(s, me);
    expect(line).toBe(RULES.exposePoints);
    // Издание — отдельным ходом: начнём с той же раздачи, где смыслы уже возвращены.
    s = withPropaganda().s;
    s.restored[prop] = true;
    const talons = p().talons;
    s = applyAction(s, me, { type: 'place', place: { address: 'samizdat', card: prop } });
    expect(p().talons).toBe(talons + RULES.samizdatTalons);
    expect(p().published).toContain(prop);
    expect(finalScoringLine(s, me)).toBe(RULES.exposePoints);
  });

  it('в сброс книга уходит без жетона смыслов: Разоблачение снова ЧНЛ', () => {
    const { s, prop } = withPropaganda();
    const genre = s.deck.find((c) => s.cards[c].kind === 'genre')!;
    s.restored[prop] = true;
    s.restored[genre] = true;
    discard(s, prop);
    discard(s, genre);
    expect(isPropaganda(s, prop)).toBe(true);
    expect(s.restored[genre]).toBeUndefined();
  });

  it('с выключенной опцией ЧНЛ смыслы не возвращают', () => {
    const { s, me, prop } = withPropaganda();
    (RULES as { exposePropaganda: boolean }).exposePropaganda = false;
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'restore', card: prop } })).toThrow(RuleError);
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

describe('Тиражирование вдогонку', () => {
  it('купив на Развале, можно до конца хода взять оттуда же книгу даром вторым Единомышленником', () => {
    let s = createGame({ players: players(2), seed: 14 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    p.capacity = 10;
    p.talons = 10;
    const avail = p.available;
    const slots = s.razval.map((c, i) => (c && iconsOf(s, c).length ? i : -1)).filter((i) => i >= 0);
    s = applyAction(s, me, { type: 'place', place: { address: 'razval', slot: slots[0] } });
    expect(s.turnDone).toBe(me);
    const free = s.razval[slots[1]]!;
    s = applyAction(s, me, { type: 'group', group: { action: 'copyText', address: 'razval', card: free } });
    const q = s.players.find((x) => x.id === me)!;
    expect(q.warehouse.map((w) => w.card)).toContain(free);
    expect(q.available).toBe(avail - 2);
    expect(q.groupUsed).toContain('copyText');
    expect(s.turnDone).toBe(me);
    // Второй раз вдогонку нельзя, и на другом адресе — тоже.
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'copyText', address: 'razval', card: s.razval.find(Boolean)! } })).toThrow(RuleError);
    s = applyAction(s, me, { type: 'endTurn' });
    expect(s.order[s.turn]).not.toBe(me);
  });
});

describe('Посиделки и Улики', () => {
  it('на Посиделках можно показать Улику: +2 очка', () => {
    let s = createGame({ players: players(2), seed: 3 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const p = s.players[0];
    const ev = s.deck.find((c) => s.cards[c].kind === 'evidence')!;
    p.capacity = 10;
    p.warehouse.push({ card: ev, hidden: false });
    s.phase = 'gathering';
    s.ready = [];
    s.pending = [];
    const before = p.points;
    s = applyAction(s, p.id, { type: 'gathering', show: [ev] });
    expect(s.players[0].points).toBe(before + RULES.gatheringPoints);
    // В журнале строка Посиделок — с кружком игрока.
    expect(s.log.find((l) => l.text.includes('показывает на Посиделках'))?.who).toBe(p.id);
  });

  it('Геолог: строка «↳ Геолог» сразу под строкой показа, без кружка', () => {
    let s = createGame({ players: players(2), seed: 3, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const p = s.players[0];
    s.patrons[0] = { id: 'geologist', genre: s.patrons[0].genre, connections: [p.id], turned: false, removed: false };
    const ev = s.deck.find((c) => s.cards[c].kind === 'evidence')!;
    p.capacity = 10;
    p.warehouse.push({ card: ev, hidden: false });
    s.phase = 'gathering';
    s.ready = [];
    s.pending = [];
    s = applyAction(s, p.id, { type: 'gathering', show: [ev] });
    const i = s.log.findIndex((l) => l.text.includes('показывает на Посиделках'));
    const tail = s.log.slice(i + 1).filter((l) => l.text.startsWith('↳'));
    const geo = tail.find((l) => l.text.startsWith('↳ Геолог: +1'));
    expect(geo).toBeTruthy();
    expect(geo!.who).toBeUndefined();
    expect(s.log.slice(i + 1, i + 1 + tail.length).every((l) => l.text.startsWith('↳'))).toBe(true);
  });
});

describe('Опальное — сразу в Тайник', () => {
  it('купленная открыто опальная книга ложится в Тайник, если есть место; неопальная — нет', () => {
    let s = createGame({ players: players(2), seed: 21 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    p.capacity = 10;
    p.talons = 10;
    p.cache = 1;
    for (const w of p.warehouse) w.hidden = false;
    const banned = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    const free = s.deck.find((c) => s.cards[c].kind === 'genre' && !s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    s.deck = s.deck.filter((c) => c !== banned && c !== free);
    s.tolkuchka = [banned, free];
    const buy = (card: string) => applyAction(s, me, { type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'buy', card }] } })
      .players.find((x) => x.id === me)!.warehouse.find((x) => x.card === card)!;
    expect(buy(banned).hidden).toBe(true);
    expect(buy(free).hidden).toBe(false);
  });
});

describe('Журнал поручений', () => {
  it('запись о поручении помечена номером действия игрока', () => {
    let s = createGame({ players: players(2), seed: 5 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    s = applyAction(s, me, { type: 'place', place: { address: 'zavoz' } });
    const entry = s.log.find((l) => l.act);
    expect(entry).toMatchObject({ act: { player: me, n: 1 } });
    expect(entry!.text).toContain('развозом книг на точки');
  });
});

describe('Лаборант', () => {
  it('на ступени IV — на 1 любой жанровый значок меньше, один раз на всё поручение', () => {
    let s = createGame({ players: players(2), seed: 33, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    s.patrons[0] = { id: 'labtech', genre: s.patrons[0].genre, connections: [me], turned: false, removed: false };
    // Два Ростка на ступени IV (2 значка основного жанра + поддержка). С Лаборантом хватит двух значков основного жанра.
    const [a, b] = s.sprouts;
    a.progress = 3;
    b.progress = 3;
    const mainOf = (id: string) => SPROUTS.find((x) => x.id === id)!.main;
    const [ka, kb] = Object.keys(s.cards).filter((c) => s.cards[c].kind === 'genre').slice(0, 2);
    for (const zone of [s.deck, s.discard, s.tolkuchka, s.knigoobmen, s.raspredelitel, s.razval]) {
      for (const c of [ka, kb]) { const i = zone.indexOf(c); if (i >= 0) zone.splice(i, 1, null as never); }
    }
    s.cards[ka] = { ...s.cards[ka], icons: [mainOf(a.id), mainOf(a.id)] };
    s.cards[kb] = { ...s.cards[kb], icons: [mainOf(b.id), mainOf(b.id)] };
    const p = s.players.find((x) => x.id === me)!;
    p.warehouse = [{ card: ka, hidden: false }, { card: kb, hidden: false }];
    // Сейчас за поручение и так только 1 ступень; проверяем Лаборанта при правиле «несколько ступеней за поручение».
    const limit = RULES.sproutFeedsPerAction;
    RULES.sproutFeedsPerAction = 2;
    try {
      expect(() => applyAction(s, me, { type: 'place', place: { address: 'sprouts', feeds: [{ sprout: a.id, books: [ka] }, { sprout: b.id, books: [kb] }] } }))
        .toThrow(/один раз/);
    } finally {
      RULES.sproutFeedsPerAction = limit;
    }
    const t = applyAction(s, me, { type: 'place', place: { address: 'sprouts', feeds: [{ sprout: a.id, books: [ka] }] } });
    expect(t.sprouts.find((x) => x.id === a.id)!.progress).toBe(4);
    expect(t.log.some((l) => l.text.includes('скидка Лаборанта'))).toBe(true);
    // Без Лаборанта не хватает значка поддержки.
    s.patrons[0] = { ...s.patrons[0], connections: [] };
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'sprouts', feeds: [{ sprout: a.id, books: [ka] }] } })).toThrow();
  });

  it('скидка — только на ступени IV, любой значок, но не два', () => {
    const cards = { cards: {
      p: { kind: 'genre', icons: ['poetry'] }, t: { kind: 'genre', icons: ['testimony'] }, pp: { kind: 'genre', icons: ['poetry', 'poetry'] },
    }, restored: {} } as never;
    // II ступень: 1 значок основного жанра + поддержка — Лаборант не помогает.
    expect(coversStep(cards, ['p'], 'poetry', 1, 'testimony', { labtech: true })).toBe(false);
    expect(coversStep(cards, ['t'], 'poetry', 1, 'testimony', { labtech: true })).toBe(false);
    // IV ступень: 2 основного + поддержка. Можно без поддержки или с одним значком основного жанра.
    expect(coversStep(cards, ['pp'], 'poetry', 2, 'testimony', { labtech: true })).toBe(true);
    expect(coversStep(cards, ['p', 't'], 'poetry', 2, 'testimony', { labtech: true })).toBe(true);
    expect(coversStep(cards, ['p'], 'poetry', 2, 'testimony', { labtech: true })).toBe(false);
    expect(coversStep(cards, ['p', 't'], 'poetry', 2, 'testimony')).toBe(false);
  });
});

describe('Бонус Ростка «Завязать знакомство»', () => {
  it('в полном режиме заменяет Приработок; связь с любым Завсегдатаем без книги, даже с занятым', () => {
    const kvn = SPROUTS.find((x) => x.id === 'kvn')!;
    expect(sproutBonusOptions({ mode: 'full' }, kvn)).toEqual(['hire', 'acquaintance']);
    expect(sproutBonusOptions({ mode: 'beginner' }, kvn)).toEqual(['hire', 'sideJob']);
    let s = createGame({ players: players(2), seed: 5, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    const target = s.patrons[1];
    target.turned = true;
    const books = p.warehouse.length;
    s.pending = [{ kind: 'sproutBonus', player: me, sprout: 'kvn', options: ['hire', 'acquaintance'] }];
    expect(() => applyAction(s, me, { type: 'sproutBonus', bonus: 'acquaintance' })).toThrow(/Завсегдатая/);
    s = applyAction(s, me, { type: 'sproutBonus', bonus: 'acquaintance', patron: target.id });
    expect(s.patrons[1].connections).toContain(me);
    expect(s.players.find((x) => x.id === me)!.warehouse.length).toBe(books);
  });
});

describe('Несистемный (одиночная игра)', () => {
  const solo = (seed: number, mode: 'beginner' | 'full' = 'full') => createGame({ players: [{ id: 'p1', name: 'Один' }], seed, mode });

  it('3 Ростка (в Райцентре — 2), без Куратора в Пристрастиях', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = solo(seed);
      expect(s.solo).toBe(true);
      expect(s.sprouts).toHaveLength(RULES.soloSprouts.full);
      expect(solo(seed, 'beginner').sprouts).toHaveLength(RULES.soloSprouts.beginner);
      expect(s.players[0].passionOptions).not.toContain('curator');
      expect(s.curatorPossible).toBeFalsy();
    }
  });

  it('Цензура растёт на 1 каждую Пятилетку, со 2-й — лишний жетон бьёт по Клубу', () => {
    const rand = seeded(5);
    let s = solo(7);
    const seen: number[] = [];
    let round = 0;
    for (let i = 0; i < 5000 && s.phase !== 'end'; i++) {
      if (s.round !== round && s.phase === 'orders') {
        round = s.round;
        seen.push(s.censorship);
        if (round >= 2) expect(s.log.some((l) => l.round === round && l.text.startsWith('Несистемный: на действие Конторы вытянут жетон'))).toBe(true);
      }
      s = playOut(s, rand, 1);
    }
    expect(seen).toEqual([3, 4, 5, 6, 7]);
    // За 4 Пятилетки — 4 жетона; за каждым — Профилактика или Контора (её может отвести Психиатр).
    const after = s.log.flatMap((l, i) => (l.text.startsWith('Несистемный: на действие Конторы вытянут жетон') ? [s.log[i + 1].text] : []));
    expect(after).toHaveLength(4);
    for (const t of after) expect(t).toMatch(/^Профилактика|^Контора удерживает|Психиатр/);
  });

  it('в конце вскрываются верхние Непечатные: ЧНЛ срезает самый развитый Росток', () => {
    let s = solo(3, 'full');
    s = applyAction(s, 'p1', { type: 'choosePassion', passion: s.players[0].passionOptions[0] });
    s = startOrders(s);
    s.sprouts.forEach((sp, i) => { sp.progress = i === 0 ? 4 : 3; });
    const prop = Object.keys(s.cards).filter((c) => s.cards[c].kind === 'propaganda');
    const plain = s.deck.filter((c) => s.cards[c].kind !== 'propaganda');
    // Сверху колоды две ЧНЛ: первая срежет IV ступень, вторая — уже ступень III.
    s.deck = [...plain.slice(0, 40), prop[0], prop[1]];
    const r = finalScoring(s);
    expect(s.sprouts.map((x) => x.progress).sort()).toEqual([2, 3, 3]);
    expect(r.glasnost).toBe(false);
    expect(r.winners).toEqual([]);
  });

  it('Гласность устояла — победа', () => {
    let s = solo(4, 'beginner');
    s = applyAction(s, 'p1', { type: 'choosePassion', passion: s.players[0].passionOptions[0] });
    s = startOrders(s);
    s.sprouts.forEach((sp) => { sp.progress = 4; });
    const r = finalScoring(s);
    expect(r.winners).toEqual(['p1']);
  });
});

describe('Стартовый Тайник', () => {
  it('опальные стартовые книги сразу лежат в Тайнике, если есть место', () => {
    let checked = 0;
    for (let seed = 1; seed <= 40; seed++) {
      let s = createGame({ players: players(3), seed });
      for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
      expect(s.phase).toBe('setupCache');
      for (const p of s.players) {
        const banned = p.warehouse.filter((w) => isBanned(s, w.card) && !isPropaganda(s, w.card));
        const hidden = p.warehouse.filter((w) => w.hidden);
        expect(hidden.length).toBe(Math.min(banned.length, cacheLimit(s, p)));
        for (const w of hidden) expect(isBanned(s, w.card)).toBe(true);
        if (hidden.length) checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('мест мало: сперва книга с большим числом значков, затем жанр Пристрастия', () => {
    let s = createGame({ players: players(2), seed: 3 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    // Переиграть стартовую раскладку на подобранном Складе.
    const p = s.players[0];
    const passion = PASSIONS[p.passion!];
    const banned = Object.keys(s.cards).filter((c) => isBanned(s, c) && s.cards[c].kind === 'genre');
    const two = banned.find((c) => iconsOf(s, c).length === 2)!;
    const fav = banned.find((c) => iconsOf(s, c).length === 1 && passion.genres?.includes(iconsOf(s, c)[0]));
    const plain = banned.find((c) => iconsOf(s, c).length === 1 && !passion.genres?.includes(iconsOf(s, c)[0]))!;
    expect(two && plain).toBeTruthy();
    const take = (list: string[]) => {
      p.warehouse = list.map((card) => ({ card, hidden: false }));
      startHide(s, p);
      return p.warehouse.filter((w) => w.hidden).map((w) => w.card);
    };
    // Без Нагрузки на Складе — 1 место в Тайнике.
    p.cache = 1;
    expect(take([plain, two])).toEqual([two]);
    if (fav) expect(take([plain, fav])).toEqual([fav]);
  });
});

describe('Выбор Пристрастий', () => {
  it('видны свои стартовые книги, но не стол и не чужие книги', () => {
    const s = createGame({ players: players(3), seed: 12, mode: 'full' });
    expect(s.phase).toBe('passion');
    expect(s.razval.some(Boolean)).toBe(true);
    const v = viewFor(s, 'p1');
    const me = v.players.find((p) => p.id === 'p1')!;
    expect(me.warehouse.every((w) => w.card)).toBe(true);
    for (const p of v.players.filter((x) => x.id !== 'p1')) expect(p.warehouse.every((w) => w.card === null)).toBe(true);
    expect(v.razval.every((c) => c === null)).toBe(true);
    expect(v.baraholka.every((x) => !x)).toBe(true);
    expect(v.tolkuchka).toEqual([]);
    expect(v.sprouts).toEqual([]);
    // Опала первой Пятилетки уже известна.
    expect(v.banned).toEqual(s.banned);
    expect(v.banned).toHaveLength(s.censorship);
    expect(v.patrons).toEqual([]);
    // Наблюдатель-хост видит всё.
    expect(viewFor(s, null, true).razval.some(Boolean)).toBe(true);
  });
});

describe('«Назад» в своём ходу: узнал ли игрок новое', () => {
  const start = () => {
    let s = createGame({ players: players(2), seed: 21 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    return startOrders(s);
  };

  it('Барахолка: увидел закрытые книги — новое', () => {
    const s = start();
    const me = s.order[s.turn];
    const next = applyAction(s, me, { type: 'place', place: { address: 'baraholka', slots: [0, 1] } });
    expect(gainedInfo(s, next, me)).toBe(true);
  });

  it('Развоз: Развал обновился новыми книгами — новое', () => {
    const s = start();
    const me = s.order[s.turn];
    const next = applyAction(s, me, { type: 'place', place: { address: 'zavoz' } });
    expect(gainedInfo(s, next, me)).toBe(true);
  });

  it('Закладка Тайника — ничего нового, можно вернуться', () => {
    const s = start();
    const me = s.order[s.turn];
    const next = applyAction(s, me, { type: 'group', group: { action: 'expandCache' } });
    expect(next.turnDone).toBe(me);
    expect(gainedInfo(s, next, me)).toBe(false);
  });

  it('Тайник переложен — ничего нового', () => {
    const s = start();
    const me = s.order[s.turn];
    const p = s.players.find((x) => x.id === me)!;
    const next = applyAction(s, me, { type: 'hiding', hidden: p.warehouse.slice(0, 1).map((w) => w.card) });
    expect(gainedInfo(s, next, me)).toBe(false);
  });
});

describe('Заповедник', () => {
  it('полный режим без Конторы, Куратора и Психиатра; облава никого не удерживает', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const s = createGame({ players: players(4), seed, reserve: true });
      expect(s.mode).toBe('full');
      expect(s.reserve).toBe(true);
      expect(s.curatorPossible).toBeFalsy();
      for (const p of s.players) expect(p.passionOptions).not.toContain('curator');
      expect(s.patrons.map((x) => x.id)).not.toContain('psychiatrist');
      expect(s.patrons.length).toBeGreaterThan(0);
    }
    let s = createGame({ players: players(2), seed: 5, reserve: true });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'kontora' } })).toThrow(/нет на столе/);
    expect(() => applyAction(s, me, { type: 'group', group: { action: 'rescue', returns: {} } })).toThrow(/нет/);
    // Партия доигрывается, и Контора никого не держит.
    const end = playOut(s, seeded(5), 6000);
    expect(end.phase).toBe('end');
    expect(end.players.every((p) => p.held === 0)).toBe(true);
  });
});

describe('Ростки: места', () => {
  it('у адреса мест сколько угодно, но у одного Ростка — не больше 2 ступеней за Пятилетку', () => {
    let s = createGame({ players: players(2), seed: 8 });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const sp = s.sprouts[0];
    const info = SPROUTS.find((x) => x.id === sp.id)!;
    // «Волшебные» книги: значки основного жанра и всех жанров поддержки — закрывают любую из первых ступеней.
    const magic = Object.keys(s.cards).filter((c) => s.cards[c].kind === 'genre').slice(0, 3);
    for (const c of magic) s.cards[c] = { ...s.cards[c], icons: [info.main, info.main, ...info.steps.map((st) => st.support).filter(Boolean)] as Genre[] };
    for (const p of s.players) p.warehouse = magic.map((card) => ({ card, hidden: false }));
    const feed = (st: GameState, card: string) => {
      const who = st.order[st.turn];
      st = applyAction(st, who, { type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: [card] }] } });
      // Бонус Ростка: берём первый, который не требует дополнительного выбора.
      const pend = st.pending[0] as { kind: string; options: string[] } | undefined;
      if (pend?.kind === 'sproutBonus') {
        const next = pend.options.map((bonus) => { try { return applyAction(st, who, { type: 'sproutBonus', bonus } as never); } catch { return null; } }).find(Boolean);
        st = next ?? applyAction(st, who, { type: 'pass' });
      }
      return st.turnDone === who ? applyAction(st, who, { type: 'endTurn' }) : st;
    };
    s = feed(s, magic[0]);
    s = feed(s, magic[1]);
    expect(s.sprouts[0].progress).toBe(2);
    const who = s.order[s.turn];
    expect(() => applyAction(s, who, { type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: [magic[2]] }] } }))
      .toThrow(/ждите следующей/);
    expect(limitFor('sprouts', 4)).toBe(Infinity);
  });
});

describe('Спецхран и Проза', () => {
  it('в полном режиме Спецхран с начала партии хранит 5 Непечатных; в Райцентре и Заповеднике — пуст', () => {
    const full = createGame({ players: players(3), seed: 4, mode: 'full' });
    expect(full.spetskhran).toHaveLength(RULES.spetskhranStart);
    expect(viewFor(full, 'p1').spetskhranCount).toBe(RULES.spetskhranStart);
    expect(createGame({ players: players(3), seed: 4 }).spetskhran).toHaveLength(0);
    expect(createGame({ players: players(3), seed: 4, reserve: true }).spetskhran).toHaveLength(0);
  });

  it('Проза «Вдохновиться» — не больше 1 очка, сколько бы прозы ни было', () => {
    const s = createGame({ players: players(2), seed: 6, mode: 'full' });
    const p = s.players[0];
    const prose = Object.keys(s.cards).filter((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.includes('prose')).slice(0, 3);
    p.warehouse = prose.map((card) => ({ card, hidden: false }));
    expect(proseBonus(s, p)).toBe(1);
  });
});

describe('Журнал: конец партии и Барахолка', () => {
  it('победитель — самой последней строкой (с кружком); на Барахолке — сначала покупка, потом «взакрытую в Тайник»', () => {
    const s = playOut(createGame({ players: players(3), seed: 905, mode: 'full' }));
    const last = s.log[s.log.length - 1];
    expect(s.result!.winners.length).toBeGreaterThan(0);
    expect(last.winners).toEqual(s.result!.winners);
    expect(last.text).toMatch(/^Победа: /);
    expect(s.log.some((l) => l.text.includes('вслепую') && s.log[s.log.indexOf(l) + 1]?.text.includes('покупает книгу на Барахолке'))).toBe(false);
  });
});

describe('Журнал: усилилась ли Цензура', () => {
  it('в каждой новой Пятилетке — отдельной строкой; в одиночной игре — нет', () => {
    const s = playOut(createGame({ players: players(3), seed: 905, mode: 'full' }));
    expect(s.log.filter((l) => /^Цензура (усилилась: \d → \d|не усилилась: \d)\.$/.test(l.text)).length).toBe(RULES.rounds - 1);
    const solo = playOut(createGame({ players: players(1), seed: 905, mode: 'full' }));
    expect(solo.log.some((l) => /^Цензура (не )?усилилась/.test(l.text))).toBe(false);
  });
});

describe('Журнал: выкладка в начале Пятилетки', () => {
  it('перечисляет все книги на открытых адресах, и те, что уже бывали на столе', () => {
    const s = playOut(createGame({ players: players(3), seed: 905, mode: 'full' }));
    for (let i = 0; i < s.log.length; i++) {
      if (!/^Пятилетка [2-5]\.$/.test(s.log[i].text)) continue;
      const line = s.log.slice(i, i + 10).find((l) => l.text.startsWith('На Толкучку'));
      expect(line?.text.match(/•/g)?.length).toBe(RULES.displaySize);
    }
  });
});

describe('Журнал: возвращаемая Нагрузка', () => {
  it('пишется со второй книгой и её значками, пока смыслы не возвращены', () => {
    const s = createGame({ players: players(2), seed: 1 });
    const id = Object.keys(s.cards).find((c) => s.cards[c].kind === 'loadReturnable' && s.cards[c].title === 'Туманность Андромеды')!;
    expect(title(s, id)).toBe('[Нагрузка] «Туманность Андромеды» / [ФА ФА ФА] «Час Быка»');
    s.restored[id] = true;
    expect(title(s, id)).toBe('[ФА ФА ФА] «Туманность Андромеды»');
  });
});

describe('Подозрение: питание ступеней II–IV', () => {
  it('каждое питание ступени II–IV немного снижает подозрение', () => {
    let s = createGame({ players: players(3), seed: 15, mode: 'full', forceCurator: true });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const [a, b] = s.players;
    b.denounces = 2; // подозрение +50%, без потолка в 100%
    const base = curatorSuspicion(s, a.id)[b.id];
    b.sproutsFed = [s.sprouts[0].id];
    b.fedSteps = [1];
    const low = curatorSuspicion(s, a.id)[b.id];
    b.fedSteps = [1, 2, 3];
    const high = curatorSuspicion(s, a.id)[b.id];
    expect(low).toBeLessThan(base);
    expect(high).toBeLessThan(low);
    expect(curatorSuspicionDetail(s, a.id)[b.id].parts.some((x) => x.startsWith('питал ступени II–IV ×2'))).toBe(true);
  });
});

describe('ЧНЛ, розданная при раскладке', () => {
  it('все видели её на складе — подозрение «держит известную всем ЧНЛ», пока её не сдали и не разоблачили', () => {
    let s = createGame({ players: players(3), seed: 15, mode: 'full', forceCurator: true });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    const p = s.players[1];
    const lenin = Object.keys(s.cards).find((c) => s.cards[c].kind === 'loadPropaganda')!;
    for (const zone of [s.deck, s.loadDeck, s.discard, s.loadDiscard]) { const i = zone.indexOf(lenin); if (i >= 0) zone.splice(i, 1); }
    for (const q of s.players) q.warehouse = q.warehouse.filter((w) => w.card !== lenin);
    p.warehouse.push({ card: lenin, hidden: false });
    s = startOrders(s);
    expect(s.players[1].propagandaDealt).toBe(1);
    const other = s.players.find((x) => x.id !== p.id)!;
    const detail = curatorSuspicionDetail(s, other.id)[p.id];
    expect(detail.parts.some((x) => x.startsWith('держит известную всем ЧНЛ'))).toBe(true);
  });
});

describe('Контора: донос', () => {
  it('донос — только на чужую книгу; Профилактика — только Завсегдатаю, связанному с тем, на кого донос', () => {
    let s = createGame({ players: players(3), seed: 15, mode: 'full', curator: false });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const [a, b] = s.order.filter((x) => x !== me);
    for (const q of s.players) q.warehouse = q.warehouse.filter((w) => !isBanned(s, w.card));
    const banned = s.deck.filter((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g))).slice(0, 2);
    s.deck = s.deck.filter((c) => !banned.includes(c));
    // Опальная книга только у себя — в Контору не пойти.
    s.players.find((x) => x.id === me)!.warehouse.push({ card: banned[0], hidden: false });
    expect(() => applyAction(s, me, { type: 'place', place: { address: 'kontora' } })).toThrow(/доносить не на что/);
    s.players.find((x) => x.id === a)!.warehouse.push({ card: banned[1], hidden: false });
    s = applyAction(s, me, { type: 'place', place: { address: 'kontora' } });
    expect(() => applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { handout: true, denounce: { player: me, card: banned[0] } } }))
      .toThrow(/другого игрока/);
    const pa = s.patrons.find((x) => !x.removed)!;
    const pb = s.patrons.find((x) => !x.removed && x.id !== pa.id)!;
    pa.connections = [a];
    pb.connections = [b];
    expect(() => applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { prophylaxis: pb.id, denounce: { player: a, card: banned[1] } } }))
      .toThrow(/Профилактика/);
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { prophylaxis: pa.id, denounce: { player: a, card: banned[1] } } });
    expect(s.patrons.find((x) => x.id === pa.id)!.removed).toBe(true);
  });

  it('Психиатр защищает и в том походе в Контору, которым его профилактируют', () => {
    let s = createGame({ players: players(3), seed: 15, mode: 'full', curator: false });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const [a] = s.order.filter((x) => x !== me);
    for (const q of s.players) q.warehouse = q.warehouse.filter((w) => !isBanned(s, w.card));
    const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    s.deck = s.deck.filter((c) => c !== book);
    s.players.find((x) => x.id === a)!.warehouse.push({ card: book, hidden: false });
    s.patrons[0] = { id: 'psychiatrist', genre: s.patrons[0].genre, connections: [a], turned: false, removed: false };
    s = applyAction(s, me, { type: 'place', place: { address: 'kontora' } });
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { prophylaxis: 'psychiatrist', denounce: { player: a, card: book } } });
    expect(s.patrons[0].removed).toBe(true);
    expect(s.players.find((x) => x.id === a)!.held).toBe(0);
    expect(s.log.some((l) => l.text.includes('Психиатр напоследок'))).toBe(true);
  });
});

describe('Контора: Изъятие в конце', () => {
  it('книгу из доноса изымают после Выдачи на руки — взять её оттуда в том же походе нельзя', () => {
    let s = createGame({ players: players(3), seed: 15, mode: 'full', curator: false });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const [a] = s.order.filter((x) => x !== me);
    const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    s.deck = s.deck.filter((c) => c !== book);
    s.players.find((x) => x.id === a)!.warehouse.push({ card: book, hidden: false });
    s.players.find((x) => x.id === me)!.capacity = 10;
    s = applyAction(s, me, { type: 'place', place: { address: 'kontora' } });
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { handout: true, denounce: { player: a, card: book } } });
    const pend = s.pending[0];
    expect(pend.kind).toBe('kontoraHandout');
    expect(pend.kind === 'kontoraHandout' && pend.cards).not.toContain(book);
    expect(s.players.find((x) => x.id === a)!.warehouse.some((w) => w.card === book)).toBe(true);
    const take = pend.kind === 'kontoraHandout' ? pend.cards[0] : '';
    s = applyAction(s, me, { type: 'kontoraHandout', card: take });
    expect(s.spetskhran).toContain(book);
    expect(s.players.find((x) => x.id === a)!.warehouse.some((w) => w.card === book)).toBe(false);
  });
});

describe('Ходатайство', () => {
  it('возвращает не больше 1 Единомышленника', () => {
    let s = createGame({ players: players(3), seed: 15, mode: 'full', curator: false });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    s = startOrders(s);
    const me = s.order[s.turn];
    const [a, b] = s.order.filter((x) => x !== me);
    for (const id of [a, b]) { const q = s.players.find((x) => x.id === id)!; q.held = 1; q.available--; }
    const book = s.deck.find((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g)))!;
    s.deck = s.deck.filter((c) => c !== book);
    s.players.find((x) => x.id === a)!.warehouse.push({ card: book, hidden: false });
    s = applyAction(s, me, { type: 'place', place: { address: 'kontora' } });
    expect(() => applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { petition: [a, b], denounce: { player: a, card: book } } }))
      .toThrow(/1 Единомышленника/);
    s = applyAction(s, me, { type: 'kontoraDecide', go: true, choice: { petition: [b], denounce: { player: a, card: book } } });
    expect(s.players.find((x) => x.id === b)!.held).toBe(0);
    // Книгу из доноса изымают всегда.
    expect(s.players.find((x) => x.id === a)!.warehouse.some((w) => w.card === book)).toBe(false);
    expect(s.spetskhran).toContain(book);
  });
});

describe('Инерция цензуры', () => {
  it('со 2-й Пятилетки из опалы выходит самый старый жанр, взамен приходят новые', () => {
    const was = RULES.censorshipShift;
    RULES.censorshipShift = 'inertia';
    try {
    for (let seed = 1; seed <= 6; seed++) {
      let s = createGame({ players: players(2), seed });
      const first = [...s.banned];
      const rand = seeded(seed);
      while (s.round === 1 && s.phase !== 'end') s = playOut(s, rand, 1);
      while (s.phase !== 'orders') s = playOut(s, rand, 1);
      expect(s.round).toBe(2);
      expect(s.banned).toHaveLength(s.censorship);
      expect(s.banned).not.toContain(first[0]); // самый старый вышел
      for (const g of first.slice(1)) expect(s.banned).toContain(g); // остальные остались
      expect(s.banned.slice(0, first.length - 1)).toEqual(first.slice(1)); // и стали старшими
    }
    } finally {
      RULES.censorshipShift = was;
    }
  });
});

describe('Окостенение цензуры', () => {
  it('выходит самый свежий опальный жанр, старые остаются', () => {
    const was = RULES.censorshipShift;
    RULES.censorshipShift = 'ossified';
    try {
      for (let seed = 1; seed <= 6; seed++) {
        let s = createGame({ players: players(2), seed });
        const first = [...s.banned];
        const rand = seeded(seed);
        while (s.round === 1 && s.phase !== 'end') s = playOut(s, rand, 1);
        while (s.phase !== 'orders') s = playOut(s, rand, 1);
        expect(s.banned).toHaveLength(s.censorship);
        expect(s.banned.slice(0, first.length - 1)).toEqual(first.slice(0, -1)); // старые на месте
      }
    } finally {
      RULES.censorshipShift = was;
    }
  });
});

describe('Журнал: стартовая сводка', () => {
  it('Ростки, Завсегдатаи и стартовые книги; Тайник — только хозяину', () => {
    let s = createGame({ players: players(3), seed: 3, mode: 'full' });
    expect(s.log.some((l) => l.text.startsWith('Ростки Гласности:'))).toBe(true);
    expect(s.log.some((l) => l.text.startsWith('Завсегдатаи Клуба'))).toBe(true);
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    const [a, b] = s.players;
    for (const p of s.players) s = applyAction(s, p.id, { type: 'hiding', hidden: p.id === a.id ? [p.warehouse[0].card] : [] });
    expect(s.phase).toBe('orders');
    const secret = `${a.name} прячет в Тайнике:`;
    expect(viewFor(s, a.id).log.some((l) => l.text.startsWith(secret))).toBe(true);
    expect(viewFor(s, b.id).log.some((l) => l.text.startsWith(secret))).toBe(false);
    expect(viewFor(s, b.id).log.some((l) => l.text.startsWith(`${a.name} на складе на виду`))).toBe(true);
  });
});

describe('Историк', () => {
  it('вдвое за Улики и Разоблачения, ничего за жанровые книги', () => {
    const s = createGame({ players: players(3), seed: 4, mode: 'full' });
    const p = s.players[0];
    p.passion = 'historian';
    const ev = Object.values(s.cards).find((c) => c.kind === 'evidence')!.id;
    const prop = Object.values(s.cards).find((c) => c.kind === 'propaganda')!.id;
    const book = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 2)!.id;
    s.restored[prop] = true;
    p.capacity = 10;
    p.warehouse = [{ card: ev, hidden: false }, { card: prop, hidden: false }, { card: book, hidden: false }];
    expect(passionPoints(s, p)).toBe(RULES.evidencePoints + RULES.exposePoints);
    const line = scoreLine(s, p);
    expect(line.evidence + line.propaganda + line.passion).toBe(2 * (RULES.evidencePoints + RULES.exposePoints));
  });

  it('раздаётся только в партиях с Куратором', () => {
    const dealt = (opts: { mode: 'full' | 'beginner'; curator?: boolean }) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 40; seed++) {
        const s = createGame({ players: players(4), seed, ...opts });
        for (const p of s.players) p.passionOptions.forEach((x) => seen.add(x));
      }
      return seen;
    };
    expect(dealt({ mode: 'full' }).has('historian')).toBe(true);
    expect(dealt({ mode: 'full', curator: false }).has('historian')).toBe(false);
    expect(dealt({ mode: 'beginner' }).has('historian')).toBe(false);
  });
});

describe('Впятером', () => {
  it('у явочных адресов +1 место; Единомышленников, как всегда, 5; Ростков — по числу игроков', () => {
    const s = createGame({ players: players(5), seed: 3, mode: 'full' });
    expect(s.players).toHaveLength(5);
    for (const p of s.players) expect(p.workers).toBe(RULES.startWorkers);
    expect(s.sprouts).toHaveLength(5);
    expect(createGame({ players: players(3), seed: 3, mode: 'full', reserve: true }).sprouts).toHaveLength(4);
    expect(limitFor('knigoobmen', 5)).toBe(limitFor('knigoobmen', 4) + 1);
    expect(limitFor('agitpunkt', 5)).toBe(2);
    expect(limitFor('razval', 5)).toBe(limitFor('razval', 4));
    expect(createGame({ players: players(4), seed: 3, mode: 'full' }).players[0].workers).toBe(RULES.startWorkers);
  });
});

describe('подсказка книг для Ростка', () => {
  const info = {
    restored: {},
    cards: {
      a: { kind: 'book', icons: ['poetry', 'poetry'] },
      b: { kind: 'book', icons: ['poetry'] },
      c: { kind: 'book', icons: ['poetry', 'prose'] },
      d: { kind: 'book', icons: ['prose', 'prose', 'prose'] },
      e: { kind: 'book', icons: ['scifi'] },
    },
  } as unknown as Pick<GameState, 'cards' | 'restored'>;
  it('выбирает набор с наименьшим числом значков', () => {
    // Ступень: 2 значка Поэзии + Проза. Лучше всего «c» и «b» (3 значка), а не «a» и «d» (5).
    expect(bestFeedBooks(info, ['a', 'b', 'c', 'd'], 'poetry', 2, 'prose')!.books.sort()).toEqual(['b', 'c']);
    expect(bestFeedBooks(info, ['a', 'b'], 'poetry', 2, 'prose')).toBeNull();
    // Фантастика-джокер и Лаборант.
    expect(bestFeedBooks(info, ['a', 'e'], 'poetry', 2, 'prose', { wildScifi: true })!.books.sort()).toEqual(['a', 'e']);
    expect(bestFeedBooks(info, ['a', 'd'], 'poetry', 2, 'prose', { labtech: true })).toEqual({ books: ['a'], labtech: true });
  });
});

describe('«Чукоккала» — значок любого жанра', () => {
  const setup = () => {
    let s = createGame({ players: players(3), seed: 9, mode: 'full' });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
    const ch = Object.keys(s.cards).find((c) => s.cards[c].wild)!;
    s.deck = s.deck.filter((c) => c !== ch);
    const p = s.players[0];
    p.warehouse = [{ card: ch, hidden: false }];
    return { s, p, ch };
  };

  it('один значок: жанра нужного в каждом подсчёте; опальна, если в опале хоть один жанр; свойств жанров нет', () => {
    const { s, p, ch } = setup();
    expect(s.cards[ch].title).toBe('Чукоккала');
    expect(iconsOf(s, ch)).toEqual([]); // для жанровых свойств значков нет
    expect(isBanned(s, ch)).toBe(true);
    expect(isBanned({ ...s, banned: [] }, ch)).toBe(false);
    expect(title(s, ch)).toBe('[Любой жанр] «Чукоккала»');
    // Ростки: закрывает 1 значок основного жанра или поддержки — но не два сразу.
    expect(coversStep(s, [ch], 'drama', 1)).toBe(true);
    const other = Object.keys(s.cards).find((c) => s.cards[c].kind === 'genre' && iconsOf(s, c).length === 1 && iconsOf(s, c)[0] === 'drama')!;
    expect(coversStep(s, [other, ch], 'drama', 1, 'poetry')).toBe(true);
    expect(coversStep(s, [ch], 'drama', 1, 'poetry')).toBe(false);
    // Пристрастия: 1 значок нужного жанра.
    p.passion = 'keeper_golden';
    expect(passionPoints(s, p)).toBe(RULES.passionKeeper);
    // Проза «Вдохновиться» её не считает.
    expect(proseBonus(s, p)).toBe(0);
  });

  it('в Клубе — связь с любым Завсегдатаем; Возвращение смыслов — ещё значок любого жанра', () => {
    const { s, p, ch } = setup();
    s.phase = 'orders';
    s.turn = s.order.indexOf(p.id);
    const pt = s.patrons.find((x) => x.genre !== 'album')!;
    const t = applyAction(s, p.id, { type: 'clubGift', gift: { patron: pt.id, card: ch } } as never);
    expect(t.patrons.find((x) => x.id === pt.id)!.connections).toContain(p.id);
    const r = applyAction(s, p.id, { type: 'group', group: { action: 'restore', card: ch } } as never);
    expect(iconCount(r, ch)).toBe(2);
    expect(title(r, ch)).toBe('[Любой жанр ×2] «Чукоккала»');
    // Два значка — любых жанров: и два основного, и основной с поддержкой.
    expect(coversStep(r, [ch], 'drama', 2)).toBe(true);
    expect(coversStep(r, [ch], 'drama', 1, 'poetry')).toBe(true);
    const q = r.players.find((x) => x.id === p.id)!;
    q.passion = 'keeper_golden';
    expect(passionPoints(r, q)).toBe(2 * RULES.passionKeeper);
  });
});

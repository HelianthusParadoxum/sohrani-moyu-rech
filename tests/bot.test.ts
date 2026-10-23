import { describe, expect, it } from 'vitest';
import { activePlayers as activePlayersOf, applyAction, createGame } from '../src/engine/engine';
import { botMove, playOut } from '../src/engine/bot';
import { curatorSuspicion, effectiveCuratorStyle, rankActions } from '../src/engine/bot-smart';
import { BOT_BASE, BOT_GOALS, BOT_PRESETS, CURATOR_STYLES, curatorStyle, curatorStyleNote, presetById } from '../src/engine/bot-presets';
import { isBanned, isGenreBook } from '../src/engine/util';
import type { GameState } from '../src/engine/types';

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
    ...s.deck, ...s.discard, ...s.loadDeck, ...s.loadDiscard, ...s.tolkuchka, ...s.knigoobmen, ...s.raspredelitel, ...(s.agitpunkt ?? []),
    ...s.razval.filter((c): c is string => !!c), ...s.baraholka.filter((c): c is string => !!c),
    ...s.players.flatMap((p) => [...p.warehouse.map((w) => w.card), ...p.published]),
    ...s.spetskhran,
  ];
}

// Партия, где все выбрали Пристрастие и идёт первая Пятилетка.
function started(seed: number, n = 3): GameState {
  let s = createGame({ players: players(n), seed });
  for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
  s = startOrders(s);
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
        expect(cards.length).toBe(132);
        expect(new Set(cards).size).toBe(132);
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

  it('не подглядывает в Спецхран: знает только изъятое при всех и виденное при Выдаче на руки', () => {
    const preset = presetById('bookman');
    let checked = 0;
    for (let seed = 1; seed <= 6 && checked < 2; seed++) {
      let a = createGame({ players: players(3), seed, mode: 'full', curator: true });
      const me = a.order[0];
      for (const p of a.players) {
        const passion = p.id === me ? 'curator' : p.passionOptions.find((x) => x !== 'curator')!;
        if (!p.passionOptions.includes(passion)) p.passionOptions = [passion, p.passionOptions[0]];
        a = applyAction(a, p.id, { type: 'choosePassion', passion });
      }
      a = startOrders(a);
      const rand = seeded(seed);
      // Доигрываем до хода Куратора, когда ему доступна Контора.
      for (let i = 0; i < 400 && a.phase !== 'end'; i++) {
        const who = a.pending[0]?.player ?? (a.phase === 'orders' ? a.order[a.turn] : null);
        if (who === me && a.phase === 'orders' && !a.pending.length && !a.turnDone
          && rankActions(a, me, preset, seeded(1)).some((r) => r.a.type === 'place' && r.a.place.address === 'kontora')) break;
        a = botMove(a, activePlayersOf(a)[0], rand);
      }
      if (a.phase !== 'orders' || a.order[a.turn] !== me) continue;
      // В одном варианте вся Пропаганда из стопки — в незнакомой ему части Спецхрана, в другом её там нет.
      // Куратору это очень важно (Выдача на руки), но знать этого он не может.
      const known = a.spetskhranSeen?.[me] ?? [];
      const unknown = a.spetskhran.filter((c) => !known.includes(c));
      const prop = a.deck.filter((c) => a.cards[c].kind === 'propaganda').slice(0, unknown.length);
      if (!prop.length) continue;
      const b: GameState = structuredClone(a);
      const out = unknown.slice(0, prop.length);
      a.deck = [...a.deck.filter((c) => !prop.includes(c)), ...out];
      a.spetskhran = [...a.spetskhran.filter((c) => !out.includes(c)), ...prop];
      expect(rankActions(a, me, preset, seeded(5)).map((r) => r.a)).toEqual(rankActions(b, me, preset, seeded(5)).map((r) => r.a));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it('журнал: «Пятилетка N» отдельной жирной строкой, затем порядок хода, цензура, затем новый явочный адрес; Куратор — жирным', () => {
    let s = createGame({ players: players(3), seed: 4, mode: 'full', curator: true });
    const rand = seeded(4);
    for (let i = 0; i < 3000 && s.round < 2; i++) s = botMove(s, activePlayersOf(s)[0], rand);
    const k = s.log.findIndex((l) => l.text === 'Пятилетка 2.');
    expect(k).toBeGreaterThan(0);
    expect(s.log[k].strong).toBe(true);
    expect(s.log[k + 1].text).toMatch(/^Порядок хода: /);
    expect(s.log[k + 1].order).toEqual(s.order);
    expect(s.log[k + 2].text).toMatch(/^Цензура: /);
    expect(s.log[k + 3].text).toMatch(/^Открылся новый явочный адрес/);
    const cur = s.log.find((l) => /^Ваше Пристрастие .*Куратор/.test(l.text));
    if (cur) expect(cur.strong).toBe(true);
  }, 60_000);

  it('не перекладывает Тайник без конца (партия с Куратором-«Удавом» доигрывается)', () => {
    const i = 8;
    let s = createGame({ players: Array.from({ length: 3 }, (_, k) => ({ id: `p${k}`, name: `Бот ${k}` })), seed: 9000 + i, mode: 'full', curator: true });
    const cid = `p${i % 3}`;
    for (const p of s.players) {
      if (p.id === cid) p.passionOptions = ['curator', p.passionOptions.find((x) => x !== 'curator')!];
      else p.passionOptions = p.passionOptions.map((x) => (x === 'curator' ? 'erudite' : x));
    }
    let r = i * 17 + 3;
    const rand = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    let steps = 0;
    for (; steps < 3000 && s.phase !== 'end'; steps++) {
      const who = activePlayersOf(s)[0];
      s = s.phase === 'passion' && who === cid ? applyAction(s, who, { type: 'choosePassion', passion: 'curator' }) : botMove(s, who, rand, 'bookman');
    }
    expect(s.phase).toBe('end');
  }, 120_000);

  it('для тестов: первый игрок — Куратор с заданной стратегией', () => {
    let s = createGame({ players: players(3), seed: 3, mode: 'full', forceCurator: true, curatorStyle: 'boa' });
    expect(s.players.find((p) => p.id === 'p1')!.passionOptions).toEqual(['curator']);
    expect(s.players.filter((p) => p.id !== 'p1').every((p) => !p.passionOptions.includes('curator'))).toBe(true);
    expect(curatorStyle(s, 'p1')).toBe('boa');
    const rand = seeded(3);
    for (let i = 0; i < 50 && s.phase === 'passion'; i++) s = botMove(s, activePlayersOf(s)[0], rand);
    expect(s.players.find((p) => p.id === 'p1')!.passion).toBe('curator');
  });

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

describe('Посиделки в последней Пятилетке', () => {
  it('книги, которые всё равно изымут при облаве (в Тайник не влезают), показывает — даже подозревая Куратора', () => {
    let s = createGame({ players: players(3), seed: 7, mode: 'full', curator: true });
    for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions.find((x) => x !== 'curator')! });
    for (const p of s.players) if (s.phase === 'setupCache') s = applyAction(s, p.id, { type: 'hiding', hidden: [] });
    s.curatorPossible = true;
    s.round = 5;
    s.phase = 'gathering';
    s.ready = [];
    s.pending = [];
    const me = s.players[0];
    s.players[1].cacheUnshown = 3; // подозрение на соседа
    me.cache = 0;
    me.capacity = 10;
    const banned = s.deck.filter((c) => s.cards[c].kind === 'genre' && s.cards[c].icons.some((g) => s.banned.includes(g))).slice(0, 2);
    s.deck = s.deck.filter((c) => !banned.includes(c));
    me.warehouse = banned.map((card) => ({ card, hidden: false }));
    const before = me.points;
    s = botMove(s, me.id, seeded(7));
    expect(s.players[0].points).toBeGreaterThan(before);
  });
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
    s = startOrders(s);
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

  it('доносы в Контору подозрительны, а одно кормление Ростка не обесценивает улики', () => {
    const s = createGame({ players: players(3), seed: 5, mode: 'full' });
    const [me, x] = s.players;
    x.redEager = 4;
    x.sproutsFed = ['ksp'];
    const base = curatorSuspicion(s, me.id)[x.id];
    x.redEager = 6;
    const once = curatorSuspicion(s, me.id)[x.id];
    // Улики у кормившего один Росток весят 80%.
    expect(once - base).toBeCloseTo(2 * BOT_BASE.suspectRedEager * 0.8, 5);
    x.redEager = 4;
    x.denounces = 1;
    expect(curatorSuspicion(s, me.id)[x.id]).toBeCloseTo(base + BOT_BASE.suspectDenounce * Math.max(0.8, BOT_BASE.suspectTakenTrust), 5);
  });

  it('раскушенный «Удав» дальше играет открыто, даже если подозрения ослабли', () => {
    const seed = [...Array(60).keys()].map((i) => i + 1).find((x) => curatorStyle({ seed: x }, 'p1') === 'boa')!;
    const s = createGame({ players: players(3), seed, mode: 'full' });
    s.players[0].passion = 'curator';
    expect(effectiveCuratorStyle(s, 'p1')).toBe('boa');
    s.curatorUnmask = { round: 2, act: 3, why: 'exposed' };
    expect(effectiveCuratorStyle(s, 'p1')).toBe('open');
  });

  it('характер Куратора-бота выбирается случайно, но одинаково для той же партии; все три встречаются', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const st = curatorStyle({ seed }, 'p1');
      expect(curatorStyle({ seed }, 'p1')).toBe(st);
      seen.add(st);
    }
    expect([...seen].sort()).toEqual(['ambush', 'boa', 'open']);
    expect(curatorStyleNote({ seed: 1 }, 'p1', 'Бот 1')).toContain(CURATOR_STYLES[curatorStyle({ seed: 1 }, 'p1')].name);
  });

  it('в итоговой записи о Кураторе-боте — когда он сбросил маску (Пятилетка, ход, причина)', () => {
    const seed = [...Array(40).keys()].map((i) => i + 1).find((x) => curatorStyle({ seed: x }, 'p1') === 'ambush')!;
    const note = curatorStyleNote({ seed, curatorUnmask: { round: 3, act: 1, why: 'round' } }, 'p1', 'Бот 1');
    expect(note).toContain('Сбросил маску в Пятилетке 3, на своём 1-м ходу');
    // В партии: Хищник не позже 3-й Пятилетки отмечает, что маска снята.
    let s = createGame({ players: players(3), seed, mode: 'full', curator: true });
    for (const p of s.players) {
      if (p.id === 'p1') p.passionOptions = ['curator', p.passionOptions.find((x) => x !== 'curator')!];
      else p.passionOptions = p.passionOptions.map((x) => (x === 'curator' ? 'erudite' : x));
    }
    const rand = seeded(seed);
    for (let i = 0; i < 6000 && s.phase !== 'end' && !s.curatorUnmask; i++) {
      const who = activePlayersOf(s)[0];
      s = s.phase === 'passion' && who === 'p1' ? applyAction(s, who, { type: 'choosePassion', passion: 'curator' }) : botMove(s, who, rand);
    }
    expect(s.curatorUnmask).toBeDefined();
    expect(s.curatorUnmask!.round).toBeLessThanOrEqual(3);
  }, 120_000);

  it('Куратор кормит Ростки разве что один раз (маскировка) и бережёт Пропаганду', () => {
    let feeds = 0;
    let curators = 0;
    let recycled = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const s0 = createGame({ players: players(3), seed, mode: 'full' });
      // Куратор — первому игроку.
      s0.players[0].passionOptions = ['curator', s0.players[0].passionOptions.find((x) => x !== 'curator')!];
      for (const p of s0.players.slice(1)) p.passionOptions = p.passionOptions.map((x) => (x === 'curator' ? 'erudite' : x));
      let s = s0;
      for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
      s = startOrders(s);
      s = playOut(s, seeded(seed), 8000, 'bookman');
      const cur = s.players[0];
      curators++;
      feeds += s.log.filter((l) => l.text.startsWith(`${cur.name} питает ступень`)).length;
      // Пропаганда в конце срезает Ростки — Куратор её в макулатуру не сдаёт.
      const propaganda = Object.values(s.cards).filter((c) => c.kind === 'propaganda').map((c) => `«${c.title}»`);
      recycled += s.log.filter((l) => l.text.startsWith(`${cur.name} в Красном уголке`) && propaganda.some((t) => l.text.includes(t))).length;
    }
    expect(curators).toBe(8);
    // Одна ступень для маскировки, дальше — почти никогда.
    expect(feeds / curators).toBeLessThan(1.5);
    expect(recycled).toBe(0);
  }, 120_000);
});

describe('Куратор: маскировка до первого явного зла', () => {
  it('Удав и Хищник, открыто взявшие Пропаганду, играют «открытым забралом»', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 60 && seen.size < 2; seed++) {
      const s = createGame({ players: players(3), seed, mode: 'full' });
      for (const p of s.players) {
        const style = curatorStyle(s, p.id);
        if (style === 'open' || seen.has(style)) continue;
        seen.add(style);
        p.passion = 'curator';
        expect(effectiveCuratorStyle(s, p.id)).toBe(style);
        p.propagandaTaken = 1;
        expect(effectiveCuratorStyle(s, p.id)).toBe('open');
      }
    }
    expect([...seen].sort()).toEqual(['ambush', 'boa']);
  });
});

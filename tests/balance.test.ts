// Правка баланса: новое Тиражирование текста, цены Распределителя, Списания и Возвращения смыслов, доход Самиздата.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { RULES } from '../src/engine/content';
import { RuleError, iconsOf } from '../src/engine/util';
import { gainedInfo, viewFor } from '../src/engine/view';
import { passionPoints } from '../src/engine/scoring';
import type { Action, GameState } from '../src/engine/types';

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

function started(seed = 1, n = 3): GameState {
  let s = createGame({ players: players(n), seed });
  for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
  s = startOrders(s);
  for (const p of s.players) p.capacity = RULES.maxCapacity; // места хватает на любые покупки
  return s;
}

const me = (s: GameState) => s.players.find((p) => p.id === s.order[s.turn])!;
const byId = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

// Положить на склад игрока жанровую книгу с нужным числом значков (из стопки).
function giveBook(s: GameState, id: string, icons = 1): string {
  const c = s.deck.find((x) => s.cards[x].kind === 'genre' && s.cards[x].icons.length === icons)!;
  s.deck = s.deck.filter((x) => x !== c);
  byId(s, id).warehouse.push({ card: c, hidden: false });
  return c;
}

describe('Тиражирование текста', () => {
  const copy = (address: 'razval' | 'tolkuchka' | 'raspredelitel' | 'knigoobmen', buy: unknown, card: string | null) =>
    ({ type: 'group', group: { action: 'copyText', address, buy, card } }) as Action;

  it('покупка на Развале и ещё одна книга оттуда же даром; Единомышленник занимает место', () => {
    let s = started();
    const p = me(s);
    p.talons = 10;
    // Даром — жанровая книга с Развала (не Улика и не Пропаганда); раздача от сида не зависит.
    const genreAt = (i: number) => { const c = s.deck.find((x) => s.cards[x].kind === 'genre')!; s.deck = s.deck.filter((x) => x !== c); s.razval[i] = c; return c; };
    const bought = s.razval[3]!;
    const gift = genreAt(0);
    s = applyAction(s, p.id, copy('razval', { address: 'razval', slot: 3 }, gift));
    const after = byId(s, p.id);
    expect(after.talons).toBe(10 - RULES.razvalPrices[3]);
    expect(after.warehouse.map((w) => w.card)).toEqual(expect.arrayContaining([bought, gift]));
    expect(s.razval[3]).toBeNull();
    expect(s.razval[0]).toBeNull();
    expect(s.occupancy.razval).toEqual([p.id]);
    expect(after.groupUsed).toContain('copyText');
    expect(after.available).toBe(p.available - 2); // покупатель и Единомышленник на Тиражировании
  });

  it('без покупки Тиражирования нет', () => {
    const s = started();
    expect(() => applyAction(s, me(s).id, copy('tolkuchka', null, s.tolkuchka[0]))).toThrow(/вместе с покупкой/);
  });

  it('нужны два Единомышленника, и последний должен остаться для Красного уголка', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    p.available = 2;
    expect(() => applyAction(s, p.id, copy('razval', { address: 'razval', slot: 0 }, s.razval[1]!))).toThrow(/Красный уголок/);
    p.available = 1;
    p.visitedRedCorner = true;
    expect(() => applyAction(s, p.id, copy('razval', { address: 'razval', slot: 0 }, s.razval[1]!))).toThrow(/два Единомышленника/);
  });

  it('на Толкучке можно освободить место продажей; проданное уходит в сброс, а не на прилавок', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    const sell = giveBook(s, p.id);
    const [buy, gift] = s.tolkuchka;
    const ops = [{ op: 'sell', card: sell }, { op: 'buy', card: buy }];
    expect(() => applyAction(s, p.id, copy('tolkuchka', { address: 'tolkuchka', ops }, sell))).toThrow();
    const after = applyAction(s, p.id, copy('tolkuchka', { address: 'tolkuchka', ops }, gift));
    const w = byId(after, p.id).warehouse.map((x) => x.card);
    expect(w).toEqual(expect.arrayContaining([buy, gift]));
    expect(w).not.toContain(sell);
    expect(after.tolkuchka).not.toContain(sell);
    expect(after.discard).toContain(sell);
  });

  it('на Книгообмене: обменяться и взять ещё одну даром, отданную не забрать', () => {
    const s = started();
    const p = me(s);
    s.safehouses = ['knigoobmen'];
    s.knigoobmen = s.deck.splice(-4);
    const give = giveBook(s, p.id);
    const [take, gift] = s.knigoobmen;
    const buy = { address: 'knigoobmen', give, take };
    expect(() => applyAction(s, p.id, copy('knigoobmen', buy, give))).toThrow(/обратно/);
    const after = applyAction(s, p.id, copy('knigoobmen', buy, gift));
    const w = byId(after, p.id).warehouse.map((x) => x.card);
    expect(w).toEqual(expect.arrayContaining([take, gift]));
    expect(w).not.toContain(give);
    expect(after.knigoobmen).toContain(give);
  });

  it('бесплатную книгу можно взять только с того же адреса', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    expect(() => applyAction(s, p.id, copy('razval', { address: 'razval', slot: 0 }, s.tolkuchka[0]))).toThrow(/того же Развала/);
  });

  it('на занятый до предела адрес тиражировать нельзя', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    s.occupancy.razval = ['x', 'y', 'z'];
    expect(() => applyAction(s, p.id, copy('razval', { address: 'razval', slot: 0 }, s.razval[1]!))).toThrow(/все места заняты/);
  });

  it('в Распределителе: одну купить, вторую — даром', () => {
    let s = started();
    const p = me(s);
    p.talons = 10;
    s.safehouses = ['raspredelitel'];
    const [a, b] = s.deck.filter((x) => s.cards[x].kind === 'genre' && s.cards[x].icons.length === 2).slice(0, 2);
    s.deck = s.deck.filter((x) => x !== a && x !== b);
    s.raspredelitel = [a, b];
    s = applyAction(s, p.id, copy('raspredelitel', { address: 'raspredelitel', card: a }, b));
    expect(byId(s, p.id).talons).toBe(10 - RULES.raspredelitelPrice);
    expect(s.raspredelitel).toEqual([]);
  });

  it('из бонуса по адресу идёт только покупатель; без доступного Единомышленника — нельзя', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    s.pending = [{ kind: 'extraGroup', player: p.id }];
    p.groupUsed = ['copyText']; // Подмастерье повторяет уже сделанное
    const avail = p.available;
    const gift = s.deck.find((x) => s.cards[x].kind === 'genre')!;
    s.deck = s.deck.filter((x) => x !== gift);
    s.razval[0] = gift;
    const after = applyAction(s, p.id, copy('razval', { address: 'razval', slot: 1 }, s.razval[0]!));
    expect(byId(after, p.id).available).toBe(avail - 1);
    expect(after.occupancy.razval).toEqual([p.id]);
    const none = started();
    const q = me(none);
    q.available = 0;
    none.pending = [{ kind: 'extraGroup', player: q.id }];
    q.groupUsed = ['copyText'];
    q.talons = 10;
    expect(() => applyAction(none, q.id, copy('razval', { address: 'razval', slot: 1 }, none.razval[0]!))).toThrow(/доступного Единомышленника/);
  });
});

describe('цены и доходы', () => {
  it(`Возвращение смыслов стоит ${RULES.restoreCost}т`, () => {
    let s = started();
    const p = me(s);
    p.talons = 3;
    const c = giveBook(s, p.id);
    s = applyAction(s, p.id, { type: 'group', group: { action: 'restore', card: c } });
    expect(byId(s, p.id).talons).toBe(3 - RULES.restoreCost);
    expect(iconsOf(s, c)).toHaveLength(2);
  });

  it(`Самиздат приносит ${RULES.samizdatTalons}т за значок`, () => {
    let s = started();
    const p = me(s);
    const c = giveBook(s, p.id, 2);
    const t = p.talons;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'samizdat', card: c } });
    expect(byId(s, p.id).talons).toBe(t + 2 * RULES.samizdatTalons);
  });

  it(`Распределитель и Библиотечное списание стоят ${RULES.raspredelitelPrice}т и ${RULES.spisaniePrice}т`, () => {
    let s = started();
    const p = me(s);
    p.talons = 10;
    s.safehouses = ['raspredelitel', 'spisanie'];
    const c = s.deck.find((x) => s.cards[x].kind === 'genre' && s.cards[x].icons.length === 2)!;
    s.deck = s.deck.filter((x) => x !== c);
    s.raspredelitel = [c];
    s = act(s, p.id, { type: 'place', place: { address: 'raspredelitel', card: c } });
    expect(byId(s, p.id).talons).toBe(10 - RULES.raspredelitelPrice);
    // Ход переходит по кругу — ждём, пока снова походит тот же игрок.
    while (s.order[s.turn] !== p.id) s = act(s, s.order[s.turn], { type: 'place', place: { address: 'redCorner', recycle: [] } });
    const before = byId(s, p.id).talons;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'spisanie' } });
    expect(byId(s, p.id).talons).toBe(before - RULES.spisaniePrice);
  });
});

describe('Агитпункт', () => {
  it('книга Нагрузки с витрины — даром, одна за действие (несколько — только с Ветераном)', () => {
    let s = started();
    const p = me(s);
    p.talons = 3;
    p.capacity = 10;
    s.safehouses = ['agitpunkt'];
    s.agitpunkt = s.loadDeck.splice(0, 4);
    const [a, b] = s.agitpunkt;
    expect(() => applyAction(s, p.id, { type: 'place', place: { address: 'agitpunkt', card: a, cards: [a, b] } })).toThrow(/Ветераном/);
    s = act(s, p.id, { type: 'place', place: { address: 'agitpunkt', card: a } });
    expect(byId(s, p.id).talons).toBe(3);
    expect(byId(s, p.id).warehouse.some((w) => w.card === a)).toBe(true);
    expect(s.agitpunkt).not.toContain(a);
    // Как с Книгообмена и Квартирника — в конце поручений ещё действие Инициативной группы.
    expect(byId(s, p.id).bonusGroupTurns).toBe(1);
  });
});

describe('Красный уголок и Тамиздат', () => {
  it(`Нагрузка в Красном уголке — ${RULES.redCornerLoad}т, Непечатная — ${RULES.redCornerUnprinted}т`, () => {
    let s = started();
    const p = me(s);
    const load = p.warehouse.find((w) => s.cards[w.card].kind === 'load')!.card;
    const book = giveBook(s, p.id);
    const t = p.talons;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'redCorner', recycle: [load, book] } });
    expect(byId(s, p.id).talons).toBe(t + RULES.redCornerLoad + RULES.redCornerUnprinted);
  });

  it(`Тамиздат: +${RULES.tamizdatTalons}т и +${RULES.tamizdatPoints} очка за значок`, () => {
    let s = started();
    const p = me(s);
    const c = giveBook(s, p.id, 2);
    const t = p.talons;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'tamizdat', card: c } });
    expect(byId(s, p.id).talons).toBe(t + 2 * RULES.tamizdatTalons);
    expect(byId(s, p.id).points).toBe(2 * RULES.tamizdatPoints);
  });
});

describe('Посредничество авторам и Библиотечное списание', () => {
  it(`Посредничество: ${RULES.posrednichestvoDraw} книги, оставить ${RULES.posrednichestvoKeep}, затем любое действие Группы, даже уже сделанное`, () => {
    let s = started();
    const p = me(s);
    p.talons = 10;
    p.groupUsed = ['expandCache'];
    s.safehouses = ['posrednichestvo'];
    s = applyAction(s, p.id, { type: 'place', place: { address: 'posrednichestvo' } });
    const pend = s.pending[0];
    expect(pend.kind).toBe('posrednichestvoKeep');
    if (pend.kind !== 'posrednichestvoKeep') return;
    expect(pend.cards).toHaveLength(RULES.posrednichestvoDraw);
    expect(() => applyAction(s, p.id, { type: 'posrednichestvoKeep', keep: pend.cards })).toThrow(RuleError);
    s = applyAction(s, p.id, { type: 'posrednichestvoKeep', keep: [pend.cards[0]] });
    expect(s.discard).toContain(pend.cards[1]);
    expect(s.pending[0].kind).toBe('posrednichestvoGroup');
    const cache = byId(s, p.id).cache;
    const talons = byId(s, p.id).talons;
    s = applyAction(s, p.id, { type: 'group', group: { action: 'expandCache' } });
    expect(byId(s, p.id).cache).toBe(cache + 1);
    expect(byId(s, p.id).talons).toBe(talons - RULES.expandCacheCost);
  });

  it(`Списание: ${RULES.spisanieDraw} книги за ${RULES.spisaniePrice}т, оставить сколько угодно, остальные — в сброс`, () => {
    let s = started();
    const p = me(s);
    p.talons = 5;
    s.safehouses = ['spisanie'];
    s = applyAction(s, p.id, { type: 'place', place: { address: 'spisanie' } });
    expect(byId(s, p.id).talons).toBe(5 - RULES.spisaniePrice);
    const pend = s.pending[0];
    expect(pend.kind).toBe('spisanieKeep');
    if (pend.kind !== 'spisanieKeep') return;
    expect(pend.cards).toHaveLength(RULES.spisanieDraw);
    // Чужим не видно, что взято.
    expect(viewFor(s, s.players.find((x) => x.id !== p.id)!.id).pending[0]).toMatchObject({ kind: 'spisanieKeep', secret: true });
    const keep = pend.cards.slice(0, pend.cards.length - 1);
    const prev = s;
    s = applyAction(s, p.id, { type: 'spisanieKeep', keep });
    expect(byId(s, p.id).warehouse.map((w) => w.card)).toEqual(expect.arrayContaining(keep));
    expect(s.discard).toContain(pend.cards[pend.cards.length - 1]);
    // Выбор из уже увиденных книг нового знания не даёт: «Назад» вернёт к окну выбора.
    expect(gainedInfo(prev, s, p.id)).toBe(false);
  });

  it('Госкниготорг: всем — что легло на склад и сколько в Тайник; тайно — что именно в Тайнике', () => {
    let s = started();
    const p = me(s);
    p.talons = 5;
    p.cache = 1;
    p.warehouse = [];
    s = applyAction(s, p.id, { type: 'place', place: { address: 'gostorg', pairs: 1 } });
    const line = s.log.find((l) => l.text.includes('в Госкниготорге'))!;
    expect(line.only).toBeUndefined();
    expect(line.text).toMatch(/2 книги за 1 Талон:\n• .+\n• В Тайник: 1 книга$/);
    const secret = s.log.find((l) => l.only?.includes(p.id) && l.text.startsWith('В Тайник:'))!;
    expect(secret.text).toMatch(/^В Тайник: .+\.$/);
    // Книга в Тайнике чужим в журнале не видна.
    const hidden = byId(s, p.id).warehouse.find((w) => w.hidden)!.card;
    expect(line.text).not.toContain(s.cards[hidden].title);
  });
});

describe('Новатор', () => {
  it(`${RULES.passionInnovator} очка за значок двужанровой книги, ${RULES.innovatorSingle} за книгу с одним жанром`, () => {
    const s = started();
    const p = me(s);
    p.passion = 'innovator';
    p.warehouse = [];
    const dual = Object.values(s.cards).find((c) => c.kind === 'genre' && new Set(c.icons).size === 2)!;
    const single = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 1)!;
    const masterpiece = Object.values(s.cards).find((c) => c.kind === 'genre' && c.icons.length === 2 && c.icons[0] === c.icons[1])!;
    const load = Object.values(s.cards).find((c) => c.kind === 'load')!;
    p.warehouse = [dual, single, masterpiece, load].map((c) => ({ card: c.id, hidden: false }));
    // Нагрузка без жанра не штрафуется; шедевр — книга одного жанра.
    expect(passionPoints(s, p)).toBe(2 * RULES.passionInnovator + 2 * RULES.innovatorSingle);
  });
});

describe('Макулатура', () => {
  it(`по ${RULES.makulaturaPrice}т за книгу из любой стопки, оставить одну, остальные — в сброс; соперник не видит`, () => {
    let s = started();
    const p = me(s);
    p.talons = 5;
    p.capacity = 10;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'makulatura' } });
    expect(() => applyAction(s, p.id, { type: 'makulaturaKeep', card: s.deck[0] })).toThrow(RuleError);
    const top = s.deck[s.deck.length - 1];
    const topLoad = s.loadDeck[s.loadDeck.length - 1];
    s = applyAction(s, p.id, { type: 'makulaturaDraw', deck: 'unprinted' });
    s = applyAction(s, p.id, { type: 'makulaturaDraw', deck: 'load' });
    expect(byId(s, p.id).talons).toBe(5 - 2 * RULES.makulaturaPrice);
    const other = s.players.find((x) => x.id !== p.id)!.id;
    expect(JSON.stringify(viewFor(s, other).pending)).not.toContain(top);
    s = applyAction(s, p.id, { type: 'makulaturaKeep', card: top });
    expect(byId(s, p.id).warehouse.some((w) => w.card === top)).toBe(true);
    expect(s.loadDiscard).toContain(topLoad);
    expect(s.pending).toHaveLength(0);
  });
});

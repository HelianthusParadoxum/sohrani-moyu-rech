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
  const copy = (address: 'razval' | 'tolkuchka', card: string) => ({ type: 'group', group: { action: 'copyText', address, card } }) as Action;

  it('бесплатно — открытая книга с адреса, где уже стоит свой Единомышленник', () => {
    let s = started();
    const p = me(s);
    const card = s.razval.find(Boolean)!;
    // Своего Единомышленника на Развале нет — нельзя.
    expect(() => applyAction(s, p.id, copy('razval', card))).toThrow(/уже стоит ваш Единомышленник/);
    s.occupancy.razval = [p.id];
    const [talons, avail] = [p.talons, p.available];
    s = applyAction(s, p.id, copy('razval', card));
    const after = byId(s, p.id);
    expect(after.warehouse.map((w) => w.card)).toContain(card);
    expect(s.razval).not.toContain(card);
    expect(after.talons).toBe(talons);
    expect(after.available).toBe(avail - 1);
    expect(after.groupUsed).toContain('copyText');
    expect(s.occupancy.razval).toEqual([p.id]); // на адрес никто нового не ставит
  });

  it('нужно место на складе', () => {
    const s = started();
    const p = me(s);
    s.occupancy.tolkuchka = [p.id];
    p.capacity = p.warehouse.length;
    expect(() => applyAction(s, p.id, copy('tolkuchka', s.tolkuchka[0]))).toThrow(/нет места/);
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
    while (s.order[s.turn] !== p.id) s = act(s, s.order[s.turn], { type: 'place', place: { address: 'redCorner' } });
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

describe('Главлит и Тамиздат', () => {
  it(`Нагрузка в Главлите — ${RULES.glavlitLoad}т, Непечатная — ${RULES.glavlitUnprinted}т`, () => {
    let s = started();
    const p = me(s);
    const load = p.warehouse.find((w) => s.cards[w.card].kind === 'load')!.card;
    const book = giveBook(s, p.id);
    const t = p.talons;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'glavlit', recycle: [load, book] } });
    expect(byId(s, p.id).talons).toBe(t + RULES.glavlitLoad + RULES.glavlitUnprinted);
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
    expect(line.text).toMatch(/2 книги даром:\n• .+\n• В Тайник: 1 книга$/);
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

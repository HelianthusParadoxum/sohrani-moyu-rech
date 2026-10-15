// Правка баланса: новое Тиражирование текста, цены Распределителя, Списания и Возвращения смыслов, доход Самиздата.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { RULES } from '../src/engine/content';
import { RuleError, iconsOf } from '../src/engine/util';
import type { Action, GameState } from '../src/engine/types';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Игрок ${i + 1}` }));

function started(seed = 1, n = 3): GameState {
  let s = createGame({ players: players(n), seed });
  for (const p of s.players) s = applyAction(s, p.id, { type: 'choosePassion', passion: p.passionOptions[0] });
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
    const bought = s.razval[3]!;
    const gift = s.razval[0]!;
    s = applyAction(s, p.id, copy('razval', { address: 'razval', slot: 3 }, gift));
    const after = byId(s, p.id);
    expect(after.talons).toBe(10 - RULES.razvalPrices[3]);
    expect(after.warehouse.map((w) => w.card)).toEqual(expect.arrayContaining([bought, gift]));
    expect(s.razval[3]).toBeNull();
    expect(s.razval[0]).toBeNull();
    expect(s.occupancy.razval).toEqual([p.id]);
    expect(after.groupUsed).toContain('copyText');
    expect(after.available).toBe(p.available - 1);
  });

  it('покупать не обязательно: можно просто взять книгу даром', () => {
    let s = started();
    const p = me(s);
    const t = p.talons;
    const gift = s.tolkuchka[0];
    s = applyAction(s, p.id, copy('tolkuchka', null, gift));
    expect(byId(s, p.id).talons).toBe(t);
    expect(byId(s, p.id).warehouse.map((w) => w.card)).toContain(gift);
    expect(s.occupancy.tolkuchka).toEqual([p.id]);
  });

  it('ничего не купить и ничего не взять нельзя', () => {
    const s = started();
    expect(() => applyAction(s, me(s).id, copy('razval', null, null))).toThrow(RuleError);
  });

  it('на Толкучке можно освободить место продажей, но проданное не забрать обратно', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    const sell = giveBook(s, p.id);
    const [buy, gift] = s.tolkuchka;
    const ops = [{ op: 'sell', card: sell }, { op: 'buy', card: buy }];
    expect(() => applyAction(s, p.id, copy('tolkuchka', { address: 'tolkuchka', ops }, sell))).toThrow(/обратно/);
    const after = applyAction(s, p.id, copy('tolkuchka', { address: 'tolkuchka', ops }, gift));
    const w = byId(after, p.id).warehouse.map((x) => x.card);
    expect(w).toEqual(expect.arrayContaining([buy, gift]));
    expect(w).not.toContain(sell);
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
    s.occupancy.razval = ['x', 'y', 'z'];
    expect(() => applyAction(s, p.id, copy('razval', null, s.razval[1]!))).toThrow(/все места заняты/);
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

  it('из бонуса отправляет ещё одного доступного Единомышленника; без него — нельзя', () => {
    const s = started();
    const p = me(s);
    s.pending = [{ kind: 'extraGroup', player: p.id }];
    const avail = p.available;
    const after = applyAction(s, p.id, copy('razval', null, s.razval[0]!));
    expect(byId(after, p.id).available).toBe(avail - 1);
    expect(after.occupancy.razval).toEqual([p.id]);
    const none = started();
    const q = me(none);
    q.available = 0;
    none.pending = [{ kind: 'extraGroup', player: q.id }];
    expect(() => applyAction(none, q.id, copy('razval', null, none.razval[0]!))).toThrow(/доступного Единомышленника/);
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
    s = applyAction(s, p.id, { type: 'place', place: { address: 'raspredelitel', card: c } });
    expect(byId(s, p.id).talons).toBe(10 - RULES.raspredelitelPrice);
    // Ход переходит по кругу — ждём, пока снова походит тот же игрок.
    while (s.order[s.turn] !== p.id) s = applyAction(s, s.order[s.turn], { type: 'place', place: { address: 'redCorner', recycle: [] } });
    const before = byId(s, p.id).talons;
    s = applyAction(s, p.id, { type: 'place', place: { address: 'spisanie' } });
    expect(byId(s, p.id).talons).toBe(before - RULES.spisaniePrice);
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

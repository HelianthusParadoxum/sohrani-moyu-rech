// Правка баланса: новое Тиражирование текста, цены Распределителя, Списания и Возвращения смыслов, доход Самиздата.
import { describe, expect, it } from 'vitest';
import { applyAction, createGame } from '../src/engine/engine';
import { RULES } from '../src/engine/content';
import { RuleError, iconsOf } from '../src/engine/util';
import type { GameState } from '../src/engine/types';

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
  it('покупка на Развале и ещё одна книга оттуда же даром; Единомышленник занимает место', () => {
    let s = started();
    const p = me(s);
    p.talons = 10;
    const bought = s.razval[3]!;
    const gift = s.razval[0]!;
    s = applyAction(s, p.id, { type: 'group', group: { action: 'copyText', buy: { address: 'razval', slot: 3 }, card: gift } });
    const after = byId(s, p.id);
    expect(after.talons).toBe(10 - RULES.razvalPrices[3]);
    expect(after.warehouse.map((w) => w.card)).toEqual(expect.arrayContaining([bought, gift]));
    expect(s.razval[3]).toBeNull();
    expect(s.razval[0]).toBeNull();
    expect(s.occupancy.razval).toEqual([p.id]);
    expect(after.groupUsed).toContain('copyText');
    expect(after.available).toBe(p.available - 1);
  });

  it('на Толкучке обязательно что-то купить', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    const sell = giveBook(s, p.id);
    expect(() => applyAction(s, p.id, {
      type: 'group', group: { action: 'copyText', buy: { address: 'tolkuchka', ops: [{ op: 'sell', card: sell }] }, card: s.tolkuchka[0] },
    })).toThrow(RuleError);
  });

  it('на Толкучке можно освободить место продажей, но проданное не забрать обратно', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    p.capacity = p.warehouse.length + 1; // свободно одно место
    const sell = giveBook(s, p.id);
    p.capacity++;
    const [buy, gift] = s.tolkuchka;
    expect(() => applyAction(s, p.id, {
      type: 'group', group: { action: 'copyText', buy: { address: 'tolkuchka', ops: [{ op: 'sell', card: sell }, { op: 'buy', card: buy }] }, card: sell },
    })).toThrow(/обратно/);
    const after = applyAction(s, p.id, {
      type: 'group', group: { action: 'copyText', buy: { address: 'tolkuchka', ops: [{ op: 'sell', card: sell }, { op: 'buy', card: buy }] }, card: gift },
    });
    const w = byId(after, p.id).warehouse.map((x) => x.card);
    expect(w).toEqual(expect.arrayContaining([buy, gift]));
    expect(w).not.toContain(sell);
  });

  it('бесплатную книгу можно взять только с того же адреса', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    expect(() => applyAction(s, p.id, {
      type: 'group', group: { action: 'copyText', buy: { address: 'razval', slot: 0 }, card: s.tolkuchka[0] },
    })).toThrow(/того же Развала/);
  });

  it('на занятый до предела адрес тиражировать нельзя', () => {
    const s = started();
    const p = me(s);
    p.talons = 10;
    s.occupancy.razval = ['x', 'y', 'z'];
    expect(() => applyAction(s, p.id, {
      type: 'group', group: { action: 'copyText', buy: { address: 'razval', slot: 0 }, card: s.razval[1]! },
    })).toThrow(/все места заняты/);
  });

  it('в Распределителе: одну купить, вторую — даром', () => {
    let s = started();
    const p = me(s);
    p.talons = 10;
    s.safehouses = ['raspredelitel'];
    const [a, b] = s.deck.filter((x) => s.cards[x].kind === 'genre' && s.cards[x].icons.length === 2).slice(0, 2);
    s.deck = s.deck.filter((x) => x !== a && x !== b);
    s.raspredelitel = [a, b];
    s = applyAction(s, p.id, { type: 'group', group: { action: 'copyText', buy: { address: 'raspredelitel', card: a }, card: b } });
    expect(byId(s, p.id).talons).toBe(10 - RULES.raspredelitelPrice);
    expect(s.raspredelitel).toEqual([]);
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

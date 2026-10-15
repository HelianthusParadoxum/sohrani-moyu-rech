// Вспомогательные функции: случайность, карты, игроки.
import { RULES } from './content';
import type { GameState, Genre, PlayerState } from './types';

export class RuleError extends Error {}

export function fail(message: string): never {
  throw new RuleError(message);
}

export function check(cond: unknown, message: string): asserts cond {
  if (!cond) fail(message);
}

// mulberry32: детерминированный генератор, состояние хранится в GameState.rng.
export function random(state: GameState): number {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function shuffle<T>(state: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function log(state: GameState, text: string, only?: string[]) {
  state.log.push(only ? { round: state.round, text, only } : { round: state.round, text });
}

export function player(state: GameState, id: string): PlayerState {
  const p = state.players.find((x) => x.id === id);
  check(p, 'Нет такого игрока');
  return p;
}

export function title(state: GameState, id: string): string {
  return `«${state.cards[id].title}»`;
}

// ---------- Свойства карт ----------

export function iconsOf(state: GameState, id: string): Genre[] {
  const c = state.cards[id];
  const extra = state.restored[id] ?? [];
  if (c.kind === 'loadReturnable') return extra;
  return [...c.icons, ...extra];
}

export function isLoad(state: GameState, id: string): boolean {
  const c = state.cards[id];
  if (c.kind === 'loadReturnable') return !state.restored[id];
  return c.kind === 'load' || c.kind === 'loadEvidence';
}

export function isFromLoadDeck(state: GameState, id: string): boolean {
  const k = state.cards[id].kind;
  return k === 'load' || k === 'loadReturnable' || k === 'loadEvidence';
}

export function isEvidence(state: GameState, id: string): boolean {
  const k = state.cards[id].kind;
  return k === 'evidence' || k === 'loadEvidence';
}

export function isPropaganda(state: GameState, id: string): boolean {
  return state.cards[id].kind === 'propaganda';
}

// Опальная книга: Пропаганда, Улики и книги со значком опального жанра.
export function isBanned(state: GameState, id: string): boolean {
  if (isPropaganda(state, id) || isEvidence(state, id)) return true;
  return iconsOf(state, id).some((g) => state.banned.includes(g));
}

export function isGenreBook(state: GameState, id: string): boolean {
  return iconsOf(state, id).length > 0;
}

// «Одиночная» книга — ровно 1 значок.
export function isSingle(state: GameState, id: string): boolean {
  return state.cards[id].kind === 'genre' && iconsOf(state, id).length === 1;
}

// ---------- Стопки ----------

export function draw(state: GameState): string | null {
  if (state.deck.length === 0 && state.discard.length > 0) {
    state.deck = shuffle(state, state.discard);
    state.discard = [];
    log(state, 'Стопка Непечатных кончилась — сброс перетасован в новую стопку.');
  }
  return state.deck.pop() ?? null;
}

export function drawLoad(state: GameState): string | null {
  if (state.loadDeck.length === 0 && state.loadDiscard.length > 0) {
    state.loadDeck = shuffle(state, state.loadDiscard);
    state.loadDiscard = [];
    log(state, 'Стопка Нагрузки кончилась — сброс перетасован в новую стопку.');
  }
  return state.loadDeck.pop() ?? null;
}

export function discard(state: GameState, id: string) {
  if (isFromLoadDeck(state, id)) {
    delete state.restored[id];
    state.loadDiscard.push(id);
  } else {
    state.discard.push(id);
  }
}

// ---------- Склад ----------

export function freeSlots(p: PlayerState): number {
  return p.capacity - p.warehouse.length;
}

export function addBook(p: PlayerState, id: string) {
  check(freeSlots(p) > 0, 'На складе нет места');
  p.warehouse.push({ card: id, hidden: false });
}

export function hasBook(p: PlayerState, id: string): boolean {
  return p.warehouse.some((s) => s.card === id);
}

export function removeBook(p: PlayerState, id: string) {
  const i = p.warehouse.findIndex((s) => s.card === id);
  check(i >= 0, 'Этой книги нет у вас на складе');
  p.warehouse.splice(i, 1);
}

export function pay(p: PlayerState, talons: number) {
  check(p.talons >= talons, `Не хватает Талонов: нужно ${talons}, у вас ${p.talons}`);
  p.talons -= talons;
}

export function cacheLimit(state: GameState, p: PlayerState): number {
  const openLoad = p.warehouse.filter((s) => !s.hidden && isLoad(state, s.card)).length;
  return p.cache + Math.floor(openLoad / 2);
}

export const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
};

export const talonsText = (n: number) => plural(n, 'Талон', 'Талона', 'Талонов');
export const pointsText = (n: number) => plural(n, 'очко', 'очка', 'очков');

export { RULES };

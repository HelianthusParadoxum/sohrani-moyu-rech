// Вспомогательные функции: случайность, карты, игроки.
import { RULES } from './content';
import type { GameState, Genre, PatronId, PlayerState, PointSource } from './types';

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

// Глубокая копия простого JSON-объекта (состояние партии). Заметно быстрее structuredClone.
export function cloneJson<T>(x: T): T {
  if (x === null || typeof x !== 'object') return x;
  if (Array.isArray(x)) {
    const out = new Array(x.length);
    for (let i = 0; i < x.length; i++) out[i] = cloneJson(x[i]);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const k in x) out[k] = cloneJson((x as Record<string, unknown>)[k]);
  return out as T;
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

type CardsInfo = Pick<GameState, 'cards' | 'restored'>;

// Варианты значков книги. У двужанровой книги с возвращёнными смыслами значок возвращения —
// ровно один значок, жанр которого (любой из двух) выбирается всякий раз, когда это важно:
// поэтому вариантов два. У прочих книг вариант один.
export function iconVariants(state: CardsInfo, id: string): Genre[][] {
  const c = state.cards[id];
  const restored = !!state.restored[id];
  if (c.kind === 'loadReturnable') return [restored ? [c.genre!, c.genre!, c.genre!] : []];
  if (!restored) return [c.icons];
  return [...new Set(c.icons)].map((g) => [...c.icons, g]);
}

// Значки книги (первый вариант). Число значков и набор жанров у всех вариантов одинаковы.
export function iconsOf(state: CardsInfo, id: string): Genre[] {
  return iconVariants(state, id)[0];
}

// Жанры гибкого значка возвращения (если он есть).
export function flexGenres(state: CardsInfo, id: string): Genre[] | null {
  const v = iconVariants(state, id);
  return v.length > 1 ? v.map((icons) => icons[icons.length - 1]) : null;
}

export interface StepOptions {
  wildScifi?: boolean; // «Заронить зерно»: значки Фантастики — значки любого жанра
  labtech?: boolean; // Лаборант: на 1 значок меньше (минимум 1)
}

// Закрывают ли книги ступень Ростка: перебираем выбор жанра гибких значков и Фантастики.
export function coversStep(state: CardsInfo, books: string[], main: Genre, need: number, support?: Genre, opts: StepOptions = {}): boolean {
  const reqs: { need: number; support?: Genre }[] = [{ need, support }];
  if (opts.labtech) {
    if (need > 1 || support) reqs.push({ need: Math.max(need - 1, support ? 0 : 1), support });
    if (support) reqs.push({ need });
  }
  const options = books.map((b) => iconVariants(state, b));
  const ok = (icons: Genre[], r: { need: number; support?: Genre }) => {
    let m = icons.filter((g) => g === main).length;
    let s = r.support ? icons.filter((g) => g === r.support).length : 0;
    let wild = opts.wildScifi && main !== 'scifi' && r.support !== 'scifi' ? icons.filter((g) => g === 'scifi').length : 0;
    if (r.support && s === 0 && wild > 0) { wild--; s = 1; }
    m += wild;
    return m >= r.need && (!r.support || s >= 1);
  };
  const go = (i: number, icons: Genre[]): boolean => {
    if (i === options.length) return reqs.some((r) => ok(icons, r));
    return options[i].some((v) => go(i + 1, [...icons, ...v]));
  };
  return go(0, []);
}

// Есть ли у игрока связь с Завсегдатаем (только полный режим).
export function hasPatron(state: Partial<Pick<GameState, 'patrons' | 'mode'>>, pid: string, id: PatronId): boolean {
  return state.mode === 'full' && !!state.patrons?.some((x) => x.id === id && !x.removed && x.connections.includes(pid));
}

export function isLoad(state: CardsInfo, id: string): boolean {
  const c = state.cards[id];
  if (c.kind === 'loadReturnable') return !state.restored[id];
  return c.kind === 'load' || c.kind === 'loadEvidence';
}

export function isFromLoadDeck(state: CardsInfo, id: string): boolean {
  const k = state.cards[id].kind;
  return k === 'load' || k === 'loadReturnable' || k === 'loadEvidence';
}

export function isEvidence(state: CardsInfo, id: string): boolean {
  const k = state.cards[id].kind;
  return k === 'evidence' || k === 'loadEvidence';
}

export function isPropaganda(state: CardsInfo, id: string): boolean {
  return state.cards[id].kind === 'propaganda';
}

// Опальная книга: Пропаганда, Улики и книги со значком опального жанра.
export function isBanned(state: CardsInfo & Pick<GameState, 'banned'>, id: string): boolean {
  if (isPropaganda(state, id) || isEvidence(state, id)) return true;
  return iconsOf(state, id).some((g) => state.banned.includes(g));
}

export function isGenreBook(state: CardsInfo, id: string): boolean {
  return iconsOf(state, id).length > 0;
}

// «Одиночная» книга — ровно 1 значок.
export function isSingle(state: CardsInfo, id: string): boolean {
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

// Заученный сборник поэзии лежит сверх склада и места не занимает.
export function freeSlots(p: PlayerState): number {
  return p.capacity - p.warehouse.filter((s) => !s.memorized).length;
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

// «Нагрузка прикрывает»: за каждые 2 карты Нагрузки на складе Тайник на 1 больше (даже сверх 5).
export function loadCover(state: CardsInfo, warehouse: { card: string | null }[]): number {
  return Math.floor(warehouse.filter((s) => s.card && isLoad(state, s.card)).length / 2);
}

export function cacheLimit(state: CardsInfo, p: { cache: number; warehouse: { card: string | null }[] }): number {
  return p.cache + loadCover(state, p.warehouse);
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

// Начислить очки Гласности по ходу игры, запомнив источник.
// Римская цифра для ступеней Ростков (1–10).
export function roman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

// Получить Талоны. Цеховик: каждое получение Талонов — на RULES.tsekhovikBonus больше (отдельной строкой в журнале).
export function earn(state: GameState, p: PlayerState, n: number) {
  if (n <= 0) return;
  p.talons += n;
  if (hasPatron(state, p.id, 'tsekhovik')) {
    p.talons += RULES.tsekhovikBonus;
    log(state, `${p.name}: Цеховик — ещё +${RULES.tsekhovikBonus} Талон.`);
  }
}

export function gain(p: PlayerState, n: number, source: PointSource) {
  if (!n) return;
  p.points += n;
  p.pointsBy[source] = (p.pointsBy[source] ?? 0) + n;
}

// Вспомогательные функции: случайность, карты, игроки.
import { GENRE_SHORT, RULES } from './content';
import type { GameState, Genre, PatronId, PlayerState, PointSource } from './types';
import { GENRES } from './types';

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

// Тайная запись-пересказ уже увиденного игроком («Вы оставили…»): нового знания не даёт, «Назад» после неё возможен.
export function logRecap(state: GameState, text: string, only: string[]) {
  log(state, text, only);
  state.log[state.log.length - 1].recap = true;
}

// Событие партии отдельной жирной строкой (начало Пятилетки, Посиделки, Укрытие, Облава).
export function logEvent(state: GameState, text: string) {
  log(state, text);
  state.log[state.log.length - 1].strong = true;
}

// Следствие действия (бонус Завсегдатая, свойство жанра) — строкой «↳ …» сразу после строки самого действия.
export function logAfter(state: GameState, text: string) {
  log(state, text);
  state.log[state.log.length - 1].after = true;
}

// Пояснение (что сейчас происходит, что можно сделать) — курсивом.
export function logNote(state: GameState, text: string) {
  log(state, text);
  state.log[state.log.length - 1].em = true;
}

export function player(state: GameState, id: string): PlayerState {
  const p = state.players.find((x) => x.id === id);
  check(p, 'Нет такого игрока');
  return p;
}

// Название книги для журнала — со значками: «[ПР ФА] «Название»» (у ЧНЛ, Улик и Нагрузки — их вид).
export function title(state: GameState, id: string): string {
  const c = state.cards[id];
  const icons = iconsOf(state, id);
  const kind = isPropaganda(state, id) ? 'ЧНЛ' : isExposed(state, id) ? 'Разоблачение' : isEvidence(state, id) ? 'УЛ'
    : isLoad(state, id) ? 'Нагрузка' : '';
  const tag = c.wild ? (state.restored[id] ? 'Любой жанр ×2' : 'Любой жанр') : icons.length ? icons.map((g) => GENRE_SHORT[g]).join(' ') : kind;
  // Возвращаемая Нагрузка: на обороте — вторая книга (3 значка её жанра после Возвращения смыслов).
  const back = c.kind === 'loadReturnable' && !state.restored[id] && c.returned
    ? ` / [${[c.genre!, c.genre!, c.genre!].map((g) => GENRE_SHORT[g]).join(' ')}] «${c.returned}»` : '';
  return `${tag ? `[${tag}] ` : ''}«${c.title}»${back}`;
}

// Несколько книг: до двух — через запятую, больше — списком, каждая с новой строки.
export function titles(state: GameState, ids: string[]): string {
  if (ids.length < 3) return ids.map((c) => title(state, c)).join(', ');
  return '\n' + ids.map((c) => `• ${title(state, c)}`).join('\n');
}

// ---------- Свойства карт ----------

type CardsInfo = Pick<GameState, 'cards' | 'restored'>;

// Варианты значков книги. У двужанровой книги с возвращёнными смыслами значок возвращения —
// ровно один значок, жанр которого (любой из двух) выбирается всякий раз, когда это важно:
// поэтому вариантов два. У прочих книг вариант один.
export function iconVariants(state: CardsInfo, id: string): Genre[][] {
  const c = state.cards[id];
  // «Чукоккала»: значок любого жанра; после Возвращения смыслов — два, каждый любого жанра.
  if (c.wild) return state.restored[id] ? GENRES.flatMap((g, i) => GENRES.slice(i).map((h) => [g, h])) : GENRES.map((g) => [g]);
  const restored = !!state.restored[id];
  if (c.kind === 'loadReturnable') return [restored ? [c.genre!, c.genre!, c.genre!] : []];
  if (c.kind === 'loadEvidence' || isPropagandaKind(c.kind)) return [[]]; // Нагрузка-улика и Разоблачение жанровых значков не получают
  if (!restored) return [c.icons];
  return [...new Set(c.icons)].map((g) => [...c.icons, g]);
}

// Значки книги (первый вариант). Число значков и набор жанров у всех вариантов одинаковы.
// У «Чукоккалы» — пусто: жанровых свойств у неё нет (Проза «Вдохновиться» и т. п.); число значков — iconCount,
// принадлежность к жанру (опала, Клуб, Подписка) — genresOf, подсчёты с выбором жанра — iconVariants.
export function iconsOf(state: CardsInfo, id: string): Genre[] {
  return state.cards[id].wild ? [] : iconVariants(state, id)[0];
}

export function isWild(state: CardsInfo, id: string): boolean {
  return !!state.cards[id].wild;
}

// Сколько у книги жанровых значков.
export function iconCount(state: CardsInfo, id: string): number {
  return state.cards[id].wild ? (state.restored[id] ? 2 : 1) : iconsOf(state, id).length;
}

// К каким жанрам книга относится (опала, Клуб, Подписка): у «Чукоккалы» — ко всем.
export function genresOf(state: CardsInfo, id: string): Genre[] {
  return state.cards[id].wild ? [...GENRES] : iconsOf(state, id);
}

// Жанры гибкого значка возвращения (если он есть).
export function flexGenres(state: CardsInfo, id: string): Genre[] | null {
  const v = iconVariants(state, id);
  return v.length > 1 ? v.map((icons) => icons[icons.length - 1]) : null;
}

export interface StepOptions {
  wildScifi?: boolean; // «Заронить зерно»: значки Фантастики — значки любого жанра
  labtech?: boolean; // Лаборант: скидка в значках, вид — RULES.labtechDiscount
}

// Свойство жанра включено (RULES.genreOff — выключенные, для замеров).
export const genreOn = (g: Genre) => !RULES.genreOff.includes(g);

// Закрывают ли книги ступень Ростка: перебираем выбор жанра гибких значков и Фантастики.
export function coversStep(state: CardsInfo, books: string[], main: Genre, need: number, support?: Genre, opts: StepOptions = {}): boolean {
  const reqs: { need: number; support?: Genre }[] = [{ need, support }];
  if (opts.labtech && RULES.labtechDiscount === 'support' && support) reqs.push({ need });
  if (opts.labtech && RULES.labtechDiscount === 'main' && need > 1) reqs.push({ need: need - 1, support });
  // Ступень IV — единственная, где основного жанра нужно 2 значка.
  if (opts.labtech && RULES.labtechDiscount === 'step4' && need > 1) reqs.push({ need: need - 1, support }, { need });
  const options = books.map((b) => iconVariants(state, b));
  const ok = (icons: Genre[], r: { need: number; support?: Genre }) => {
    let m = icons.filter((g) => g === main).length;
    let s = r.support ? icons.filter((g) => g === r.support).length : 0;
    let wild = opts.wildScifi && genreOn('scifi') && main !== 'scifi' && r.support !== 'scifi' ? icons.filter((g) => g === 'scifi').length : 0;
    if (r.support && s === 0 && wild > 0) { wild--; s = 1; }
    if (RULES.scifiWild === 'any') m += wild; // 'support' — основной жанр Фантастикой не заменить
    return m >= r.need && (!r.support || s >= 1);
  };
  const go = (i: number, icons: Genre[]): boolean => {
    if (i === options.length) return reqs.some((r) => ok(icons, r));
    return options[i].some((v) => go(i + 1, [...icons, ...v]));
  };
  return go(0, []);
}

// Лучший набор книг для ступени Ростка: меньше всего значков суммарно, при равенстве — меньше книг
// и без скидки Лаборанта. null — книг не хватает.
export function bestFeedBooks(state: CardsInfo, books: string[], main: Genre, need: number, support?: Genre, opts: StepOptions = {}): { books: string[]; labtech: boolean } | null {
  const icons = (b: string) => Math.max(...iconVariants(state, b).map((v) => v.length));
  const pool = books.filter((b) => icons(b) > 0).slice(0, 14);
  let best: { books: string[]; labtech: boolean; key: number } | null = null;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const set = pool.filter((_, i) => mask & (1 << i));
    const key = (set.reduce((a, b) => a + icons(b), 0) * 100 + set.length) * 2;
    if (best && key >= best.key) continue;
    if (coversStep(state, set, main, need, support, { ...opts, labtech: false })) best = { books: set, labtech: false, key };
    else if (opts.labtech && (!best || key + 1 < best.key) && coversStep(state, set, main, need, support, opts)) best = { books: set, labtech: true, key: key + 1 };
  }
  return best && { books: best.books, labtech: best.labtech };
}

// Есть ли у игрока связь с Завсегдатаем (только полный режим).
export function hasPatron(state: Partial<Pick<GameState, 'patrons' | 'mode'>>, pid: string, id: PatronId): boolean {
  return state.mode === 'full' && !!state.patrons?.some((x) => x.id === id && !x.removed && x.connections.includes(pid));
}

export function isLoad(state: CardsInfo, id: string): boolean {
  const c = state.cards[id];
  // Возвращаемая Нагрузка и Нагрузка-улика перестают быть Нагрузкой, когда им вернули смыслы.
  if (c.kind === 'loadReturnable' || c.kind === 'loadEvidence') return !state.restored[id];
  return c.kind === 'load';
}

export function isFromLoadDeck(state: CardsInfo, id: string): boolean {
  const k = state.cards[id].kind;
  return k === 'load' || k === 'loadReturnable' || k === 'loadEvidence' || k === 'loadPropaganda';
}

export function isEvidence(state: CardsInfo, id: string): boolean {
  const k = state.cards[id].kind;
  // Нагрузка-улика становится Уликой (опальной, +5 очков) только после Возвращения смыслов.
  return k === 'evidence' || (k === 'loadEvidence' && !!state.restored[id]);
}

// ЧНЛ: обычная (ЧНЛ) и Нагрузка-ЧНЛ (ПСС Ленина — из стопки Нагрузки, сдаётся в Красный уголок как Нагрузка,
// но Тайник не прикрывает).
export function isPropagandaKind(kind: string): boolean {
  return kind === 'propaganda' || kind === 'loadPropaganda';
}

export function isPropaganda(state: CardsInfo, id: string): boolean {
  return isPropagandaKind(state.cards[id].kind) && !state.restored[id];
}

// «Разоблачение» — ЧНЛ, которой вернули смыслы: +2 очка в конце (на складе или изданная).
export function isExposed(state: CardsInfo, id: string): boolean {
  return isPropagandaKind(state.cards[id].kind) && !!state.restored[id];
}

// Опальная книга: ЧНЛ, Улики и книги со значком опального жанра.
export function isBanned(state: CardsInfo & Pick<GameState, 'banned'>, id: string): boolean {
  if (isPropaganda(state, id) || isEvidence(state, id)) return true;
  return genresOf(state, id).some((g) => state.banned.includes(g));
}

export function isGenreBook(state: CardsInfo, id: string): boolean {
  return iconCount(state, id) > 0;
}

// «Одиночная» книга — ровно 1 значок.
export function isSingle(state: CardsInfo, id: string): boolean {
  return state.cards[id].kind === 'genre' && iconCount(state, id) === 1;
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

// В сброс книга уходит без жетона Возвращения смыслов (Разоблачение снова становится ЧНЛ).
export function discard(state: GameState, id: string) {
  delete state.restored[id];
  if (isFromLoadDeck(state, id)) {
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

// Книга, взятая взакрытую (из стопки, сброса, Спецхрана, с Барахолки): если в Тайнике есть место, она сразу ложится туда,
// и соперники так и не узнают, что это за книга. Нагрузку не прячем — от облавы её укрывать незачем.
// how — как взята книга: «вслепую» (из стопки, не глядя) или «взакрытую» (сам видел, соперники — нет: Барахолка).
// how = null — без строки в журнале (о Тайнике пишет вызывающий).
export function addSecretBook(state: GameState, p: PlayerState, id: string, how: string | null = 'вслепую') {
  addBook(p, id);
  if (isLoad(state, id)) return;
  const used = p.warehouse.filter((s) => s.hidden).length;
  if (used < cacheLimit(state, p)) {
    p.warehouse[p.warehouse.length - 1].hidden = true;
    if (how) log(state, `${p.name} берёт книгу ${how} и кладёт в Тайник.`);
  }
}

// Книга, открыто взятая со стола: все видят, что это. ЧНЛ запоминаем — так ведёт себя Куратор.
export function addOpenBook(state: GameState, p: PlayerState, id: string) {
  addBook(p, id);
  if (isPropaganda(state, id)) p.propagandaTaken = (p.propagandaTaken ?? 0) + 1;
  autoHide(state, p, id);
}

// По умолчанию: опальная книга (не ЧНЛ — её изъятие обычному игроку на руку) сразу ложится в Тайник, если там есть место.
// Тайник можно пересобрать в свой ход. Соперники и так видели, что это за книга, — прячем от облавы и Конторы.
export function autoHide(state: GameState, p: PlayerState, id: string) {
  const slot = p.warehouse.find((s) => s.card === id);
  if (!slot || slot.hidden || slot.memorized || !isBanned(state, id) || isPropaganda(state, id)) return;
  if (p.warehouse.filter((s) => s.hidden).length < cacheLimit(state, p)) slot.hidden = true;
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

// Сэкономленные Завсегдатаем Талоны (статистика: p.talonsSaved).
export function saved(p: PlayerState, source: string, n: number) {
  if (n > 0) (p.talonsSaved ??= {})[source] = (p.talonsSaved[source] ?? 0) + n;
}

// Получить Талоны. Цеховик даёт +1 не здесь, а раз за действие — в конце действия (tsekhovikBonus в engine.ts).
// source — откуда Талоны (для статистики: p.talonsBy); одно получение может складываться из частей (адрес + Завсегдатай).
export function earn(state: GameState, p: PlayerState, n: number, source: string | Record<string, number>) {
  const parts = typeof source === 'string' ? { [source]: n } : source;
  n = Object.values(parts).reduce((a, b) => a + b, 0);
  if (n <= 0) return;
  p.talons += n;
  for (const [k, v] of Object.entries(parts)) if (v > 0) (p.talonsBy ??= {})[k] = (p.talonsBy?.[k] ?? 0) + v;
  p.talonsEarned = true;
}

export function gain(p: PlayerState, n: number, source: PointSource) {
  if (!n) return;
  p.points += n;
  p.pointsBy[source] = (p.pointsBy[source] ?? 0) + n;
}

// Книги уходят в Спецхран при всех (изъятие по доносу или при облаве) — их знает каждый.
export function toSpetskhranPublic(state: GameState, cards: string[]) {
  state.spetskhran.push(...cards);
  state.spetskhranSeen ??= {};
  for (const p of state.players) state.spetskhranSeen[p.id] = [...(state.spetskhranSeen[p.id] ?? []), ...cards];
}

// Игрок увидел книги Спецхрана (Выдача на руки).
export function seeSpetskhran(state: GameState, playerId: string, cards: string[]) {
  state.spetskhranSeen ??= {};
  state.spetskhranSeen[playerId] = [...new Set([...(state.spetskhranSeen[playerId] ?? []), ...cards])];
}

// Книга покинула Спецхран — помнить её там больше незачем.
export function forgetSpetskhran(state: GameState, card: string) {
  for (const id of Object.keys(state.spetskhranSeen ?? {})) state.spetskhranSeen![id] = state.spetskhranSeen![id].filter((c) => c !== card);
}

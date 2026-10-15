// «Думающий» бот: примеряет допустимые ходы на копии партии и выбирает тот, после которого
// оценка положения выше. Оценку задаёт пресет (см. bot-presets.ts).
//
// Честность: бот не подглядывает в закрытые карты. Перед примеркой он перемешивает свою копию
// стопок и Барахолки, поэтому вытянутая при примерке книга — догадка, а не знание.
import { applyAction, mustVisitRedCorner } from './engine';
import { BOT_BASE, type BotGoal, type BotPreset } from './bot-presets';
import { PERMANENT_ADDRESSES, PASSIONS, RULES, SPROUTS, STEP_REWARDS, FIRST_FEED_POINTS, ADDRESSES } from './content';
import { passionPoints } from './scoring';
import type { Action, ClubGift, CopyTextAddress, GameState, Genre, GroupAction, PlayerState } from './types';
import { GENRES } from './types';
import {
  cacheLimit, cloneJson, coversStep, freeSlots, hasPatron, iconsOf, isBanned, isEvidence, isGenreBook, isLoad, isPropaganda, player, RuleError,
} from './util';

type Rand = () => number;

interface Ctx {
  me: string;
  preset: BotPreset;
  round: number;
  w: Record<BotGoal, number>; // множители целей в эту Пятилетку (вес / 5)
  talon: number; // ценность Талона
  glasnost: number; // ценность ступени до порога Гласности
}

const SAMPLES = 2; // сколько раз перемешивать закрытые карты при примерке

function makeCtx(state: GameState, me: string, preset: BotPreset): Ctx {
  const r = Math.min(Math.max(state.round, 1), RULES.rounds);
  const w = Object.fromEntries(
    (Object.keys(preset.goals) as BotGoal[]).map((g) => [g, (preset.goals[g][r - 1] ?? 5) / 5]),
  ) as Record<BotGoal, number>;
  // Срочность Гласности: сколько ступеней ещё нужно против того, сколько ходов осталось.
  const need = state.sprouts.reduce((s, sp) => s + Math.max(0, RULES.glasnostStep - sp.progress), 0);
  const roundsLeft = RULES.rounds - r + 1;
  const urgency = Math.min(2.5, Math.max(0.6, need / Math.max(1, roundsLeft * state.players.length * 0.5)));
  return { me, preset, round: r, w, talon: BOT_BASE.talon[r - 1] ?? 0.5, glasnost: BOT_BASE.glasnostStep * urgency };
}

// ---------- Оценка положения ----------

function stepReward(state: GameState, p: PlayerState, progress: number, sproutId: string, ctx: Ctx): number {
  const r = STEP_REWARDS[progress];
  let v = r.points + r.talons * ctx.talon * ctx.w.talons;
  if (!p.sproutsFed.includes(sproutId)) v += FIRST_FEED_POINTS;
  v += progress < RULES.glasnostStep ? ctx.glasnost * ctx.w.sprouts * (BOT_BASE.glasnostLag[progress] ?? 1) : BOT_BASE.lateStep;
  return v;
}

function stepOpts(state: GameState, me: string) {
  return { wildScifi: state.mode === 'full', labtech: hasPatron(state, me, 'labtech') };
}

// Насколько книги на складе готовы закрыть ближайшие ступени Ростков.
function feedPotential(state: GameState, p: PlayerState, ctx: Ctx): number {
  const books = p.warehouse.map((s) => s.card).filter((c) => isGenreBook(state, c));
  let v = 0;
  for (const sp of state.sprouts) {
    const info = SPROUTS.find((s) => s.id === sp.id)!;
    const step = info.steps[sp.progress];
    if (!step) continue;
    const reward = stepReward(state, p, sp.progress, sp.id, ctx);
    if (coversStep(state, books, info.main, step.main, step.support, stepOpts(state, p.id))) {
      v += reward * BOT_BASE.feedReady;
      continue;
    }
    // Часть нужного уже есть: значки основного жанра и значок поддержки.
    const icons = books.flatMap((b) => iconsOf(state, b));
    const main = Math.min(1, icons.filter((g) => g === info.main).length / step.main);
    const frac = step.support ? (main + (icons.includes(step.support) ? 1 : 0)) / 2 : main;
    v += reward * BOT_BASE.feedPartial * frac;
  }
  return v;
}

// Чем ценна для бота книга одного жанра (для Подписки).
function genreValue(state: GameState, p: PlayerState, g: Genre, ctx: Ctx): number {
  const info = p.passion ? PASSIONS[p.passion] : null;
  let passion = 0;
  if (info?.genres) passion = info.genres.includes(g) ? RULES.passionKeeper : 0;
  else if (p.passion === 'erudite') passion = RULES.passionErudite * 0.75; // засчитается, только если жанра ещё нет
  else if (p.passion === 'monogamist') passion = RULES.passionMonogamist * 0.5; // засчитается, только если жанр станет лучшим
  let v = passion * ctx.w.passion + BOT_BASE.bookLatent * ctx.w.publish;
  const demand = state.sprouts.filter((sp) => {
    const s = SPROUTS.find((x) => x.id === sp.id)!;
    return sp.progress < 4 && (s.main === g || s.steps[sp.progress]?.support === g);
  }).length;
  v += demand * 1.5 * ctx.w.sproutBooks;
  return v;
}

function ownBookValue(state: GameState, p: PlayerState, card: string, ctx: Ctx): number {
  if (isPropaganda(state, card)) return RULES.propagandaPoints;
  let v = iconsOf(state, card).length * BOT_BASE.bookLatent * ctx.w.publish;
  if (isEvidence(state, card)) v += RULES.evidencePoints;
  return v;
}

// Опальные книги, которые не поместятся в Тайник, — их изымет облава. Возвращает самые дешёвые из них.
function atRisk(state: GameState, p: PlayerState, value: (c: string) => number): string[] {
  const banned = p.warehouse
    .filter((s) => !s.memorized && isBanned(state, s.card) && !isPropaganda(state, s.card))
    .map((s) => s.card);
  const excess = banned.length - cacheLimit(state, p);
  if (excess <= 0) return [];
  return banned.sort((a, b) => value(a) - value(b)).slice(0, excess);
}

export function evaluate(state: GameState, me: string, ctx: Ctx): number {
  const p = player(state, me);
  const left = RULES.rounds - ctx.round; // Пятилеток после текущей
  const w = ctx.w;
  const cards = p.warehouse.map((s) => s.card);

  let v = p.points;
  // Финальный подсчёт.
  v += passionPoints(state, p) * w.passion;
  v += RULES.propagandaPoints * cards.filter((c) => isPropaganda(state, c)).length;
  v += RULES.evidencePoints * [...cards, ...p.tamizdat].filter((c) => isEvidence(state, c)).length;
  v += BOT_BASE.connection * state.patrons.filter((x) => !x.removed && x.connections.includes(me)).length;
  // Ресурсы.
  v += p.talons * ctx.talon * w.talons;
  const reserve = ctx.preset.character.reserve;
  if (p.talons < reserve) v -= (reserve - p.talons) * ctx.talon;
  v += p.workers * left * BOT_BASE.action * w.network;
  v += (p.available + p.bonusGroupTurns * 0.7) * BOT_BASE.action;
  v += (p.capacity * (BOT_BASE.capacity[ctx.round - 1] ?? 0) + p.cache * (BOT_BASE.cache[ctx.round - 1] ?? 0)) * w.storage;
  v += Math.max(0, freeSlots(p)) * BOT_BASE.freeSlot;
  for (const sub of p.subscriptions) v += sub.rounds * genreValue(state, p, sub.genre, ctx) * 0.8;
  // Книги.
  for (const c of cards) v += iconsOf(state, c).length * BOT_BASE.bookLatent * w.publish;
  v += p.published.reduce((s, c) => s + iconsOf(state, c).length, 0) * BOT_BASE.published * w.publish;
  v += feedPotential(state, p, ctx) * w.sproutBooks;
  // Ростки — общее дело: без Гласности проигрывают все.
  for (const sp of state.sprouts) {
    for (let k = 0; k < Math.min(sp.progress, RULES.glasnostStep); k++) v += ctx.glasnost * w.sprouts * (BOT_BASE.glasnostLag[k] ?? 1);
    v += Math.max(0, sp.progress - RULES.glasnostStep) * BOT_BASE.lateStep;
  }
  // Облава: книги сверх Тайника пропадут.
  if (state.phase !== 'end' && state.phase !== 'passion') {
    const risky = atRisk(state, p, (c) => ownBookValue(state, p, c, ctx));
    if (risky.length) {
      const without = { ...p, warehouse: p.warehouse.filter((s) => !risky.includes(s.card)) };
      const lost = (passionPoints(state, p) - passionPoints(state, without)) * w.passion
        + risky.reduce((s, c) => s + ownBookValue(state, p, c, ctx), 0);
      v -= lost * ctx.preset.character.caution;
    }
  }
  // Очередь хода в следующей Пятилетке.
  const pos = state.nextOrder.indexOf(me);
  if (pos >= 0 && left > 0) v += BOT_BASE.turnOrder * (state.players.length - pos) / state.players.length;
  return v;
}

// ---------- Примерка ----------

function shuffleWith<T>(arr: T[], rand: Rand): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Копия для примерки: без журнала и без копирования неизменного справочника карт.
function cloneLight(state: GameState): GameState {
  const { cards, log, ...rest } = state;
  void log;
  return { ...cloneJson(rest), cards, log: [] };
}

// Копия партии, в которой закрытые карты перемешаны: бот знает состав стопок, но не порядок.
function determinize(state: GameState, rand: Rand): GameState {
  const s = cloneLight(state);
  const looking = s.pending.some((x) => x.kind === 'baraholkaLook');
  // Сортируем перед перемешиванием, чтобы настоящий порядок карт никак не влиял на решение.
  const pool = [...s.deck, ...(looking ? [] : s.baraholka.filter((c): c is string => !!c))].sort();
  shuffleWith(pool, rand);
  if (!looking) s.baraholka = s.baraholka.map((c) => (c ? pool.pop()! : null));
  s.deck = pool;
  s.loadDeck = shuffleWith([...s.loadDeck].sort(), rand);
  s.rng = Math.floor(rand() * 2 ** 31);
  return s;
}

// Отложенные решения, которые бот при примерке додумывает сам (они следуют сразу за ходом).
const FOLLOW_UP = new Set(['sproutBonus', 'posrednichestvoKeep', 'posrednichestvoGroup', 'baraholkaLook', 'naslednikiPick', 'extraGroup', 'discardExcess']);

function tryApply(state: GameState, me: string, a: Action): GameState | null {
  try {
    return applyAction(state, me, a);
  } catch (e) {
    if (e instanceof RuleError) return null;
    throw e;
  }
}

function score(state: GameState, me: string, a: Action, ctx: Ctx, depth: number): number | null {
  const next = tryApply(state, me, a);
  if (!next) return null;
  const pend = next.pending[0];
  if (depth > 0 && pend && pend.player === me && FOLLOW_UP.has(pend.kind)) {
    let best: number | null = null;
    for (const b of candidates(next, me, ctx)) {
      const v = score(next, me, b, ctx, depth - 1);
      if (v !== null && (best === null || v > best)) best = v;
    }
    if (best !== null) return best;
  }
  return evaluate(next, me, ctx);
}

// Лучшие по оценке ходы, от лучшего к худшему.
export function rankActions(state: GameState, me: string, preset: BotPreset, rand: Rand): { a: Action; v: number }[] {
  const ctx = makeCtx(state, me, preset);
  const cands = candidates(state, me, ctx);
  if (!cands.length) return [];
  const samples = Array.from({ length: SAMPLES }, () => determinize(state, rand));
  const rated: { a: Action; v: number }[] = [];
  for (const a of cands) {
    let sum = 0;
    let ok = true;
    for (const s of samples) {
      const v = score(s, me, a, ctx, 2);
      if (v === null) { ok = false; break; }
      sum += v;
    }
    if (ok) rated.push({ a, v: sum / samples.length });
  }
  // Немного случайности: оценка ±randomness×2 очка.
  const noise = preset.character.randomness * 2;
  for (const r of rated) r.v += (rand() - 0.5) * 2 * noise;
  return rated.sort((x, y) => y.v - x.v);
}

export function smartMove(state: GameState, me: string, preset: BotPreset, rand: Rand): GameState | null {
  for (const r of rankActions(state, me, preset, rand)) {
    const next = tryApply(state, me, r.a);
    if (next) return next;
  }
  return null;
}

// ---------- Варианты ходов ----------

function keepValues(state: GameState, me: string, ctx: Ctx): Map<string, number> {
  // Сколько потеряет бот, если книги не станет: так он решает, чем жертвовать.
  const p = player(state, me);
  const base = evaluate(state, me, ctx);
  const out = new Map<string, number>();
  for (const slot of p.warehouse) {
    const s = cloneLight(state);
    const q = player(s, me);
    q.warehouse = q.warehouse.filter((x) => x.card !== slot.card);
    out.set(slot.card, base - evaluate(s, me, ctx) + BOT_BASE.freeSlot);
  }
  return out;
}

function subsets<T>(arr: T[], max: number): T[][] {
  const out: T[][] = [];
  const go = (start: number, cur: T[]) => {
    if (cur.length) out.push([...cur]);
    if (cur.length === max) return;
    for (let i = start; i < arr.length; i++) go(i + 1, [...cur, arr[i]]);
  };
  go(0, []);
  return out;
}

// Самый дешёвый набор книг, закрывающий ступень Ростка.
function cheapestFeed(state: GameState, me: string, books: string[], sproutId: string, progress: number, keep: Map<string, number>): string[] | null {
  const info = SPROUTS.find((s) => s.id === sproutId)!;
  const step = info.steps[progress];
  if (!step) return null;
  const opts = stepOpts(state, me);
  const useful = books.filter((b) => {
    const icons = iconsOf(state, b);
    return icons.includes(info.main) || (step.support && icons.includes(step.support)) || (opts.wildScifi && icons.includes('scifi'));
  });
  if (!coversStep(state, useful, info.main, step.main, step.support, opts)) return null;
  let best: string[] | null = null;
  let bestCost = Infinity;
  for (const set of subsets(useful, 3)) {
    if (!coversStep(state, set, info.main, step.main, step.support, opts)) continue;
    const cost = set.reduce((s, b) => s + (keep.get(b) ?? 0), 0);
    if (cost < bestCost) { bestCost = cost; best = set; }
  }
  return best;
}

function sproutCandidates(state: GameState, me: string, keep: Map<string, number>): Action[] {
  const p = player(state, me);
  const books = p.warehouse.map((s) => s.card).filter((c) => isGenreBook(state, c));
  const out: Action[] = [];
  for (const sp of state.sprouts) {
    const feed = cheapestFeed(state, me, books, sp.id, sp.progress, keep);
    if (feed) out.push({ type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: feed }] } });
  }
  // Жадно: закрыть за одно действие всё, что получается.
  const progress = new Map(state.sprouts.map((s) => [s.id, s.progress]));
  let left = [...books];
  const feeds: { sprout: string; books: string[] }[] = [];
  for (let changed = true; changed;) {
    changed = false;
    const options = state.sprouts
      .map((sp) => ({ sp, feed: cheapestFeed(state, me, left, sp.id, progress.get(sp.id)!, keep) }))
      .filter((x): x is { sp: typeof x.sp; feed: string[] } => !!x.feed)
      .sort((a, b) => progress.get(a.sp.id)! - progress.get(b.sp.id)!);
    const first = options[0];
    if (first) {
      feeds.push({ sprout: first.sp.id, books: first.feed });
      progress.set(first.sp.id, progress.get(first.sp.id)! + 1);
      left = left.filter((b) => !first.feed.includes(b));
      changed = true;
    }
  }
  if (feeds.length > 1) out.push({ type: 'place', place: { address: 'sprouts', feeds } });
  return out;
}

// Все варианты Тиражирования: где и что купить и какую открытую книгу оттуда же взять бесплатно.
export function copyTextOptions(state: GameState, me: string): GroupAction[] {
  const out: GroupAction[] = [];
  const p = player(state, me);
  // Бесплатно тиражировать можно только жанровые книги (не Улики и не Пропаганду).
  const others = (list: (string | null)[], taken?: string) => list.filter((c): c is string => !!c && c !== taken && isGenreBook(state, c));
  state.razval.forEach((c, slot) => {
    if (c) for (const card of others(state.razval, c)) out.push({ action: 'copyText', address: 'razval', buy: { address: 'razval', slot }, card });
  });
  // Мало места — можно освободить его, продав на Толкучке свою книгу.
  const sells: (string | null)[] = [null];
  if (freeSlots(p) < 2) {
    for (const s of p.warehouse) {
      if (isGenreBook(state, s.card) && !isEvidence(state, s.card) && !isPropaganda(state, s.card)) sells.push(s.card);
    }
  }
  for (const c of state.tolkuchka) {
    for (const card of others(state.tolkuchka, c)) {
      for (const sell of sells) {
        const ops = [...(sell ? [{ op: 'sell' as const, card: sell }] : []), { op: 'buy' as const, card: c }];
        out.push({ action: 'copyText', address: 'tolkuchka', buy: { address: 'tolkuchka', ops }, card });
      }
    }
  }
  if (state.safehouses.includes('raspredelitel')) {
    for (const c of state.raspredelitel) {
      for (const card of others(state.raspredelitel, c)) out.push({ action: 'copyText', address: 'raspredelitel', buy: { address: 'raspredelitel', card: c }, card });
    }
  }
  if (state.safehouses.includes('knigoobmen')) {
    // Обменять одну из двух самых скромных своих книг и взять ещё одну даром.
    const give = p.warehouse.map((s) => s.card).filter((c) => isGenreBook(state, c))
      .sort((x, y) => iconsOf(state, x).length - iconsOf(state, y).length).slice(0, 2);
    for (const g of give) for (const take of state.knigoobmen) {
      for (const card of others(state.knigoobmen, take)) out.push({ action: 'copyText', address: 'knigoobmen', buy: { address: 'knigoobmen', give: g, take }, card });
    }
  }
  return out;
}

function groupCandidates(state: GameState, me: string, ctx: Ctx): GroupAction[] {
  const p = player(state, me);
  const out: GroupAction[] = [{ action: 'expandWarehouse' }, { action: 'expandCache' }];
  if (ctx.w.network > 0) out.push({ action: 'hire' });
  out.push(...copyTextOptions(state, me));
  for (const s of p.warehouse) {
    if (!state.restored[s.card] && ['genre', 'loadReturnable'].includes(state.cards[s.card].kind)) out.push({ action: 'restore', card: s.card });
  }
  const held = state.players.filter((o) => o.held > 0);
  if (held.length) out.push({ action: 'rescue', returns: Object.fromEntries(held.map((o) => [o.id, Math.min(o.held, 2)])) });
  return out;
}

function clubGifts(state: GameState, me: string): ClubGift[] {
  const p = player(state, me);
  const out: ClubGift[] = [];
  for (const pt of state.patrons) {
    if (pt.removed || pt.turned || pt.connections.includes(me)) continue;
    for (const s of p.warehouse) if (iconsOf(state, s.card).includes(pt.genre)) out.push({ patron: pt.id, card: s.card });
  }
  return out;
}

function byValue(keep: Map<string, number>, cards: string[]): string[] {
  return [...cards].sort((a, b) => (keep.get(a) ?? 0) - (keep.get(b) ?? 0));
}

function redCornerCandidates(state: GameState, me: string, keep: Map<string, number>): Action[] {
  const p = player(state, me);
  const cards = p.warehouse.map((s) => s.card);
  const prop = cards.find((c) => isPropaganda(state, c));
  const unprinted = byValue(keep, cards.filter((c) => !isLoad(state, c) && state.cards[c].kind !== 'loadEvidence' && state.cards[c].kind !== 'loadReturnable'));
  const loads = cards.filter((c) => isLoad(state, c) && !isEvidence(state, c));
  const ups = prop ? [prop] : unprinted.slice(0, 1);
  const out: string[][] = [[]];
  for (const u of [...ups, null]) for (const l of [loads[0], null]) {
    const r = [u, l].filter((x): x is string => !!x);
    if (r.length) out.push(r);
  }
  return out.map((recycle) => ({ type: 'place', place: { address: 'redCorner', recycle } }));
}

export function candidates(state: GameState, me: string, ctx: Ctx): Action[] {
  const p = player(state, me);
  const books = p.warehouse.map((s) => s.card);
  let cached: Map<string, number> | null = null;
  const keepMap = () => (cached ??= keepValues(state, me, ctx));
  const pend = state.pending[0];
  if (pend && pend.player === me) {
    switch (pend.kind) {
      case 'baraholkaLook': return [{ type: 'baraholkaBuy', buy: true }, { type: 'baraholkaBuy', buy: false }];
      case 'kvartirnikReply': return [{ type: 'kvartirnikReply', accept: true }, { type: 'kvartirnikReply', accept: false }];
      case 'naslednikiPick': {
        const singles = pend.cards.map((c) => [c]);
        return [...singles, ...subsets(pend.cards.slice(-8), 2).filter((x) => x.length === 2)].map((cards) => ({ type: 'naslednikiPick', cards }));
      }
      case 'posrednichestvoKeep': return subsets(pend.cards, 2).map((keep) => ({ type: 'posrednichestvoKeep', keep }));
      case 'posrednichestvoGroup':
      case 'extraGroup':
        return [...groupCandidates(state, me, ctx).map((group) => ({ type: 'group' as const, group })), { type: 'pass' }];
      case 'sproutBonus': {
        const out: Action[] = [];
        for (const b of pend.options) {
          if (b === 'sideJob' || b === 'underCounter') out.push({ type: 'sproutBonus', bonus: b });
          else for (const g of groupCandidates(state, me, { ...ctx, w: { ...ctx.w, network: 1 } })) if (g.action === b) out.push({ type: 'sproutBonus', bonus: b, group: g });
        }
        return [...out, { type: 'pass' }];
      }
      case 'discardExcess': return [{ type: 'discardExcess', cards: byValue(keepMap(), books).slice(0, pend.count) }];
      default: return []; // остальное решает простой бот
    }
  }
  switch (state.phase) {
    case 'passion': return p.passionOptions.map((x) => ({ type: 'choosePassion', passion: x }));
    case 'gathering': {
      // Показать всё, за что дают очки: опальные жанровые книги (в полном режиме и драматургию).
      const full = state.mode === 'full';
      const show = [...new Set([...books, ...(full ? p.published : [])])].filter((c) => {
        const drama = full && iconsOf(state, c).includes('drama');
        return drama || (books.includes(c) && isGenreBook(state, c) && isBanned(state, c));
      });
      return [{ type: 'gathering', show }];
    }
    case 'hiding': {
      const limit = cacheLimit(state, { ...p, warehouse: p.warehouse.map((s) => ({ ...s, hidden: false })) });
      const banned = books.filter((b) => isBanned(state, b) && !isPropaganda(state, b) && !p.warehouse.find((s) => s.card === b)?.memorized);
      return [{ type: 'hiding', hidden: byValue(keepMap(), banned).reverse().slice(0, limit) }];
    }
    case 'orders': {
      const groups = () => groupCandidates(state, me, ctx).filter((g) => !p.groupUsed.includes(g.action)).map((group) => ({ type: 'group' as const, group }));
      if (p.available === 0) return [...groups(), { type: 'pass' }];
      if (mustVisitRedCorner(state, p)) return redCornerCandidates(state, me, keepMap());
      const out: Action[] = [...groups()];
      if (!p.visitedRedCorner) out.push(...redCornerCandidates(state, me, keepMap()));
      else out.push({ type: 'pass' });
      const genreBooks = books.filter((b) => isGenreBook(state, b));
      const addrs = [...PERMANENT_ADDRESSES, ...state.safehouses].filter((a) => !ADDRESSES[a].fullOnly || state.mode === 'full');
      for (const a of addrs) {
        switch (a) {
          case 'gostorg':
            for (let n = 1; n <= Math.min(3, Math.floor(freeSlots(p) / 2), p.talons); n++) out.push({ type: 'place', place: { address: 'gostorg', pairs: n } });
            break;
          case 'tolkuchka': {
            const sellable = genreBooks.filter((b) => !isEvidence(state, b));
            for (const b of sellable) out.push({ type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'sell', card: b }] } });
            const risky = atRisk(state, p, (c) => keepMap().get(c) ?? 0).filter((c) => sellable.includes(c));
            if (risky.length > 1) out.push({ type: 'place', place: { address: 'tolkuchka', ops: risky.map((card) => ({ op: 'sell' as const, card })) } });
            for (const c of state.tolkuchka) {
              out.push({ type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'buy', card: c }] } });
              if (risky.length) out.push({ type: 'place', place: { address: 'tolkuchka', ops: [...risky.map((card) => ({ op: 'sell' as const, card })), { op: 'buy', card: c }] } });
            }
            break;
          }
          case 'razval': state.razval.forEach((c, slot) => c && out.push({ type: 'place', place: { address: 'razval', slot } })); break;
          case 'zavoz': out.push({ type: 'place', place: { address: 'zavoz' } }); break;
          case 'baraholka': {
            const slot = state.baraholka.findIndex((c) => c);
            if (slot >= 0) out.push({ type: 'place', place: { address: 'baraholka', slot } });
            break;
          }
          case 'podpiska':
            for (const genre of GENRES) for (const talons of [1, 2, 3]) {
              if (talons <= RULES.rounds - state.round + 1) out.push({ type: 'place', place: { address: 'podpiska', genre, talons } });
            }
            break;
          case 'sprouts': out.push(...sproutCandidates(state, me, keepMap())); break;
          case 'samizdat':
            for (const b of genreBooks) if (!isEvidence(state, b)) out.push({ type: 'place', place: { address: a, card: b } });
            break;
          case 'tamizdat':
            for (const b of books) if (isGenreBook(state, b) || isEvidence(state, b)) out.push({ type: 'place', place: { address: a, card: b } });
            break;
          case 'knigoobmen': {
            const give = byValue(keepMap(), genreBooks).slice(0, 2);
            for (const g of give) for (const take of state.knigoobmen) out.push({ type: 'place', place: { address: 'knigoobmen', give: g, take } });
            break;
          }
          case 'raspredelitel': for (const c of state.raspredelitel) out.push({ type: 'place', place: { address: 'raspredelitel', card: c } }); break;
          case 'nasledniki': case 'posrednichestvo': case 'spisanie': out.push({ type: 'place', place: { address: a } }); break;
          case 'club': for (const gift of clubGifts(state, me)) out.push({ type: 'place', place: { address: 'club', gifts: [gift] } }); break;
          // Квартирник (нужно угадать ответ соседа) и Контора пока не используются.
        }
      }
      return out;
    }
  }
  return [];
}

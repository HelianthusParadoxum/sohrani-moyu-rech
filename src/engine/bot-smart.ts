// «Думающий» бот: примеряет допустимые ходы на копии партии и выбирает тот, после которого
// оценка положения выше. Оценку задаёт пресет (см. bot-presets.ts).
//
// Честность: бот не подглядывает в закрытые карты. Перед примеркой он перемешивает свою копию
// стопок и Барахолки, поэтому вытянутая при примерке книга — догадка, а не знание.
import { applyAction, mustVisitRedCorner } from './engine';
import { BOT_BASE, type BotGoal, type BotPreset } from './bot-presets';
import { PERMANENT_ADDRESSES, PASSIONS, RULES, SPROUTS, STEP_REWARDS, FIRST_FEED_POINTS, ADDRESSES, KONTORA_LOSS } from './content';
import { heldTotal, kontoraTargets } from './full';
import { passionPoints } from './scoring';
import type { Action, ClubGift, CopyTextAddress, GameState, Genre, GroupAction, KontoraChoice, PatronId, PlayerState } from './types';
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
  full: boolean; // полный режим
  curator: boolean; // бот — Куратор: побеждает, если Гласность не наступит
  aggression: number; // готовность вредить соперникам (полный режим)
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
  // В полном режиме на 3+ игроков среди соперников, возможно, Куратор: кормит Ростки на одного меньше.
  const feeders = state.players.length - (state.mode === 'full' && state.players.length >= 3 ? 1 : 0);
  const urgency = Math.min(2.5, Math.max(0.6, need / Math.max(1, roundsLeft * feeders * 0.5)));
  return {
    me, preset, round: r, w, talon: BOT_BASE.talon[r - 1] ?? 0.5, glasnost: BOT_BASE.glasnostStep * urgency,
    full: state.mode === 'full', curator: player(state, me).passion === 'curator', aggression: preset.character.aggression ?? 0,
  };
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
  if (isPropaganda(state, card)) return ctx.curator ? BOT_BASE.curatorPropaganda : RULES.propagandaPoints;
  let v = iconsOf(state, card).length * BOT_BASE.bookLatent * ctx.w.publish;
  if (isEvidence(state, card)) v += RULES.evidencePoints;
  return v;
}

// Опальные книги, которые не поместятся в Тайник, — их изымет облава. Возвращает самые дешёвые из них.
// keepPropaganda — Куратор бережёт Пропаганду (остальным её изъятие только на руку).
function atRisk(state: GameState, p: PlayerState, value: (c: string) => number, keepPropaganda = false): string[] {
  const banned = p.warehouse
    .filter((s) => !s.memorized && isBanned(state, s.card) && (keepPropaganda || !isPropaganda(state, s.card)))
    .map((s) => s.card);
  const excess = banned.length - cacheLimit(state, p);
  if (excess <= 0) return [];
  return banned.sort((a, b) => value(a) - value(b)).slice(0, excess);
}

// Сила соперника на глаз: что видно на столе (для агрессивных ботов в полном режиме).
function strength(state: GameState, o: PlayerState, left: number): number {
  const connections = state.patrons.filter((x) => !x.removed && x.connections.includes(o.id)).length;
  return o.points + connections * 1.5 + (o.workers - o.held) * (left + 1) * BOT_BASE.action * 0.5 + o.warehouse.length * 0.8;
}

// Ресурсы, которые ценны при любой роли.
function resources(state: GameState, p: PlayerState, ctx: Ctx): number {
  const left = RULES.rounds - ctx.round;
  const w = ctx.w;
  let v = p.talons * ctx.talon * w.talons;
  const reserve = ctx.preset.character.reserve;
  if (p.talons < reserve) v -= (reserve - p.talons) * ctx.talon;
  v += (p.workers - p.held) * left * BOT_BASE.action * w.network;
  v += (p.available + p.bonusGroupTurns * 0.7) * BOT_BASE.action;
  v += (p.capacity * (BOT_BASE.capacity[ctx.round - 1] ?? 0) + p.cache * (BOT_BASE.cache[ctx.round - 1] ?? 0)) * w.storage;
  v += Math.max(0, freeSlots(p)) * BOT_BASE.freeSlot;
  return v;
}

// Куратор: Гласность не должна наступить. Тормозит отстающий Росток, копит Пропаганду, помогает Конторе.
function evaluateCurator(state: GameState, p: PlayerState, ctx: Ctx): number {
  if (state.result) return state.result.winners.includes(p.id) ? BOT_BASE.loss : -BOT_BASE.loss;
  let v = resources(state, p, ctx);
  const prog = state.sprouts.map((sp) => Math.min(sp.progress, RULES.glasnostStep));
  v -= BOT_BASE.curatorStep * prog.reduce((a, b) => a + b, 0) + BOT_BASE.curatorWeakest * Math.min(...prog);
  v += BOT_BASE.curatorPropaganda * p.warehouse.filter((s) => isPropaganda(state, s.card)).length;
  v += BOT_BASE.curatorHeld * state.players.filter((o) => o.id !== p.id).reduce((s, o) => s + o.held, 0);
  if (state.phase !== 'end' && state.phase !== 'passion') {
    const risky = atRisk(state, p, (c) => ownBookValue(state, p, c, ctx), true);
    v -= risky.reduce((s, c) => s + Math.max(0, ownBookValue(state, p, c, ctx)), 0) * ctx.preset.character.caution;
  }
  return v;
}

export function evaluate(state: GameState, me: string, ctx: Ctx): number {
  const p = player(state, me);
  if (ctx.curator) return evaluateCurator(state, p, ctx);
  // Контора удержала слишком многих — проиграли все (кроме Куратора).
  if (state.result && !state.result.scores.length) return -BOT_BASE.loss;
  const left = RULES.rounds - ctx.round; // Пятилеток после текущей
  const w = ctx.w;
  const cards = p.warehouse.map((s) => s.card);

  let v = p.points;
  // Финальный подсчёт.
  v += passionPoints(state, p) * w.passion;
  v += RULES.propagandaPoints * cards.filter((c) => isPropaganda(state, c)).length;
  v += RULES.evidencePoints * [...cards, ...p.tamizdat].filter((c) => isEvidence(state, c)).length;
  const connections = state.patrons.filter((x) => !x.removed && x.connections.includes(me)).length;
  v += connections * (BOT_BASE.connection + BOT_BASE.patronEffect * w.club * (left + 1));
  // Ресурсы.
  v += resources(state, p, ctx);
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
      // В полном режиме за изъятие Контора ещё и удерживает Единомышленника — до конца партии.
      const worker = ctx.full ? (left + 1) * BOT_BASE.action : 0;
      v -= (lost + worker) * ctx.preset.character.caution;
    }
  }
  if (ctx.full) {
    // «Громоотвод»: запасные ступени сверх 3-й на случай срезов Куратора.
    const spare = state.sprouts.reduce((s, sp) => s + Math.max(0, sp.progress - RULES.glasnostStep), 0);
    v += BOT_BASE.insurance * Math.min(spare, BOT_BASE.insuranceSteps) * w.sprouts;
    // Общая угроза: при 7 удержанных проигрывают все.
    const held = heldTotal(state);
    v -= BOT_BASE.heldDoom * held * held * (held >= KONTORA_LOSS - 1 ? 3 : 1);
    // Агрессивному боту на руку слабость соперников.
    if (ctx.aggression > 0) {
      const others = state.players.filter((o) => o.id !== me);
      v -= ctx.aggression * BOT_BASE.opponent * others.reduce((s, o) => s + strength(state, o, left), 0) / Math.max(1, others.length);
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
const FOLLOW_UP = new Set([
  'sproutBonus', 'posrednichestvoKeep', 'posrednichestvoGroup', 'baraholkaLook', 'naslednikiPick', 'extraGroup', 'discardExcess',
  'kontoraDecide', 'kontoraHandout', 'glavlitSwap', 'lieutenantPick', 'freeConnection',
]);

function tryApply(state: GameState, me: string, a: Action): GameState | null {
  try {
    return applyAction(state, me, a);
  } catch (e) {
    if (e instanceof RuleError) return null;
    throw e;
  }
}

function score(state: GameState, me: string, a: Action, ctx: Ctx, depth: number): number | null {
  let next = tryApply(state, me, a);
  if (!next) return null;
  // Поход в Контору: при примерке считаем, что соперники перепрячут всё, что поместится (самое значкастое — первым).
  while (next && next.pending[0]?.kind === 'kontoraWarning' && next.pending[0].player !== me) {
    const o = player(next, next.pending[0].player);
    const limit = cacheLimit(next, o);
    const hidden = o.warehouse.filter((x) => !x.memorized && isBanned(next!, x.card)).map((x) => x.card)
      .sort((x, y) => iconsOf(next!, y).length - iconsOf(next!, x).length).slice(0, limit);
    next = tryApply(next, o.id, { type: 'kontoraHide', hidden });
  }
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
  let cands = candidates(state, me, ctx);
  if (!cands.length) return [];
  // Роль Куратора бот берёт с вероятностью «агрессивность × 2»: по оценке её с другими Пристрастиями не сравнить.
  if (state.phase === 'passion' && player(state, me).passionOptions.includes('curator')) {
    const curator = rand() < preset.character.aggression * 2;
    cands = cands.filter((a) => a.type === 'choosePassion' && (a.passion === 'curator') === curator);
    if (curator) return [{ a: cands[0], v: 0 }];
  }
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
    // Завсегдатай берёт книгу своего жанра или Альбом.
    for (const s of p.warehouse) {
      const icons = iconsOf(state, s.card);
      if (icons.includes(pt.genre) || icons.includes('album')) out.push({ patron: pt.id, card: s.card });
    }
  }
  return out;
}

// Связи в Клубе за одно действие: по одной и жадно все сразу (самые скромные книги — первыми).
function clubCandidates(state: GameState, me: string, keep: Map<string, number>): Action[] {
  const gifts = clubGifts(state, me);
  const out: Action[] = [];
  const cheapest = new Map<PatronId, ClubGift>();
  for (const g of gifts) {
    const cur = cheapest.get(g.patron);
    if (!cur || (keep.get(g.card) ?? 0) < (keep.get(cur.card) ?? 0)) cheapest.set(g.patron, g);
  }
  for (const g of cheapest.values()) out.push({ type: 'place', place: { address: 'club', gifts: [g] } });
  const used = new Set<string>();
  const all: ClubGift[] = [];
  for (const g of [...gifts].sort((a, b) => (keep.get(a.card) ?? 0) - (keep.get(b.card) ?? 0))) {
    if (used.has(g.card) || all.some((x) => x.patron === g.patron)) continue;
    used.add(g.card);
    all.push(g);
  }
  if (all.length > 1) out.push({ type: 'place', place: { address: 'club', gifts: all } });
  return out;
}

// Варианты решений в Конторе: что выбрать и чью открытую опальную книгу отдать в Спецхран.
function kontoraChoices(state: GameState, me: string, ctx: Ctx, keep: Map<string, number>): KontoraChoice[] {
  const p = player(state, me);
  const left = RULES.rounds - ctx.round;
  const targets = kontoraTargets(state);
  const seizes: { player: string; card: string }[] = [];
  // У каждого соперника — самую «значкастую» книгу; у себя — самую ненужную.
  for (const o of state.players) {
    const mine = targets.filter((t) => t.player === o.id);
    if (!mine.length) continue;
    const pick = o.id === me
      ? [...mine].sort((a, b) => (keep.get(a.card) ?? 0) - (keep.get(b.card) ?? 0))[0]
      : [...mine].sort((a, b) => iconsOf(state, b.card).length - iconsOf(state, a.card).length)[0];
    seizes.push(pick);
  }
  const items: KontoraChoice[] = [];
  const held = state.players.filter((o) => o.held > 0).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  if (held.length) items.push({ petition: held.slice(0, 2).map((o) => o.id) });
  if (state.spetskhran.length && freeSlots(p) > 0) items.push({ handout: true });
  if (ctx.aggression > 0 || ctx.curator) {
    const rivals = state.players.filter((o) => o.id !== me && o.held < o.workers);
    const leader = rivals.sort((a, b) => strength(state, b, left) - strength(state, a, left))[0];
    if (leader) items.push({ signal: leader.id });
    // Профилактика: Завсегдатай, с которым связаны соперники, а бот — нет.
    const patrons = state.patrons.filter((x) => !x.removed && !x.connections.includes(me) && x.connections.length > 0)
      .sort((a, b) => b.connections.length - a.connections.length);
    if (patrons[0]) items.push({ prophylaxis: patrons[0].id });
  }
  const out: KontoraChoice[] = [];
  for (const set of subsets(items, items.length)) {
    const choice = Object.assign({}, ...set) as KontoraChoice;
    for (const seize of seizes) out.push({ ...choice, seize });
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

// Что спрятать в Тайник: самое ценное из опального, сколько поместится. Куратор прячет и Пропаганду.
function hideList(state: GameState, me: string, ctx: Ctx, keep: Map<string, number>, opts: { exclude?: string; extraLoad?: number } = {}): string[] {
  const p = player(state, me);
  const loads = p.warehouse.filter((s) => isLoad(state, s.card)).length + (opts.extraLoad ?? 0);
  const limit = p.cache + Math.floor(loads / 2);
  const banned = p.warehouse.filter((s) => s.card !== opts.exclude && !s.memorized && isBanned(state, s.card)
    && (ctx.curator || !isPropaganda(state, s.card))).map((s) => s.card);
  return byValue(keep, banned).reverse().slice(0, limit);
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
      case 'kontoraWarning':
        // Соперник идёт в Контору: перепрятать самое ценное из опального.
        return [{ type: 'kontoraHide', hidden: hideList(state, me, ctx, keepMap()) }];
      case 'kontoraDecide':
        return [...kontoraChoices(state, me, ctx, keepMap()).map((choice) => ({ type: 'kontoraDecide' as const, go: true, choice })), { type: 'kontoraDecide', go: false }];
      case 'kontoraHandout': return pend.cards.map((card) => ({ type: 'kontoraHandout', card }));
      case 'lieutenantPick':
        return [...pend.cards.filter((c) => state.discard.includes(c)).map((card) => ({ type: 'lieutenantPick' as const, card })), { type: 'lieutenantPick', card: null }];
      case 'glavlitSwap': {
        const out: Action[] = [];
        for (const from of state.banned) for (const to of GENRES) if (!state.banned.includes(to)) out.push({ type: 'glavlitSwap', from, to });
        return out;
      }
      case 'freeConnection': return [...clubGifts(state, me).map((gift) => ({ type: 'clubGift' as const, gift })), { type: 'pass' }];
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
      const keep = keepMap();
      const out: Action[] = [{ type: 'hiding', hidden: hideList(state, me, ctx, keep) }];
      if (ctx.full) {
        // «Заучить» сборник поэзии: он лежит сверх склада и облава его не трогает.
        const poetry = byValue(keep, books.filter((b) => iconsOf(state, b).includes('poetry') && isBanned(state, b))).reverse().slice(0, 2);
        for (const m of poetry) out.push({ type: 'hiding', hidden: hideList(state, me, ctx, keep, { exclude: m }), memorize: m });
        // Парторг: заполнить пустые места Нагрузкой — она прикрывает Тайник.
        if (hasPatron(state, me, 'partorg') && freeSlots(p) > 0) out.push({ type: 'hiding', hidden: hideList(state, me, ctx, keep, { extraLoad: freeSlots(p) }), fillLoad: true });
      }
      return out;
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
          case 'club': out.push(...clubCandidates(state, me, keepMap())); break;
          case 'kontora': {
            // Только что передумал идти (соперники перепрятали книги) — второй раз за ход не объявляет.
            const mine = state.log.filter((l) => l.text.startsWith(p.name + ' ')).pop();
            const changedMind = mine?.text === `${p.name} передумывает идти в Контору.`;
            if (!changedMind && kontoraTargets(state).length) out.push({ type: 'place', place: { address: 'kontora' } });
            break;
          }
          // Квартирник (нужно угадать ответ соседа) пока не используется.
        }
      }
      return out;
    }
  }
  return [];
}

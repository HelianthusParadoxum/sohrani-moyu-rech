// «Думающий» бот: примеряет допустимые ходы на копии партии и выбирает тот, после которого
// оценка положения выше. Оценку задаёт пресет (см. bot-presets.ts).
//
// Честность: бот не подглядывает в закрытые карты. Перед примеркой он перемешивает свою копию
// стопок и Барахолки, поэтому вытянутая при примерке книга — догадка, а не знание.
import { applyAction, mustVisitRedCorner } from './engine';
import { BOT_BASE, CURATOR_STYLES, PATRON_POWER, curatorStyle, type BotGoal, type BotPreset, type CuratorStyle } from './bot-presets';
import { PERMANENT_ADDRESSES, addressInGame, PASSIONS, RULES, SPROUTS, STEP_REWARDS, FIRST_FEED_POINTS, ADDRESSES, KONTORA_LOSS, limitFor } from './content';
import { heldTotal, kontoraTargets } from './full';
import { passionPoints } from './scoring';
import type { Action, ClubGift, CopyTextAddress, GameState, Genre, GroupAction, KontoraChoice, PatronId, PlayerState } from './types';
import { GENRES } from './types';
import {
  cacheLimit, cloneJson, coversStep, freeSlots, hasPatron, iconsOf, isBanned, isEvidence, isExposed, isGenreBook, isLoad, isPropaganda, player, RuleError,
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
  suspect: Record<string, number>; // насколько каждый соперник похож на Куратора, 0..1 (только по открытой информации)
  style?: CuratorStyle; // характер Куратора-бота
  coop: number; // 0..1: насколько партия стала «все против Куратора» — тогда бот не вредит остальным и тянет Гласность
}

const SAMPLES = 2; // сколько раз перемешивать закрытые карты при примерке

// Маскировка до первого явного зла: Куратор, открыто взявший Пропаганду со стола (все это видели), дальше играет
// «открытым забралом», какой бы стратегии ни держался. Удав сбрасывает маску и когда его и так раскусили.
export function effectiveCuratorStyle(state: GameState, me: string) {
  const style = curatorStyle(state, me);
  if (style === 'open') return style;
  if ((player(state, me).propagandaTaken ?? 0) > 0) return 'open';
  if (CURATOR_STYLES[style].untilRevealed) {
    const exposed = Math.max(0, ...state.players.filter((o) => o.id !== me).map((o) => curatorSuspicion(state, o.id)[me] ?? 0));
    if (exposed >= BOT_BASE.suspectAct) return 'open';
  }
  return style;
}

function makeCtx(state: GameState, me: string, preset: BotPreset, honest = false): Ctx {
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
  const curator = !honest && player(state, me).passion === 'curator';
  const suspect = curator ? {} : curatorSuspicion(state, me);
  // Кооперация: подозрение на Куратора или просто видно, что Гласность под угрозой (не хватает ступеней на оставшиеся ходы).
  const risk = r >= 3 ? Math.min(1, Math.max(0, (urgency - BOT_BASE.coopRiskFrom) / BOT_BASE.coopRiskSpan)) : 0;
  const coop = curator ? 0 : Math.max(risk, ...Object.values(suspect));
  const style = curator ? effectiveCuratorStyle(state, me) : undefined;
  if (style) w.talons *= CURATOR_STYLES[style].talons[r - 1];
  return {
    me, preset, round: r, w, talon: BOT_BASE.talon[r - 1] ?? 0.5, style,
    // Против общего врага Гласность важнее: без неё проигрывают все Единомышленники.
    glasnost: BOT_BASE.glasnostStep * urgency * (1 + BOT_BASE.coopGlasnost * coop),
    full: state.mode === 'full', curator, aggression: (preset.character.aggression ?? 0) * (1 - coop),
    suspect, coop,
  };
}

// На упреждение: занять последнее место на адресе, где Куратор вслепую добывает книги (и Пропаганду для срезов).
function blockBonus(state: GameState, a: Action, ctx: Ctx): number {
  if (a.type !== 'place' || !BLOCK_ADDRESSES.includes(a.place.address)) return 0;
  const enemy = Object.entries(ctx.suspect).sort((x, y) => y[1] - x[1])[0];
  if (!enemy || enemy[1] < BOT_BASE.suspectAct || player(state, enemy[0]).available === 0) return 0;
  const here = state.occupancy[a.place.address]?.length ?? 0;
  if (here + 1 < limitFor(a.place.address, state.players.length)) return 0;
  return BOT_BASE.blockCurator * enemy[1];
}
const BLOCK_ADDRESSES: string[] = ['baraholka', 'spisanie', 'nasledniki', 'posrednichestvo', 'raspredelitel'];

// Сколько пользы Завсегдатай даёт остальным: его сила × число связанных с ним игроков (кроме me).
function patronWorthToOthers(pt: GameState['patrons'][number], me: string): number {
  return (PATRON_POWER[pt.id] ?? 0.3) * pt.connections.filter((id) => id !== me).length;
}

// Согласится ли сосед на обмен на Квартирнике — догадка по открытому: получит не меньше значков, чем отдаст.
function kvartirnikLikely(state: GameState, give: string, want: string): boolean {
  return iconsOf(state, give).length >= iconsOf(state, want).length;
}

// Книга годится честным для ближайшей ступени какого-нибудь Ростка до порога Гласности (основной жанр или поддержка).
function feedUseful(state: GameState, card: string): boolean {
  const icons = iconsOf(state, card);
  if (!icons.length) return false;
  return state.sprouts.some((sp) => {
    if (sp.progress >= RULES.glasnostStep) return false;
    const info = SPROUTS.find((s) => s.id === sp.id)!;
    const step = info.steps[sp.progress];
    return icons.includes(info.main) || (!!step?.support && icons.includes(step.support));
  });
}

// Открытые книги на столе, годные для ближайшей ступени какого-нибудь Ростка до порога Гласности (основной жанр).
function feedBooksOnTable(state: GameState): number {
  const need = new Set<Genre>();
  for (const sp of state.sprouts) {
    if (sp.progress >= RULES.glasnostStep) continue;
    need.add(SPROUTS.find((s) => s.id === sp.id)!.main);
  }
  return [...state.tolkuchka, ...state.razval, ...state.raspredelitel, ...state.knigoobmen]
    .filter((c): c is string => !!c && iconsOf(state, c).some((g) => need.has(g))).length;
}

// Сколько Пропаганды может достаться Куратору: открыто на столе и (пока партия не кончилась и есть Наследники) в сбросе.
function reachablePropaganda(state: GameState, left: number): number {
  const open = [...state.tolkuchka, ...state.razval, ...state.raspredelitel, ...state.knigoobmen]
    .filter((c): c is string => !!c && isPropaganda(state, c)).length;
  const discard = left > 0 && state.safehouses.includes('nasledniki') ? state.discard.filter((c) => isPropaganda(state, c)).length : 0;
  return open + 0.5 * discard;
}

// Подозрение, что соперник — Куратор. Только то, что видели все: Пропаганда, открыто взятая со стола или лежащая
// у него на виду (обычному игроку она стоит −5 очков), сданная в Красный уголок Пропаганда (Куратор её бережёт),
// и Ростки, которые он так и не кормит.
export function curatorSuspicion(state: GameState, me: string): Record<string, number> {
  const out: Record<string, number> = {};
  if (state.mode !== 'full' || !state.curatorPossible) return out;
  for (const o of state.players) {
    if (o.id === me) continue;
    const open = o.warehouse.filter((s) => !s.hidden && isPropaganda(state, s.card)).length;
    // Кто кормит Ростки, тот, скорее всего, забирает Пропаганду, чтобы она не досталась Куратору.
    const trust = o.sproutsFed.length ? BOT_BASE.suspectFedDiscount : 1;
    let v = trust * (BOT_BASE.suspectTaken * (o.propagandaTaken ?? 0) + BOT_BASE.suspectHolds * open
      + BOT_BASE.suspectCacheUnshown * (o.cacheUnshown ?? 0))
      - BOT_BASE.suspectDumped * (o.propagandaDumped ?? 0);
    if (!o.sproutsFed.length) {
      v += BOT_BASE.suspectNoFeed[Math.min(state.round, 5)] ?? 0;
      // Единственный, кто так и не кормил Ростки, — особенно подозрителен.
      if (state.round >= 3 && state.players.filter((x) => x.id !== o.id && !x.sproutsFed.length).length === 0) v += BOT_BASE.suspectOnlyNoFeed;
    } else v -= BOT_BASE.suspectFeeds * o.sproutsFed.length;
    out[o.id] = Math.min(1, Math.max(0, v));
  }
  return out;
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

// Одиночная игра: самый развитый Росток не ниже IV, остальные не ниже III.
function soloTargetMet(state: GameState): boolean {
  const prog = state.sprouts.map((sp) => sp.progress).sort((a, b) => b - a);
  return prog[0] >= 4 && prog.every((x) => x >= RULES.glasnostStep);
}

// Что ещё можно купить на открытых адресах в эту Пятилетку. Ценится, только пока у бота остались свободные поручения
// (обязательный Красный уголок не в счёт): Завоз последним действием уже ничего не даёт, кроме Талонов, —
// к следующей Пятилетке Развал всё равно обновится.
function shopValue(state: GameState, p: PlayerState, ctx: Ctx): number {
  if (state.phase !== 'orders') return 0;
  const free = p.available + p.bonusGroupTurns - (p.visitedRedCorner || hasPatron(state, p.id, 'doctor') ? 0 : 1);
  if (free <= 0 || freeSlots(p) <= 0) return 0;
  const offers: { card: string; price: number }[] = [
    ...state.razval.flatMap((c, i) => (c ? [{ card: c, price: RULES.razvalPrices[i] }] : [])),
    ...state.tolkuchka.map((c) => ({ card: c, price: RULES.tolkuchkaBuy })),
    ...(state.safehouses.includes('raspredelitel') ? state.raspredelitel.map((c) => ({ card: c, price: RULES.raspredelitelPrice })) : []),
  ].filter((o) => o.price <= p.talons && isGenreBook(state, o.card));
  if (!offers.length) return 0;
  const base = feedPotential(state, p, ctx);
  let best = 0;
  for (const o of offers) {
    const q = { ...p, warehouse: [...p.warehouse, { card: o.card, hidden: false }] };
    const gain = (feedPotential(state, q, ctx) - base) * ctx.w.sproutBooks + iconsOf(state, o.card).length * BOT_BASE.bookLatent * ctx.w.publish;
    best = Math.max(best, gain - o.price * ctx.talon * ctx.w.talons);
  }
  return best * BOT_BASE.shopReach;
}

// Чем ценна для бота книга одного жанра (для Подписки). forSprouts = false — книга придёт, когда кормить Ростки
// уже поздно (в конце последней Пятилетки): ценна только для Пристрастия.
function genreValue(state: GameState, p: PlayerState, g: Genre, ctx: Ctx, forSprouts = true): number {
  const info = p.passion ? PASSIONS[p.passion] : null;
  let passion = 0;
  if (info?.genres) passion = info.genres.includes(g) ? RULES.passionKeeper : 0;
  else if (p.passion === 'erudite') passion = (RULES.passionErudite + RULES.eruditePerGenre) * 0.75; // засчитается, только если жанра ещё нет
  else if (p.passion === 'monogamist') passion = RULES.passionMonogamist * 0.5 + RULES.monogamistSecond * 0.3; // если жанр станет лучшим или вторым
  let v = passion * ctx.w.passion;
  if (!forSprouts) return v;
  v += BOT_BASE.bookLatent * ctx.w.publish;
  // Сколько значков этого жанра ещё нужно Росткам на оставшихся ступенях: основной жанр Ростка нужен на каждой ступени.
  let demand = 0;
  for (const sp of state.sprouts) {
    const s = SPROUTS.find((x) => x.id === sp.id)!;
    for (let k = sp.progress; k < s.steps.length; k++) {
      if (s.main === g) demand += s.steps[k].main;
      if (s.steps[k].support === g) demand += 1;
    }
  }
  v += Math.min(demand, BOT_BASE.subscriptionDemandCap) * 1.5 * ctx.w.sproutBooks;
  return v;
}

// Подписка: книги приходят в конце каждой фазы поручений; пришедшая в конце последней Пятилетки в Росток уже не пойдёт.
function subscriptionValue(state: GameState, p: PlayerState, sub: { genre: Genre; rounds: number }, ctx: Ctx): number {
  const first = state.phase === 'orders' || state.phase === 'passion' || state.phase === 'setupCache' ? state.round : state.round + 1;
  let v = 0;
  for (let k = 0; k < sub.rounds; k++) v += genreValue(state, p, sub.genre, ctx, first + k < RULES.rounds);
  return v * 0.8;
}

// Пропаганда на руках у честного: −5 в конце. Если он ещё успеет вернуть ей смыслы, она нейтральна: специально за ней
// не гоняются, но и не сбрасывают — разоблачат (само Разоблачение стоит +5).
function canExposeLater(state: GameState, p: PlayerState, ctx: Ctx): boolean {
  return RULES.exposePropaganda && (ctx.round < RULES.rounds || (!p.groupUsed.includes('restore') && p.available > 0));
}

function heldPropagandaValue(state: GameState, p: PlayerState, ctx: Ctx): number {
  return canExposeLater(state, p, ctx) ? 0 : RULES.propagandaPoints;
}

function ownBookValue(state: GameState, p: PlayerState, card: string, ctx: Ctx): number {
  if (isPropaganda(state, card)) return ctx.curator ? BOT_BASE.curatorPropaganda : heldPropagandaValue(state, p, ctx);
  if (isExposed(state, card)) return RULES.exposePoints;
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
function resources(state: GameState, p: PlayerState, ctx: Ctx, talonShare = 1): number {
  const left = RULES.rounds - ctx.round;
  const w = ctx.w;
  let v = p.talons * ctx.talon * w.talons * talonShare;
  const reserve = ctx.preset.character.reserve;
  if (p.talons < reserve) v -= (reserve - p.talons) * ctx.talon * talonShare;
  v += (p.workers - p.held) * left * BOT_BASE.action * w.network;
  // Поздний найм: лишнее действие ещё в этой Пятилетке и темп в последней (ответить на финальные ходы Куратора).
  v += p.workers * (BOT_BASE.lateHire[ctx.round - 1] ?? 0);
  v += (p.available + p.bonusGroupTurns * 0.7) * BOT_BASE.action;
  v += (p.capacity * (BOT_BASE.capacity[ctx.round - 1] ?? 0) + p.cache * (BOT_BASE.cache[ctx.round - 1] ?? 0)) * w.storage;
  v += Math.max(0, freeSlots(p)) * BOT_BASE.freeSlot;
  return v;
}

// Куратор: Гласность не должна наступить. Тормозит отстающий Росток, копит Пропаганду, помогает Конторе.
function evaluateCurator(state: GameState, p: PlayerState, ctx: Ctx): number {
  if (state.result) return state.result.winners.includes(p.id) ? BOT_BASE.loss : -BOT_BASE.loss;
  const style = CURATOR_STYLES[ctx.style ?? 'open'];
  const r = ctx.round - 1;
  // Насколько он уже на подозрении у честных (смотрит на себя их глазами).
  const exposed = Math.max(0, ...state.players.filter((o) => o.id !== p.id).map((o) => curatorSuspicion(state, o.id)[p.id] ?? 0));
  const attack = style.attack[r];
  const conceal = style.conceal[r];
  const others = state.players.filter((o) => o.id !== p.id);
  // Очки Куратору не нужны: Талоны — лишь средство добыть Пропаганду. В последней Пятилетке они дешевеют,
  // а когда ходить больше нечем — не стоят ничего.
  const last = ctx.round >= RULES.rounds;
  const talonShare = last && p.available + p.bonusGroupTurns <= 0 ? 0 : BOT_BASE.curatorTalonByRound[r] ?? 1;
  let v = resources(state, p, ctx, talonShare);
  const prog = state.sprouts.map((sp) => Math.min(sp.progress, RULES.glasnostStep));
  v -= BOT_BASE.curatorStep * prog.reduce((a, b) => a + b, 0) + BOT_BASE.curatorWeakest * Math.min(...prog);
  v += BOT_BASE.curatorPropaganda * p.warehouse.filter((s) => isPropaganda(state, s.card)).length;
  v += attack * BOT_BASE.curatorHeld * state.players.filter((o) => o.id !== p.id).reduce((s, o) => s + o.held, 0);
  // Жанровые книги — разменная монета: Книгообмен на Пропаганду, Главлит «прокруткой», оплата Конторы своей книгой.
  for (const s of p.warehouse) {
    if (!isGenreBook(state, s.card)) continue;
    // К концу партии книги как «разменная монета» обесцениваются: в последнем действии важна только Пропаганда.
    v += (BOT_BASE.curatorBook + (isBanned(state, s.card) ? BOT_BASE.curatorBannedBook : 0)) * (BOT_BASE.curatorBookByRound[ctx.round - 1] ?? 1);
  }
  // Книги на столе, которыми честные закроют ближайшие ступени, — лучше забрать себе.
  v -= BOT_BASE.curatorDenyFeed * feedBooksOnTable(state);
  // ...и такие же книги, открыто лежащие у честных: им нельзя их дарить (Квартирник), а отнять — хорошо.
  v -= BOT_BASE.curatorDenyHands * others.reduce((s, o) => s + o.warehouse.filter((w) => !w.hidden && feedUseful(state, w.card)).length, 0);
  // Связи честных с Завсегдатаями — их сила; Профилактика её отнимает.
  v -= BOT_BASE.curatorPatronDeny * state.patrons.filter((pt) => !pt.removed).reduce((s, pt) => s + patronWorthToOthers(pt, p.id), 0);
  // Связь с сильным Завсегдатаем в эту Пятилетку закрывает его для остальных до следующей.
  for (const pt of state.patrons) {
    if (pt.removed || !pt.connections.includes(p.id) || pt.since?.[p.id] !== state.round) continue;
    const blocked = others.filter((o) => !pt.connections.includes(o.id)).length / Math.max(1, others.length);
    v += BOT_BASE.curatorPatronBlock * (PATRON_POWER[pt.id] ?? 0.3) * blocked;
  }
  // Ранний Красный уголок: первым ходить в новой Пятилетке, когда цензура только сменилась, — сразу ударить.
  const pos = state.nextOrder.indexOf(p.id);
  if (pos >= 0 && ctx.round < RULES.rounds) v += BOT_BASE.curatorTurnOrder * attack * (state.players.length - pos) / state.players.length;
  // Маскировка и «отжим» Талонов.
  v -= conceal * BOT_BASE.curatorConceal * exposed;
  v -= style.squeeze[r] * ctx.talon * others.reduce((s, o) => s + o.talons, 0) / Math.max(1, others.length);
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
  // Гласность — всё или ничего: не наступила (или её срезал Куратор) — честные проиграли, очки не важны.
  if (state.result && !state.result.glasnost && !state.solo) return -BOT_BASE.loss;
  const left = RULES.rounds - ctx.round; // Пятилеток после текущей
  const w = ctx.w;
  const cards = p.warehouse.map((s) => s.card);

  let v = p.points;
  // Финальный подсчёт.
  v += passionPoints(state, p) * w.passion;
  v += cards.filter((c) => isPropaganda(state, c)).length * heldPropagandaValue(state, p, ctx);
  v += RULES.exposePoints * [...cards, ...p.published].filter((c) => isExposed(state, c)).length;
  // В одиночной игре, пока цель «один Росток до IV, остальные до III» не выполнена, Улики почти не нужны:
  // их трудно хранить (опальные), а Гласности они не помогают.
  const evidenceWeight = state.solo && !soloTargetMet(state) ? BOT_BASE.soloEvidenceEarly : 1;
  v += RULES.evidencePoints * evidenceWeight * [...cards, ...p.tamizdat].filter((c) => isEvidence(state, c)).length;
  const connections = state.patrons.filter((x) => !x.removed && x.connections.includes(me)).length;
  v += connections * (BOT_BASE.connection + BOT_BASE.patronEffect * w.club * (left + 1));
  // Ресурсы.
  v += resources(state, p, ctx);
  for (const sub of p.subscriptions) v += subscriptionValue(state, p, sub, ctx);
  // Книги.
  for (const c of cards) v += iconsOf(state, c).length * BOT_BASE.bookLatent * w.publish;
  v += p.published.reduce((s, c) => s + iconsOf(state, c).length, 0) * BOT_BASE.published * w.publish;
  v += feedPotential(state, p, ctx) * w.sproutBooks;
  v += shopValue(state, p, ctx);
  // Ростки — общее дело: без Гласности проигрывают все.
  const missing = state.sprouts.reduce((s, sp) => s + Math.max(0, RULES.glasnostStep - sp.progress), 0);
  // Запас (ступени сверх III) ценен, когда Гласность набрана; при подозрении на Куратора — уже раньше
  // (срезы бьют по самым развитым Росткам), тем сильнее, чем крепче подозрение.
  const suspicion = Math.max(0, ...Object.values(ctx.suspect));
  const spareWeight = missing === 0 || state.solo ? 1 : suspicion >= BOT_BASE.suspectSpareFrom ? suspicion : 0;
  for (const sp of state.sprouts) {
    for (let k = 0; k < Math.min(sp.progress, RULES.glasnostStep); k++) v += ctx.glasnost * w.sprouts * (BOT_BASE.glasnostLag[k] ?? 1);
    // Ступени сверх III — запас, но только когда Гласность уже набрана (иначе эта ступень нужнее отстающему Ростку).
    v += spareWeight * Math.max(0, sp.progress - RULES.glasnostStep) * BOT_BASE.lateStep;
  }
  if (!state.solo) {
    // Отстающий Росток важнее всех: Гласность наступает, только когда до III дорастут все.
    const weakest = Math.min(...state.sprouts.map((sp) => Math.min(sp.progress, RULES.glasnostStep)));
    v += (BOT_BASE.glasnostWeakest[ctx.round - 1] ?? 0) * weakest * w.sprouts;
    // Гласность набрана — это почти победа (ближе к концу — тем ценнее).
    if (missing === 0) v += BOT_BASE.glasnostDone[ctx.round - 1] ?? 0;
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
  if (state.solo) {
    // Одиночная игра: прямая цель — все Ростки до III ступени, а самый развитый — до IV (запас против Пропаганды при вскрытии).
    const prog = state.sprouts.map((sp) => sp.progress).sort((a, b) => b - a);
    v += BOT_BASE.soloGoal * (ctx.preset.soloGoal ?? 1) * prog.reduce((s, x, i) => s + Math.min(x, i === 0 ? 4 : RULES.glasnostStep), 0);
  }
  if (ctx.full || state.solo) {
    // «Громоотвод»: запасные ступени сверх 3-й на случай срезов Куратора (в одиночной игре — Пропаганды из 30 вскрытых карт).
    const spare = spareWeight * state.sprouts.reduce((s, sp) => s + Math.max(0, sp.progress - RULES.glasnostStep), 0);
    // Подозревая Куратора (или видя угрозу Гласности), бот страхуется сильнее: срезы бьют по самым развитым Росткам.
    const cap = BOT_BASE.insuranceSteps + Math.round(BOT_BASE.coopInsuranceSteps * ctx.coop);
    v += BOT_BASE.insurance * (1 + BOT_BASE.coopInsurance * ctx.coop) * Math.min(spare, cap) * w.sprouts;
  }
  if (ctx.full && !state.reserve) {
    // Запас Тайника на стык Пятилеток: место сверх опальных книг — чтобы спрятать впрок то, что может попасть в опалу.
    const bannedHere = p.warehouse.filter((s) => !s.memorized && isBanned(state, s.card)).length;
    if (cacheLimit(state, p) > bannedHere) v += BOT_BASE.cacheSpare[ctx.round - 1] ?? 0;
  }
  if (ctx.full) {
    // Общая угроза: при 7 удержанных проигрывают все.
    const held = heldTotal(state);
    v -= BOT_BASE.heldDoom * held * held * (held >= KONTORA_LOSS - 1 ? 3 : 1);
    // Пропаганда, до которой может дотянуться Куратор (на столе, а пока есть Наследники — и в сбросе), — это будущие срезы.
    // Подозревая Куратора, бот забирает её себе и сдаёт, когда Куратор уже не доберётся.
    const sus = Math.max(0, ...Object.values(ctx.suspect));
    if (sus > 0) v -= BOT_BASE.denyPropaganda * sus * reachablePropaganda(state, left);
    // Агрессивному боту на руку слабость соперников; против подозреваемого Куратора — всем на руку.
    const others = state.players.filter((o) => o.id !== me);
    const foe = (o: PlayerState) => ctx.aggression * (1 - (ctx.suspect[o.id] ?? 0)) + BOT_BASE.curatorFoe * (ctx.suspect[o.id] ?? 0);
    if (others.some((o) => foe(o) > 0)) {
      v -= BOT_BASE.opponent * others.reduce((s, o) => s + foe(o) * strength(state, o, left), 0) / Math.max(1, others.length);
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
// Книги Барахолки, которые бот уже посмотрел, он помнит — они остаются на местах. Так же и Спецхран:
// известны книги, изъятые при всех, и виденные при Выдаче на руки; остальные там — любые из закрытых.
function determinize(state: GameState, rand: Rand, me: string): GameState {
  const s = cloneLight(state);
  const looking = s.pending.some((x) => x.kind === 'baraholkaLook');
  const known = new Set(s.baraholkaSeen?.[me] ?? []);
  const hidden = (c: string | null, i: number) => !!c && !looking && !known.has(i);
  const seenSpets = new Set(s.spetskhranSeen?.[me] ?? []);
  const unknownSpets = s.spetskhran.filter((c) => !seenSpets.has(c));
  // Сортируем перед перемешиванием, чтобы настоящий порядок карт никак не влиял на решение.
  const pool = [...s.deck, ...s.baraholka.filter((c, i): c is string => hidden(c, i)), ...unknownSpets].sort();
  shuffleWith(pool, rand);
  s.baraholka = s.baraholka.map((c, i) => (hidden(c, i) ? pool.pop()! : c));
  s.spetskhran = [...s.spetskhran.filter((c) => seenSpets.has(c)), ...unknownSpets.map(() => pool.pop()!)];
  s.deck = pool;
  s.loadDeck = shuffleWith([...s.loadDeck].sort(), rand);
  s.rng = Math.floor(rand() * 2 ** 31);
  return s;
}

// Отложенные решения, которые бот при примерке додумывает сам (они следуют сразу за ходом).
const FOLLOW_UP = new Set([
  'sproutBonus', 'posrednichestvoKeep', 'spisanieKeep', 'posrednichestvoGroup', 'baraholkaLook', 'naslednikiPick', 'extraGroup', 'discardExcess',
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
  // Квартирник: ответ соседа угадываем по открытому — согласится, если получит не меньше значков, чем отдаст.
  while (next && next.pending[0]?.kind === 'kvartirnikReply' && next.pending[0].player !== me) {
    const pr = next.pending[0];
    next = tryApply(next, pr.player, { type: 'kvartirnikReply', accept: kvartirnikLikely(next, pr.give, pr.want) });
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
// honest — оценить ход так, будто бот честный книжник (Куратору — для маскировки).
export function rankActions(state: GameState, me: string, preset: BotPreset, rand: Rand, honest = false): { a: Action; v: number }[] {
  const ctx = makeCtx(state, me, preset, honest);
  let cands = candidates(state, me, ctx);
  if (!cands.length) return [];
  // Роль Куратора бот берёт с вероятностью «агрессивность × 2»: по оценке её с другими Пристрастиями не сравнить.
  if (state.phase === 'passion' && player(state, me).passionOptions.includes('curator')) {
    const curator = rand() < preset.character.aggression * 2;
    cands = cands.filter((a) => a.type === 'choosePassion' && (a.passion === 'curator') === curator);
    if (curator) return [{ a: cands[0], v: 0 }];
  }
  // Маскировка: первое кормление Куратор делает так же охотно, как честный книжник, — одну ступень за партию
  // (самую низкую из тех, что закрыл бы честный на его месте). Ранняя ступень Куратору почти ничего не стоит.
  if (ctx.curator && state.phase === 'orders' && !player(state, me).sproutsFed.length
    && cands.some((a) => a.type === 'place' && a.place.address === 'sprouts')) {
    // Путь Куратора к этому ходу уже не такой, как у честного (Пропаганда, Контора), поэтому честная оценка одна даёт
    // кормление реже, чем у честных книжников; добавка «просто покормить» выравнивает частоту (`curatorMimicFeed`).
    const mimic = rand() < BOT_BASE.curatorMimicFeed;
    const top = mimic
      ? cands.find((a) => a.type === 'place' && a.place.address === 'sprouts')
      : rankActions(state, me, preset, rand, true)[0]?.a;
    const feed = top?.type === 'place' && top.place.address === 'sprouts' ? lowestFeed(state, top.place.feeds) : null;
    if (feed) return [{ a: { type: 'place', place: { address: 'sprouts', feeds: [feed] } }, v: 0 }];
  }
  // Дальше Куратор почти никогда не кормит Ростки: это слишком дорого (но изредка — чтобы не читался железно).
  if (ctx.curator && rand() >= BOT_BASE.curatorFeedChance) {
    cands = cands.filter((a) => !(a.type === 'place' && a.place.address === 'sprouts'));
    if (!cands.length) return [];
  }
  const samples = Array.from({ length: SAMPLES }, () => determinize(state, rand, me));
  // В свой ход — сначала спрятать в Тайник самое ценное из опального: потом (Контора, облава) будет поздно.
  const rehide = rehideAction(state, me, ctx);
  if (rehide) return [{ a: rehide, v: 0 }];
  // Клуб как свободное действие: сначала решаем, стоит ли отдать книгу Завсегдатаю, — это не тратит ход.
  const gifts = freeGiftCandidates(state, me, ctx);
  if (gifts.length) {
    const base = samples.reduce((s, x) => s + evaluate(x, me, ctx), 0) / samples.length;
    let best: { a: Action; v: number } | null = null;
    for (const a of gifts) {
      const vs = samples.map((s) => score(s, me, a, ctx, 2));
      if (vs.some((v) => v === null)) continue;
      const v = (vs as number[]).reduce((s, x) => s + x, 0) / vs.length;
      if (!best || v > best.v) best = { a, v };
    }
    if (best && best.v > base + BOT_BASE.freeGiftMargin) return [best];
  }
  const rated: { a: Action; v: number }[] = [];
  for (const a of cands) {
    let sum = 0;
    let ok = true;
    for (const s of samples) {
      const v = score(s, me, a, ctx, 2);
      if (v === null) { ok = false; break; }
      sum += v;
    }
    if (ok) rated.push({ a, v: sum / samples.length + blockBonus(state, a, ctx) });
  }
  // Немного случайности: оценка ±randomness×2 очка.
  const noise = preset.character.randomness * 2;
  for (const r of rated) r.v += (rand() - 0.5) * 2 * noise;
  return rated.sort((x, y) => y.v - x.v);
}

// Ступень у самого слабого Ростка из списка (только первые ступени каждого Ростка — их можно закрыть по отдельности).
function lowestFeed(state: GameState, feeds: { sprout: string; books: string[] }[]) {
  const first = feeds.filter((f, i) => feeds.findIndex((g) => g.sprout === f.sprout) === i);
  const progress = (f: { sprout: string }) => state.sprouts.find((sp) => sp.id === f.sprout)?.progress ?? 9;
  return first.sort((a, b) => progress(a) - progress(b))[0] ?? null;
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
// discount = false — скидка Лаборанта в этом поручении уже потрачена.
function cheapestFeed(state: GameState, me: string, books: string[], sproutId: string, progress: number, keep: Map<string, number>, discount = true): string[] | null {
  const info = SPROUTS.find((s) => s.id === sproutId)!;
  const step = info.steps[progress];
  if (!step) return null;
  const opts = { ...stepOpts(state, me), ...(discount ? {} : { labtech: false }) };
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
    if ((state.sproutRound?.[sp.id]?.length ?? 0) >= RULES.sproutSlotsPerRound) continue; // места Ростка в эту Пятилетку заняты
    const feed = cheapestFeed(state, me, books, sp.id, sp.progress, keep);
    if (feed) out.push({ type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: feed }] } });
  }
  // Жадно: закрыть за одно действие всё, что получается.
  const progress = new Map(state.sprouts.map((s) => [s.id, s.progress]));
  let left = [...books];
  let discount = true;
  const feeds: { sprout: string; books: string[] }[] = [];
  for (let changed = true; changed;) {
    changed = false;
    const options = state.sprouts
      .map((sp) => ({ sp, feed: cheapestFeed(state, me, left, sp.id, progress.get(sp.id)!, keep, discount) }))
      .filter((x): x is { sp: typeof x.sp; feed: string[] } => !!x.feed)
      .sort((a, b) => progress.get(a.sp.id)! - progress.get(b.sp.id)!);
    const first = options[0];
    if (first) {
      feeds.push({ sprout: first.sp.id, books: first.feed });
      const info = SPROUTS.find((s) => s.id === first.sp.id)!;
      const step = info.steps[progress.get(first.sp.id)!];
      if (!coversStep(state, first.feed, info.main, step.main, step.support, { wildScifi: state.mode === 'full' })) discount = false;
      progress.set(first.sp.id, progress.get(first.sp.id)! + 1);
      left = left.filter((b) => !first.feed.includes(b));
      changed = true;
    }
  }
  if (feeds.length > 1 && feeds.length <= RULES.sproutFeedsPerAction) out.push({ type: 'place', place: { address: 'sprouts', feeds } });
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
    if (!state.restored[s.card] && ['genre', 'loadReturnable', 'loadEvidence', ...(RULES.exposePropaganda ? ['propaganda'] : [])].includes(state.cards[s.card].kind)) out.push({ action: 'restore', card: s.card });
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

// Клуб как свободное действие: по одному варианту на Завсегдатая — с самой скромной подходящей книгой.
function freeGiftCandidates(state: GameState, me: string, ctx: Ctx): Action[] {
  if (!RULES.clubFreeGift || state.mode !== 'full' || state.phase !== 'orders' || state.pending.length || state.clubGiftBy === me) return [];
  if (!clubGifts(state, me).length) return [];
  const keep = keepValues(state, me, ctx);
  return clubCandidates(state, me, keep).flatMap((a) =>
    a.type === 'place' && a.place.address === 'club' && a.place.gifts.length === 1 ? [{ type: 'clubGift' as const, gift: a.place.gifts[0] }] : []);
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
  // Все промежуточные наборы: 2, 3, … самых скромных подарков — чтобы не отдавать ценное ради лишней связи.
  for (let k = 2; k <= all.length; k++) out.push({ type: 'place', place: { address: 'club', gifts: all.slice(0, k) } });
  return out;
}

// Варианты решений в Конторе: что выбрать и чью открытую опальную книгу отдать в Спецхран.
function kontoraChoices(state: GameState, me: string, ctx: Ctx, keep: Map<string, number>): KontoraChoice[] {
  const p = player(state, me);
  const left = RULES.rounds - ctx.round;
  void keep;
  const targets = kontoraTargets(state, me);
  const seizes: { player: string; card: string }[] = [];
  // Донос — на самую «значкастую» книгу каждого соперника (на свою доносить нельзя).
  for (const o of state.players) {
    const mine = targets.filter((t) => t.player === o.id);
    if (!mine.length) continue;
    seizes.push([...mine].sort((a, b) => iconsOf(state, b.card).length - iconsOf(state, a.card).length)[0]);
  }
  // Против подозреваемого Куратора на своих не доносят.
  const enemy = Object.entries(ctx.suspect).sort((a, b) => b[1] - a[1])[0];
  const united = !!enemy && enemy[1] >= BOT_BASE.suspectAct;
  if (united) for (let i = seizes.length - 1; i >= 0; i--) if (seizes[i].player !== enemy[0]) seizes.splice(i, 1);
  // Профилактика возможна только Завсегдатаю, связанному с тем, на кого донос: кандидаты по убыванию желания.
  let patronRank: GameState['patrons'] = [];
  const items: KontoraChoice[] = [];
  const held = state.players.filter((o) => o.held > 0).sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
  const free = united ? held.filter((o) => o.id !== enemy[0]) : held; // Куратора из Конторы не вызволяют
  if (free.length) items.push({ petition: free.slice(0, RULES.petitionMax).map((o) => o.id) });
  if (state.spetskhran.length && freeSlots(p) > 0) items.push({ handout: true });
  // Подозреваемый Куратор: донос (а с ним Сигнал) — на него, Профилактика — только Завсегдатаю, с которым связан лишь он.
  if (united) {
    const o = player(state, enemy[0]);
    patronRank = state.patrons.filter((x) => !x.removed && x.connections.length > 0 && x.connections.every((id) => id === o.id));
    if (patronRank[0]) items.push({ prophylaxis: patronRank[0].id });
  } else if (ctx.aggression > 0 || ctx.curator) {
    // Профилактика: Завсегдатай, с которым связаны соперники, а бот — нет.
    // Куратор выбивает того, кто больше всех даёт честным: сила Завсегдатая × сколько честных с ним связаны.
    // Своей связью он тоже может пожертвовать, если честным этот Завсегдатай полезнее, чем ему.
    const net = (x: GameState['patrons'][number]) => patronWorthToOthers(x, me)
      - (x.connections.includes(me) ? BOT_BASE.curatorOwnPatron * (PATRON_POWER[x.id] ?? 0.3) : 0);
    const patrons = ctx.curator
      ? state.patrons.filter((x) => !x.removed && net(x) > 0).sort((a, b) => net(b) - net(a))
      : state.patrons.filter((x) => !x.removed && !x.connections.includes(me) && x.connections.length > 0)
        .sort((a, b) => b.connections.length - a.connections.length);
    patronRank = patrons;
    if (patrons[0]) items.push({ prophylaxis: patrons[0].id });
  }
  const out: KontoraChoice[] = [];
  for (const set of subsets(items, items.length)) {
    const choice = Object.assign({}, ...set) as KontoraChoice;
    // Куратор, раз уж пошёл в Контору, Профилактику проводит всегда.
    if (ctx.curator && items.some((x) => x.prophylaxis) && !choice.prophylaxis) continue;
    // Донос — цена; в конце похода на того, на кого донос, — Сигнал, а книгу из доноса изымают.
    for (const denounce of seizes) {
      let c = choice;
      if (c.prophylaxis) {
        const pt = patronRank.find((x) => x.connections.includes(denounce.player));
        const { prophylaxis: _, ...rest } = c;
        void _;
        c = pt ? { ...rest, prophylaxis: pt.id } : rest;
      }
      if (Object.keys(c).length) out.push({ ...c, denounce });
    }
  }
  return [...new Map(out.map((c) => [JSON.stringify(c), c])).values()];
}

function byValue(keep: Map<string, number>, cards: string[]): string[] {
  return [...cards].sort((a, b) => (keep.get(a) ?? 0) - (keep.get(b) ?? 0));
}

function redCornerCandidates(state: GameState, me: string, keep: Map<string, number>, ctx: Ctx): Action[] {
  const p = player(state, me);
  // Куратор Пропаганду не сдаёт: в конце она срезает Ростки. Честный не сдаёт её, пока успеет разоблачить.
  const cards = p.warehouse.map((s) => s.card)
    .filter((c) => !isPropaganda(state, c) || (p.passion !== 'curator' && !canExposeLater(state, p, ctx)));
  const prop = cards.find((c) => isPropaganda(state, c));
  const unprinted = byValue(keep, cards.filter((c) => !isLoad(state, c) && !isEvidence(state, c) && state.cards[c].kind !== 'loadEvidence' && state.cards[c].kind !== 'loadReturnable'));
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
  const list = byValue(keep, banned).reverse().slice(0, limit);
  // Свободные места Тайника — впрок: в новой Пятилетке опала сменится, и открытая жанровая книга может стать доносом
  // в Контору раньше, чем дойдёт ход её перепрятать. Прячем самые ценные из них.
  if (list.length < limit && state.mode === 'full' && !state.reserve) {
    const spare = p.warehouse.filter((s) => s.card !== opts.exclude && !s.memorized && !list.includes(s.card) && isGenreBook(state, s.card))
      .map((s) => s.card);
    list.push(...byValue(keep, spare).reverse().slice(0, limit - list.length));
  }
  return list;
}

// Пересобрать Тайник в свой ход: опальные книги — по ценности, остальное место — тому, что уже лежит в Тайнике.
function rehideAction(state: GameState, me: string, ctx: Ctx): Action | null {
  if (state.phase !== 'orders' || state.pending.length) return null;
  const p = player(state, me);
  const open = p.warehouse.some((s) => !s.hidden && !s.memorized && isBanned(state, s.card) && (ctx.curator || !isPropaganda(state, s.card)));
  if (!open) return null;
  const want = hideList(state, me, ctx, keepValues(state, me, ctx));
  const rest = p.warehouse.filter((s) => s.hidden && !want.includes(s.card)).map((s) => s.card);
  const target = [...want, ...rest].slice(0, cacheLimit(state, p));
  const now = p.warehouse.filter((s) => s.hidden).map((s) => s.card);
  if (target.length === now.length && target.every((c) => now.includes(c))) return null;
  return { type: 'hiding', hidden: target };
}

export function candidates(state: GameState, me: string, ctx: Ctx): Action[] {
  const p = player(state, me);
  const books = p.warehouse.map((s) => s.card);
  let cached: Map<string, number> | null = null;
  const keepMap = () => (cached ??= keepValues(state, me, ctx));
  const pend = state.pending[0];
  if (pend && pend.player === me) {
    switch (pend.kind) {
      case 'baraholkaLook': return [...pend.seen.map((x) => ({ type: 'baraholkaBuy' as const, slot: x.slot })), { type: 'baraholkaBuy' }];
      case 'kvartirnikReply': return [{ type: 'kvartirnikReply', accept: true }, { type: 'kvartirnikReply', accept: false }];
      case 'naslednikiPick': {
        // Пары — из лучших по отдельности книг (по оценке бота: для Ростков, Пристрастия, издания), а не из последних в сбросе.
        const withCard = (c: string) => {
          const s = { ...state, players: state.players.map((q) => (q.id === me ? { ...q, warehouse: [...q.warehouse, { card: c, hidden: false }] } : q)) };
          return evaluate(s, me, ctx);
        };
        const value = new Map(pend.cards.map((c) => [c, withCard(c)]));
        const best = [...pend.cards].sort((a, b) => value.get(b)! - value.get(a)!).slice(0, 6);
        const singles = pend.cards.map((c) => [c]);
        return [...singles, ...subsets(best, 2).filter((x) => x.length === 2)].map((cards) => ({ type: 'naslednikiPick', cards }));
      }
      case 'posrednichestvoKeep': {
        const need = Math.min(RULES.posrednichestvoKeep, pend.cards.length);
        return subsets(pend.cards, need).filter((x) => x.length === need).map((keep) => ({ type: 'posrednichestvoKeep', keep }));
      }
      case 'spisanieKeep': {
        const room = Math.max(0, freeSlots(p));
        return [[], ...subsets(pend.cards, room)].map((keep) => ({ type: 'spisanieKeep', keep }));
      }
      case 'posrednichestvoGroup':
      case 'extraGroup':
        return [...groupCandidates(state, me, ctx).filter((g) => p.groupUsed.includes(g.action)).map((group) => ({ type: 'group' as const, group })), { type: 'pass' }];
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
        return drama || (books.includes(c) && (isGenreBook(state, c) || isEvidence(state, c)) && isBanned(state, c));
      });
      return [{ type: 'gathering', show }];
    }
    case 'setupCache':
      return [{ type: 'hiding', hidden: hideList(state, me, ctx, keepMap()) }];
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
      // Действие уже сделано (Тайник и Клуб бот перебирает раньше, в rankActions) — закончить ход.
      if (state.turnDone === me) {
        // Тиражирование вдогонку за только что сделанной покупкой — или закончить ход.
        const out: Action[] = [{ type: 'endTurn' }];
        const last = state.lastBuy;
        if (last?.player === me && !p.groupUsed.includes('copyText') && p.available > 0 && freeSlots(p) > 0) {
          const shelf = (last.address === 'razval' ? state.razval : state[last.address]).filter((c): c is string => !!c && !last.exclude.includes(c) && isGenreBook(state, c));
          for (const card of shelf) out.push({ type: 'group', group: { action: 'copyText', address: last.address, card } });
        }
        return out;
      }
      const groups = () => groupCandidates(state, me, ctx).filter((g) => !p.groupUsed.includes(g.action)).map((group) => ({ type: 'group' as const, group }));
      if (p.available === 0) return [...groups(), { type: 'pass' }];
      // Последний Единомышленник — в Красный уголок; исключение — Расширение сети (новый пойдёт вместо него).
      if (mustVisitRedCorner(state, p)) {
        const hire: Action[] = p.groupUsed.includes('hire') ? [] : [{ type: 'group', group: { action: 'hire' } }];
        return [...redCornerCandidates(state, me, keepMap(), ctx), ...hire];
      }
      const out: Action[] = [...groups()];
      if (!p.visitedRedCorner) out.push(...redCornerCandidates(state, me, keepMap(), ctx));
      else out.push({ type: 'pass' });
      const genreBooks = books.filter((b) => isGenreBook(state, b));
      const addrs = [...PERMANENT_ADDRESSES, ...state.safehouses].filter((a) => state.safehouses.includes(a) || addressInGame(state, a));
      for (const a of addrs) {
        switch (a) {
          case 'gostorg':
            for (let n = 1; n <= Math.min(BOT_BASE.gostorgMaxPairs, Math.floor(freeSlots(p) / 2), hasPatron(state, me, 'zavmag') ? 3 : p.talons); n++) out.push({ type: 'place', place: { address: 'gostorg', pairs: n } });
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
            // Незнакомые закрытые книги для бота одинаковы: смотрит сначала те, что ещё не видел.
            // Уже виденную книгу можно взять «наверняка», досмотрев к ней незнакомую.
            const known = state.baraholkaSeen?.[me] ?? [];
            const filled = state.baraholka.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
            const fresh = [...filled.filter((i) => !known.includes(i)), ...filled.filter((i) => known.includes(i))];
            const need = Math.min(RULES.baraholkaLook, filled.length);
            const sets = [fresh.slice(0, need), ...known.filter((i) => filled.includes(i)).map((k) => [k, ...fresh.filter((i) => i !== k)].slice(0, need))];
            const seenSets = new Set<string>();
            for (const slots of sets) {
              const key = [...slots].sort().join(',');
              if (slots.length && !seenSets.has(key)) { seenSets.add(key); out.push({ type: 'place', place: { address: 'baraholka', slots } }); }
            }
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
          case 'glavlit':
          {
            // Сдать самые ненужные подцензурные книги (1, 2, все) и взять взамен Непечатные — или Нагрузку (прикрывает Тайник).
            const banned = byValue(keepMap(), genreBooks.filter((b) => iconsOf(state, b).some((g) => state.banned.includes(g))));
            for (const n of new Set([1, 2, banned.length])) {
              if (n < 1 || n > banned.length) continue;
              const cards = banned.slice(0, n);
              for (const k of ['unprinted', 'load'] as const) out.push({ type: 'place', place: { address: 'glavlit', cards, draws: cards.map(() => k) } });
            }
            break;
          }
          case 'knigoobmen': {
            const give = byValue(keepMap(), genreBooks).slice(0, 2);
            for (const g of give) for (const take of state.knigoobmen) out.push({ type: 'place', place: { address: 'knigoobmen', give: g, take } });
            break;
          }
          case 'raspredelitel': for (const c of state.raspredelitel) out.push({ type: 'place', place: { address: 'raspredelitel', card: c } }); break;
          case 'nasledniki': case 'posrednichestvo': case 'spisanie': out.push({ type: 'place', place: { address: a } }); break;
          case 'club': if (!RULES.clubFreeGift) out.push(...clubCandidates(state, me, keepMap())); break;
          case 'kontora': {
            // Только что передумал идти (соперники перепрятали книги) — второй раз за ход не объявляет.
            const mine = state.log.filter((l) => l.text.startsWith(p.name + ' ')).pop();
            const changedMind = mine?.text === `${p.name} передумывает идти в Контору.`;
            if (!changedMind && kontoraTargets(state, me).length) out.push({ type: 'place', place: { address: 'kontora' } });
            break;
          }
          case 'kvartirnik': {
            // Отдаём одну из двух самых ненужных книг за открытую книгу соседа, на которую он, вероятно, согласится.
            const give = byValue(keepMap(), genreBooks).slice(0, 2);
            const offers: Action[] = [];
            for (const o of state.players) {
              if (o.id === me) continue;
              for (const w of o.warehouse) {
                if (w.hidden || w.memorized || !isGenreBook(state, w.card)) continue;
                // Куратор меняется, только чтобы отнять у честного книгу для Ростков и не дать взамен такой же.
                if (ctx.curator && (!feedUseful(state, w.card))) continue;
                for (const g of give) if (kvartirnikLikely(state, g, w.card) && !(ctx.curator && feedUseful(state, g))) offers.push({ type: 'place', place: { address: 'kvartirnik', to: o.id, give: g, want: w.card } });
              }
            }
            out.push(...offers.slice(0, 12));
            break;
          }
        }
      }
      return out;
    }
  }
  return [];
}

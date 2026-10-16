// Боты. Думающий бот — в bot-smart.ts, его пресеты — в bot-presets.ts.
// Здесь же простой бот: перебирает варианты действий и выбирает случайный допустимый,
// с лёгкими предпочтениями. Он — пресет «Случайный» и запасной вариант для редких решений.
import { applyAction, activePlayers, mustVisitRedCorner } from './engine';
import { presetById } from './bot-presets';
import { copyTextOptions, smartMove } from './bot-smart';
import { PERMANENT_ADDRESSES, RULES, SPROUTS } from './content';
import type { Action, ClubGift, GameState, Genre, GroupAction } from './types';
import { GENRES } from './types';
import { cacheLimit, freeSlots, iconsOf, isBanned, isLoad, isPropaganda, player, RuleError } from './util';

type Rand = () => number;

function pick<T>(arr: T[], rand: Rand): T | undefined {
  return arr.length ? arr[Math.floor(rand() * arr.length)] : undefined;
}

export function candidateActions(state: GameState, me: string, rand: Rand): Action[] {
  const p = player(state, me);
  const books = p.warehouse.map((s) => s.card);
  const pend = state.pending[0];
  if (pend && pend.player === me) {
    switch (pend.kind) {
      case 'baraholkaLook': return [...pend.seen.map((x) => ({ type: 'baraholkaBuy' as const, slot: x.slot })), { type: 'baraholkaBuy' }];
      case 'kvartirnikReply': return [{ type: 'kvartirnikReply', accept: rand() < 0.5 }];
      case 'naslednikiPick': return [{ type: 'naslednikiPick', cards: pend.cards.slice(-2) }, { type: 'naslednikiPick', cards: pend.cards.slice(-1) }];
      case 'posrednichestvoKeep': return [{ type: 'posrednichestvoKeep', keep: pend.cards.slice(0, RULES.posrednichestvoKeep) }];
      case 'spisanieKeep': return [{ type: 'spisanieKeep', keep: pend.cards.slice(0, Math.max(0, freeSlots(p))) }];
      case 'posrednichestvoGroup': return [...groupCandidates(state, me, rand), { type: 'pass' }];
      case 'kontoraWarning':
        return [{ type: 'kontoraHide', hidden: p.warehouse.filter((s) => s.hidden).map((s) => s.card) }];
      case 'kontoraDecide': {
        const victim = state.players.find((o) => o.id !== me && o.warehouse.some((s) => !s.hidden && !s.memorized && iconsOf(state, s.card).length > 0 && isBanned(state, s.card)));
        const card = victim?.warehouse.find((s) => !s.hidden && !s.memorized && iconsOf(state, s.card).length > 0 && isBanned(state, s.card))?.card;
        const held = state.players.find((o) => o.held > 0);
        const choice = held ? { petition: [held.id] } : { handout: true };
        return [
          { type: 'kontoraDecide', go: true, choice: { ...choice, ...(victim && card ? { seize: { player: victim.id, card } } : {}) } },
          { type: 'kontoraDecide', go: false },
        ];
      }
      case 'glavlitSwap': {
        const free = GENRES.filter((g) => !state.banned.includes(g));
        return [{ type: 'glavlitSwap', from: pick(state.banned, rand)!, to: pick(free, rand)! }];
      }
      case 'lieutenantPick': return [{ type: 'lieutenantPick', card: pend.cards[0] }, { type: 'lieutenantPick', card: null }];
      case 'discardExcess': return [{ type: 'discardExcess', cards: books.slice(-pend.count) }];
      case 'kontoraHandout': return [{ type: 'kontoraHandout', card: pend.cards[0] }];
      case 'extraGroup': return [...groupCandidates(state, me, rand).filter((g) => g.type === 'group' && p.groupUsed.includes(g.group.action)), { type: 'pass' }];
      case 'freeConnection': return [...clubGifts(state, me).map((gift) => ({ type: 'clubGift' as const, gift })), { type: 'pass' }];
      case 'sproutBonus': {
        const out: Action[] = [];
        for (const b of pend.options) {
          if (b === 'sideJob' || b === 'underCounter') out.push({ type: 'sproutBonus', bonus: b });
          else for (const g of groupCandidates(state, me, rand)) if (g.type === 'group' && g.group.action === b) out.push({ type: 'sproutBonus', bonus: b, group: g.group });
        }
        return [...out, { type: 'pass' }];
      }
    }
  }
  switch (state.phase) {
    case 'passion':
      return p.passionOptions.map((x) => ({ type: 'choosePassion', passion: x }));
    case 'gathering':
      return [{ type: 'gathering', show: books.filter((b) => (iconsOf(state, b).length > 0 || state.cards[b].kind === 'evidence' || (state.cards[b].kind === 'loadEvidence' && state.restored[b])) && isBanned(state, b) && rand() < 0.6) }];
    case 'setupCache':
    case 'hiding': {
      const limit = cacheLimit(state, { ...p, warehouse: p.warehouse.map((s) => ({ ...s, hidden: false })) });
      const banned = books.filter((b) => isBanned(state, b) && !isLoad(state, b));
      return [{ type: 'hiding', hidden: banned.slice(0, limit) }, { type: 'hiding', hidden: [] }];
    }
    case 'orders': {
      if (state.turnDone === me) return [{ type: 'endTurn' }];
      if (p.available === 0) return [...groupCandidates(state, me, rand), { type: 'pass' }];
      if (mustVisitRedCorner(state, p)) return [...redCorner(state, me), ...(p.groupUsed.includes('hire') ? [] : [{ type: 'group' as const, group: { action: 'hire' as const } }])];
      const out: Action[] = [...groupCandidates(state, me, rand), ...redCorner(state, me)];
      const addrs = [...PERMANENT_ADDRESSES, ...state.safehouses];
      for (const a of addrs) {
        switch (a) {
          case 'gostorg': out.push({ type: 'place', place: { address: 'gostorg', pairs: 1 } }); break;
          case 'tolkuchka': {
            const sell = pick(books.filter((b) => iconsOf(state, b).length > 0), rand);
            if (sell) out.push({ type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'sell', card: sell }] } });
            const buy = pick(state.tolkuchka, rand);
            if (buy) out.push({ type: 'place', place: { address: 'tolkuchka', ops: [{ op: 'buy', card: buy }] } });
            break;
          }
          case 'razval': state.razval.forEach((c, slot) => c && out.push({ type: 'place', place: { address: 'razval', slot } })); break;
          case 'zavoz': out.push({ type: 'place', place: { address: 'zavoz' } }); break;
          case 'baraholka': out.push({ type: 'place', place: { address: 'baraholka', slots: state.baraholka.map((c, i) => (c ? i : -1)).filter((i) => i >= 0).slice(0, RULES.baraholkaLook) } }); break;
          case 'podpiska': out.push({ type: 'place', place: { address: 'podpiska', genre: pick([...GENRES], rand)!, talons: 1 } }); break;
          case 'sprouts': {
            for (const sp of state.sprouts) {
              const info = SPROUTS.find((s) => s.id === sp.id)!;
              const step = info.steps[sp.progress];
              if (!step) continue;
              const chosen = chooseBooks(state, books, info.main, step.main, step.support);
              if (chosen) out.push({ type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: chosen }] } });
            }
            break;
          }
          case 'samizdat':
          case 'tamizdat':
            for (const b of books) if (iconsOf(state, b).length > 0) out.push({ type: 'place', place: { address: a, card: b } });
            break;
          case 'glavlit':
            for (const b of books) if (state.cards[b].kind === 'genre' && iconsOf(state, b).some((g) => state.banned.includes(g))) out.push({ type: 'place', place: { address: 'glavlit', cards: [b], draws: ['unprinted'] } });
            break;
          case 'knigoobmen': {
            const give = pick(books.filter((b) => iconsOf(state, b).length > 0), rand);
            const take = pick(state.knigoobmen, rand);
            if (give && take) out.push({ type: 'place', place: { address: 'knigoobmen', give, take } });
            break;
          }
          case 'kvartirnik': {
            const other = pick(state.players.filter((x) => x.id !== me), rand)!;
            const want = pick(other.warehouse.filter((s) => !s.hidden).map((s) => s.card), rand);
            const give = pick(books, rand);
            if (want && give) out.push({ type: 'place', place: { address: 'kvartirnik', to: other.id, give, want } });
            break;
          }
          case 'raspredelitel': for (const c of state.raspredelitel) out.push({ type: 'place', place: { address: 'raspredelitel', card: c } }); break;
          case 'nasledniki': case 'posrednichestvo': case 'spisanie': out.push({ type: 'place', place: { address: a } }); break;
          case 'club':
            if (!RULES.clubFreeGift) for (const gift of clubGifts(state, me)) out.push({ type: 'place', place: { address: 'club', gifts: [gift] } });
            else if (state.clubGiftBy !== me) for (const gift of clubGifts(state, me)) out.push({ type: 'clubGift', gift });
            break;
          case 'kontora': if (rand() < 0.15) out.push({ type: 'place', place: { address: 'kontora' } }); break;
        }
      }
      return out;
    }
  }
  return [];
}

function redCorner(state: GameState, me: string): Action[] {
  const p = player(state, me);
  const prop = p.warehouse.find((s) => isPropaganda(state, s.card));
  const load = p.warehouse.find((s) => isLoad(state, s.card));
  const recycle = [prop?.card, load?.card].filter((x): x is string => !!x);
  return [{ type: 'place', place: { address: 'redCorner', recycle } }, { type: 'place', place: { address: 'redCorner', recycle: [] } }];
}

function chooseBooks(state: GameState, books: string[], main: Genre, need: number, support?: Genre): string[] | null {
  const chosen: string[] = [];
  let got = 0;
  for (const b of books) {
    if (got >= need) break;
    const n = iconsOf(state, b).filter((g) => g === main).length;
    if (n) { chosen.push(b); got += n; }
  }
  if (got < need) return null;
  if (support && !chosen.some((b) => iconsOf(state, b).includes(support))) {
    const s = books.find((b) => !chosen.includes(b) && iconsOf(state, b).includes(support));
    if (!s) return null;
    chosen.push(s);
  }
  return chosen;
}

function clubGifts(state: GameState, me: string): ClubGift[] {
  const p = player(state, me);
  const out: ClubGift[] = [];
  for (const pt of state.patrons) {
    if (pt.removed || pt.turned || pt.connections.includes(me)) continue;
    const card = p.warehouse.find((s) => iconsOf(state, s.card).includes(pt.genre))?.card;
    if (card) out.push({ patron: pt.id, card });
  }
  return out;
}

function groupCandidates(state: GameState, me: string, rand: Rand): Action[] {
  const p = player(state, me);
  const out: GroupAction[] = [{ action: 'expandWarehouse' }, { action: 'expandCache' }, { action: 'hire' }];
  const copy = pick(copyTextOptions(state, me), rand);
  if (copy) out.push(copy);
  const r = p.warehouse.find((s) => !state.restored[s.card] && ['genre', 'loadReturnable', 'loadEvidence'].includes(state.cards[s.card].kind));
  if (r) out.push({ action: 'restore', card: r.card });
  const held = state.players.filter((o) => o.held > 0);
  if (held.length) out.push({ action: 'rescue', returns: Object.fromEntries(held.map((o) => [o.id, o.held])) });
  return out.map((group) => ({ type: 'group', group }));
}

// Предпочтения бота: Ростки и издание важнее прочего.
function weight(a: Action): number {
  if (a.type === 'place') {
    if (a.place.address === 'sprouts') return 6;
    if (a.place.address === 'tamizdat') return 3;
    if (a.place.address === 'club') return 2;
    if (a.place.address === 'redCorner') return 0.5;
  }
  if (a.type === 'pass') return 0.1;
  return 1;
}

// Ход бота с пресетом (id из BOT_PRESETS; не задан — пресет по умолчанию).
export function botMove(state: GameState, me: string, rand: Rand = Math.random, presetId?: string | null): GameState {
  const preset = presetById(presetId);
  if (!preset.random) {
    const next = smartMove(state, me, preset, rand);
    if (next) return next;
  }
  return randomMove(state, me, rand);
}

function randomMove(state: GameState, me: string, rand: Rand): GameState {
  const cands = candidateActions(state, me, rand);
  const pool = [...cands];
  while (pool.length) {
    const total = pool.reduce((s, a) => s + weight(a), 0);
    let r = rand() * total;
    let i = 0;
    for (; i < pool.length - 1; i++) { r -= weight(pool[i]); if (r <= 0) break; }
    const [a] = pool.splice(i, 1);
    try {
      return applyAction(state, me, a);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
    }
  }
  // Ничего не подошло: в фазе поручений — Красный уголок без сдачи или пас.
  for (const a of [{ type: 'endTurn' }, { type: 'place', place: { address: 'redCorner', recycle: [] } }, { type: 'pass' }, { type: 'gathering', show: [] }, { type: 'hiding', hidden: [] }, { type: 'baraholkaBuy' }, { type: 'kvartirnikReply', accept: false }, { type: 'kontoraDecide', go: false }, { type: 'kontoraHide', hidden: [] }] as Action[]) {
    // Пересобрать Тайник можно и в свой ход, но ход это не завершает — в поручениях это не выход.
    if (a.type === 'hiding' && state.phase !== 'hiding') continue;
    try { return applyAction(state, me, a); } catch (e) { if (!(e instanceof RuleError)) throw e; }
  }
  throw new Error(`Бот ${me} не нашёл допустимого хода (фаза ${state.phase})`);
}

// Доиграть партию ботами. presets — пресет для всех или для каждого игрока (id игрока → id пресета).
export function playOut(state: GameState, rand: Rand = Math.random, maxSteps = 5000, presets: Record<string, string> | string = {}): GameState {
  let s = state;
  for (let i = 0; i < maxSteps && s.phase !== 'end'; i++) {
    const who = activePlayers(s)[0];
    s = botMove(s, who, rand, typeof presets === 'string' ? presets : presets[who]);
  }
  return s;
}

// Простой бот: перебирает варианты действий и выбирает случайный допустимый,
// с лёгкими предпочтениями. Нужен для симуляций, тестов и пустых мест за столом.
import { applyAction, activePlayers, mustVisitRedCorner } from './engine';
import { PERMANENT_ADDRESSES, SPROUTS } from './content';
import type { Action, GameState, Genre, GroupAction } from './types';
import { GENRES } from './types';
import { cacheLimit, iconsOf, isBanned, isLoad, isPropaganda, player, RuleError } from './util';

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
      case 'baraholkaLook': return [{ type: 'baraholkaBuy', buy: true }, { type: 'baraholkaBuy', buy: false }];
      case 'kvartirnikReply': return [{ type: 'kvartirnikReply', accept: rand() < 0.5 }];
      case 'naslednikiPick': return [{ type: 'naslednikiPick', cards: pend.cards.slice(-2) }, { type: 'naslednikiPick', cards: pend.cards.slice(-1) }];
      case 'posrednichestvoKeep': return [{ type: 'posrednichestvoKeep', keep: pend.cards.slice(0, 2) }, { type: 'posrednichestvoKeep', keep: pend.cards.slice(0, 1) }];
      case 'posrednichestvoGroup': return [...groupCandidates(state, me), { type: 'pass' }];
      case 'sproutBonus': {
        const out: Action[] = [];
        for (const b of pend.options) {
          if (b === 'sideJob' || b === 'underCounter') out.push({ type: 'sproutBonus', bonus: b });
          else for (const g of groupCandidates(state, me)) if (g.type === 'group' && g.group.action === b) out.push({ type: 'sproutBonus', bonus: b, group: g.group });
        }
        return [...out, { type: 'pass' }];
      }
    }
  }
  switch (state.phase) {
    case 'passion':
      return p.passionOptions.map((x) => ({ type: 'choosePassion', passion: x }));
    case 'gathering':
      return [{ type: 'gathering', show: books.filter((b) => iconsOf(state, b).length > 0 && isBanned(state, b) && rand() < 0.6) }];
    case 'hiding': {
      const limit = cacheLimit(state, { ...p, warehouse: p.warehouse.map((s) => ({ ...s, hidden: false })) });
      const banned = books.filter((b) => isBanned(state, b) && !isLoad(state, b));
      return [{ type: 'hiding', hidden: banned.slice(0, limit) }, { type: 'hiding', hidden: [] }];
    }
    case 'orders': {
      if (p.available === 0) return [...groupCandidates(state, me), { type: 'pass' }];
      if (mustVisitRedCorner(p)) return redCorner(state, me);
      const out: Action[] = [...groupCandidates(state, me), ...redCorner(state, me)];
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
          case 'baraholka': out.push({ type: 'place', place: { address: 'baraholka', slot: state.baraholka.findIndex((c) => c) } }); break;
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

function groupCandidates(state: GameState, me: string): Action[] {
  const p = player(state, me);
  const out: GroupAction[] = [{ action: 'expandWarehouse' }, { action: 'expandCache' }, { action: 'copyText', card: 'deck' }, { action: 'hire' }];
  const r = p.warehouse.find((s) => !state.restored[s.card] && ['genre', 'loadReturnable'].includes(state.cards[s.card].kind));
  if (r) out.push({ action: 'restore', card: r.card });
  return out.map((group) => ({ type: 'group', group }));
}

// Предпочтения бота: Ростки и издание важнее прочего.
function weight(a: Action): number {
  if (a.type === 'place') {
    if (a.place.address === 'sprouts') return 6;
    if (a.place.address === 'tamizdat') return 3;
    if (a.place.address === 'redCorner') return 0.5;
  }
  if (a.type === 'pass') return 0.3;
  return 1;
}

export function botMove(state: GameState, me: string, rand: Rand = Math.random): GameState {
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
  for (const a of [{ type: 'place', place: { address: 'redCorner', recycle: [] } }, { type: 'pass' }, { type: 'gathering', show: [] }, { type: 'hiding', hidden: [] }, { type: 'baraholkaBuy', buy: false }, { type: 'kvartirnikReply', accept: false }] as Action[]) {
    try { return applyAction(state, me, a); } catch (e) { if (!(e instanceof RuleError)) throw e; }
  }
  throw new Error(`Бот ${me} не нашёл допустимого хода (фаза ${state.phase})`);
}

export function playOut(state: GameState, rand: Rand = Math.random, maxSteps = 5000): GameState {
  let s = state;
  for (let i = 0; i < maxSteps && s.phase !== 'end'; i++) {
    const who = activePlayers(s)[0];
    s = botMove(s, who, rand);
  }
  return s;
}

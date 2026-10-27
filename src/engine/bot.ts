// Боты. Думающий бот — в bot-smart.ts, его пресеты — в bot-presets.ts.
// Здесь же простой бот: перебирает варианты действий и выбирает случайный допустимый,
// с лёгкими предпочтениями. Он — пресет «Случайный» и запасной вариант для редких решений.
import { applyAction, activePlayers, mustVisitRedCorner } from './engine';
import { curatorStyle, presetById } from './bot-presets';
import { copyTextOptions, effectiveCuratorStyle, smartMove } from './bot-smart';
import { PERMANENT_ADDRESSES, RULES, SPROUTS } from './content';
import { befriendTargets } from './full';
import type { Action, ClubGift, GameState, Genre, GroupAction } from './types';
import { GENRES } from './types';
import { cacheLimit, freeSlots, freeSproutSlots, isFromLoadDeck, genresOf, iconCount, iconsOf, isBanned, isLoad, isPropaganda, player, RuleError } from './util';

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
      case 'makulatura': return pend.cards.length ? [{ type: 'makulaturaKeep', card: pend.cards[0] }] : [{ type: 'makulaturaDraw', deck: 'unprinted' }];
      case 'posrednichestvoGroup': return [...groupCandidates(state, me, rand), { type: 'pass' }];
      case 'kontoraWarning':
        return [{ type: 'kontoraHide', hidden: p.warehouse.filter((s) => s.hidden).map((s) => s.card) }];
      case 'kontoraDecide': {
        const victim = state.players.find((o) => o.id !== me && o.warehouse.some((s) => !s.hidden && !s.memorized && iconCount(state, s.card) > 0 && isBanned(state, s.card)));
        const card = victim?.warehouse.find((s) => !s.hidden && !s.memorized && iconCount(state, s.card) > 0 && isBanned(state, s.card))?.card;
        const held = state.players.find((o) => o.held > 0);
        const choice = held ? { petition: [held.id] } : { handout: true };
        if (held && (!card || rand() < 0.5)) return [{ type: 'kontoraDecide', go: true, choice: { rescue: { [held.id]: 1 } } }, { type: 'kontoraDecide', go: false }];
        return [
          { type: 'kontoraDecide', go: true, choice: { ...choice, ...(victim && card ? { denounce: { player: victim.id, card } } : {}) } },
          { type: 'kontoraDecide', go: false },
        ];
      }
      case 'glavlitSwap': {
        const free = GENRES.filter((g) => !state.banned.includes(g));
        return [{ type: 'glavlitSwap', from: pick(state.banned, rand)!, to: pick(free, rand)! }];
      }
      case 'lieutenantPick': return [{ type: 'lieutenantPick', card: pend.cards[0] }, { type: 'lieutenantPick', card: null }];
      case 'discardExcess': return [{ type: 'discardExcess', cards: books.slice(-pend.count) }];
      case 'kontoraHandout': {
        const left = pend.cards.filter((c) => state.spetskhran.includes(c));
        return left.length ? [{ type: 'kontoraHandout', card: left[0] }] : [{ type: 'pass' }];
      }
      case 'extraGroup': return [...groupCandidates(state, me, rand).filter((g) => g.type === 'group' && p.groupUsed.includes(g.group.action)), { type: 'pass' }];
      case 'freeConnection': return [...clubGifts(state, me).map((gift) => ({ type: 'clubGift' as const, gift })), { type: 'pass' }];
      case 'sproutBonus': {
        const out: Action[] = [];
        for (const b of pend.options) {
          if (b === 'sideJob' || b === 'underCounter') out.push({ type: 'sproutBonus', bonus: b });
          else if (b === 'acquaintance') for (const patron of befriendTargets(state, me)) out.push({ type: 'sproutBonus', bonus: b, patron });
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
      return [{ type: 'gathering', show: books.filter((b) => (iconCount(state, b) > 0 || state.cards[b].kind === 'evidence' || (state.cards[b].kind === 'loadEvidence' && state.restored[b])) && isBanned(state, b) && rand() < 0.6) }];
    case 'ambush':
      return [{ type: 'ambush', go: p.passion === 'curator' && !state.curatorRevealed && rand() < 0.3
        && state.players.some((o) => o.id !== p.id && (state.shownAtGathering?.[o.id] ?? []).length > 0) }];
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
            const sell = pick(books.filter((b) => iconCount(state, b) > 0), rand);
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
              if (chosen) for (const slot of freeSproutSlots(state, sp.id)) out.push({ type: 'place', place: { address: 'sprouts', feeds: [{ sprout: sp.id, books: chosen, slot }] } });
            }
            break;
          }
          case 'samizdat':
          case 'tamizdat':
            for (const b of books) if (iconCount(state, b) > 0) out.push({ type: 'place', place: { address: a, card: b } });
            break;
          case 'glavlit':
            for (const b of books) out.push({ type: 'place', place: { address: 'glavlit', recycle: [b] } });
            break;
          case 'knigoobmen': {
            const give = pick(books.filter((b) => iconCount(state, b) > 0), rand);
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
          case 'agitpunkt': for (const c of new Set(state.agitpunkt ?? [])) out.push({ type: 'place', place: { address: 'agitpunkt', card: c } }); break;
          case 'nasledniki': case 'posrednichestvo': case 'spisanie': case 'makulatura': out.push({ type: 'place', place: { address: a } }); break;
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
  // Нет места для Нагрузки — отдать первую попавшуюся книгу Непечатных.
  const drop = freeSlots(p) > 0 ? undefined : p.warehouse.find((s) => !isFromLoadDeck(state, s.card))?.card;
  return [{ type: 'place', place: { address: 'redCorner', ...(drop ? { drop } : {}) } }];
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
    const card = p.warehouse.find((s) => genresOf(state, s.card).includes(pt.genre))?.card;
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
  if (state.spetskhran.length && freeSlots(p) > 0) out.push({ action: 'spetskhran' });
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
    if (next) {
      const unmask = curatorUnmask(state, me)
        ?? (next.curatorRevealed === me && !state.curatorUnmask ? { round: state.round, act: player(state, me).actions?.length ?? 0, why: 'ambush' as const } : null);
      if (unmask) next.curatorUnmask = unmask;
      return next;
    }
  }
  return randomMove(state, me, rand);
}

// Куратор-бот впервые решает ход уже без маски: «Удав» и «Хищник» — после открыто взятой ЧНЛ,
// «Удав» — когда его раскусили, «Хищник» — с 3-й Пятилетки (дальше он и так бьёт открыто).
function curatorUnmask(state: GameState, me: string): GameState['curatorUnmask'] | null {
  if (state.curatorUnmask || state.mode !== 'full') return null;
  const p = player(state, me);
  if (p.passion !== 'curator') return null;
  const base = curatorStyle(state, me);
  if (base === 'open') return null;
  const act = (p.actions?.length ?? 0) + (state.phase === 'orders' ? 1 : 0);
  if (state.curatorRevealed === me) return { round: state.round, act, why: 'ambush' };
  if ((p.propagandaTaken ?? 0) > 0) return { round: state.round, act, why: 'propaganda' };
  if (effectiveCuratorStyle(state, me) === 'open') return { round: state.round, act, why: 'exposed' };
  if (base === 'ambush' && state.round >= 3) return { round: state.round, act, why: 'round' };
  return null;
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
  for (const a of [{ type: 'endTurn' }, { type: 'place', place: { address: 'redCorner' } }, { type: 'pass' }, { type: 'gathering', show: [] }, { type: 'ambush', go: false }, { type: 'hiding', hidden: [] }, { type: 'baraholkaBuy' }, { type: 'kvartirnikReply', accept: false }, { type: 'kontoraDecide', go: false }, { type: 'kontoraHide', hidden: [] }] as Action[]) {
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

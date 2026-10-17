// Что видит конкретный игрок: тайная информация других игроков и колоды скрыты.
import { activePlayers } from './engine';
import type { GameState, Pending, PlayerState } from './types';

export interface PlayerView extends Omit<GameState, 'rng' | 'seed' | 'deck' | 'discard' | 'loadDeck' | 'loadDiscard' | 'baraholka' | 'baraholkaSeen' | 'players' | 'pending' | 'spetskhran' | 'spetskhranSeen'> {
  spetskhranCount: number;
  me: string | null;
  active: string[];
  deckCount: number;
  discardCount: number;
  loadDeckCount: number;
  loadDiscardCount: number;
  baraholka: boolean[]; // есть ли книга в ячейке
  baraholkaKnown: (string | null)[]; // книги Барахолки, которые этот игрок уже посмотрел
  players: (Omit<PlayerState, 'warehouse' | 'passion' | 'passionOptions'> & {
    warehouse: { card: string | null; hidden: boolean; memorized?: boolean }[];
    passion: PlayerState['passion'];
    passionOptions: PlayerState['passionOptions'];
  })[];
  pending: (Pending | { kind: Pending['kind']; player: string; secret: true })[];
}

// omniscient — видно всё (хост наблюдает за партией ботов со стороны).
export function viewFor(state: GameState, me: string | null, omniscient = false): PlayerView {
  const ended = state.phase === 'end' || omniscient;
  const { rng, seed, deck, discard, loadDeck, loadDiscard, baraholka, baraholkaSeen, players, pending, log, spetskhran, spetskhranSeen, ...rest } = state;
  // Пока выбирают Пристрастия, стол ещё не открыт: видны только свои стартовые книги.
  const closedTable = state.phase === 'passion' && !omniscient;
  return {
    ...rest,
    ...(closedTable ? {
      razval: rest.razval.map(() => null), tolkuchka: [], knigoobmen: [], raspredelitel: [],
      sprouts: [], patrons: [], safehouses: [],
    } : {}),
    me,
    active: activePlayers(state),
    spetskhranCount: spetskhran.length,
    deckCount: deck.length,
    discardCount: discard.length,
    loadDeckCount: loadDeck.length,
    loadDiscardCount: loadDiscard.length,
    baraholka: baraholka.map((c) => !closedTable && c !== null),
    baraholkaKnown: baraholka.map((c, i) => (me !== null && !closedTable && baraholkaSeen?.[me]?.includes(i) ? c : null)),
    players: players.map((p) => {
      const own = p.id === me || ended;
      // До раскладки Тайников в начале партии чужие стартовые книги не видны совсем.
      const concealAll = state.phase === 'passion' || state.phase === 'setupCache';
      const { warehouse, passion, passionOptions, ...pub } = p;
      return {
        ...pub,
        warehouse: warehouse.map((s) => ({ card: own || (!s.hidden && !concealAll) ? s.card : null, hidden: s.hidden, ...(s.memorized ? { memorized: true } : {}) })),
        passion: own ? passion : null,
        passionOptions: p.id === me ? passionOptions : [],
      };
    }),
    pending: pending.map((x) => (x.player === me ? x : { kind: x.kind, player: x.player, secret: true as const })),
    log: log.filter((l) => omniscient || !l.only || (me !== null && l.only.includes(me))),
  };
}

// Карты, которые игрок видит (по виду партии для него), и тайные записи журнала только для него.
function seenBy(state: GameState, me: string): { cards: Set<string>; notes: number } {
  const { cards: _all, ...v } = viewFor(state, me);
  return {
    cards: new Set(JSON.stringify(v).match(/c\d{3}/g) ?? []),
    notes: state.log.filter((l) => l.only?.includes(me)).length,
  };
}

// Узнал ли игрок что-то новое между двумя состояниями: увидел карту, которой раньше не видел, или получил тайную запись.
// Ход, после которого игрок узнал новое, отменять нельзя — знание уже не забыть.
export function gainedInfo(prev: GameState, next: GameState, me: string): boolean {
  const a = seenBy(prev, me);
  const b = seenBy(next, me);
  if (b.notes > a.notes) return true;
  for (const c of b.cards) if (!a.cards.has(c)) return true;
  return false;
}

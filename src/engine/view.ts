// Что видит конкретный игрок: тайная информация других игроков и колоды скрыты.
import { activePlayers } from './engine';
import type { GameState, Pending, PlayerState } from './types';

export interface PlayerView extends Omit<GameState, 'rng' | 'seed' | 'deck' | 'discard' | 'loadDeck' | 'loadDiscard' | 'baraholka' | 'players' | 'pending' | 'spetskhran'> {
  spetskhranCount: number;
  me: string | null;
  active: string[];
  deckCount: number;
  discardCount: number;
  loadDeckCount: number;
  loadDiscardCount: number;
  baraholka: boolean[]; // есть ли книга в ячейке
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
  const { rng, seed, deck, discard, loadDeck, loadDiscard, baraholka, players, pending, log, spetskhran, ...rest } = state;
  // Пока выбирают Пристрастия, стол ещё не открыт: видны только свои стартовые книги.
  const closedTable = state.phase === 'passion' && !omniscient;
  return {
    ...rest,
    ...(closedTable ? {
      razval: rest.razval.map(() => null), tolkuchka: [], knigoobmen: [], raspredelitel: [],
      sprouts: [], patrons: [], safehouses: [], banned: [],
    } : {}),
    me,
    active: activePlayers(state),
    spetskhranCount: spetskhran.length,
    deckCount: deck.length,
    discardCount: discard.length,
    loadDeckCount: loadDeck.length,
    loadDiscardCount: loadDiscard.length,
    baraholka: baraholka.map((c) => !closedTable && c !== null),
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

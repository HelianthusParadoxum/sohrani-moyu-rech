// Что видит конкретный игрок: тайная информация других игроков и колоды скрыты.
import { activePlayers } from './engine';
import type { GameState, Pending, PlayerState } from './types';

export interface PlayerView extends Omit<GameState, 'rng' | 'seed' | 'deck' | 'discard' | 'loadDeck' | 'loadDiscard' | 'baraholka' | 'players' | 'pending'> {
  me: string | null;
  active: string[];
  deckCount: number;
  discardCount: number;
  loadDeckCount: number;
  loadDiscardCount: number;
  baraholka: boolean[]; // есть ли книга в ячейке
  players: (Omit<PlayerState, 'warehouse' | 'spetskhran' | 'passion' | 'passionOptions'> & {
    warehouse: { card: string | null; hidden: boolean }[];
    spetskhranCount: number;
    passion: PlayerState['passion'];
    passionOptions: PlayerState['passionOptions'];
  })[];
  pending: (Pending | { kind: Pending['kind']; player: string; secret: true })[];
}

export function viewFor(state: GameState, me: string | null): PlayerView {
  const ended = state.phase === 'end';
  const { rng, seed, deck, discard, loadDeck, loadDiscard, baraholka, players, pending, log, ...rest } = state;
  return {
    ...rest,
    me,
    active: activePlayers(state),
    deckCount: deck.length,
    discardCount: discard.length,
    loadDeckCount: loadDeck.length,
    loadDiscardCount: loadDiscard.length,
    baraholka: baraholka.map((c) => c !== null),
    players: players.map((p) => {
      const own = p.id === me || ended;
      const { spetskhran, warehouse, passion, passionOptions, ...pub } = p;
      return {
        ...pub,
        warehouse: warehouse.map((s) => ({ card: own || !s.hidden ? s.card : null, hidden: s.hidden })),
        spetskhranCount: spetskhran.length,
        passion: own ? passion : null,
        passionOptions: p.id === me ? passionOptions : [],
      };
    }),
    pending: pending.map((x) => (x.player === me ? x : { kind: x.kind, player: x.player, secret: true as const })),
    log: log.filter((l) => !l.only || (me !== null && l.only.includes(me))),
  };
}

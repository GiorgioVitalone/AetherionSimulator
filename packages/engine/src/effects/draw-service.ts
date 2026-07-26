import type { GameEvent, GameState, PlayerState } from '../types/game-state.js';

export type DrawCause = 'upkeep' | 'effect' | 'recycle' | 'scheduled' | 'tutor_then_draw';

export interface DrawAttemptResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  /** One-based attempt number that could not draw, or null when all succeeded. */
  readonly failedAttempt: number | null;
  readonly drawnCount: number;
}

/**
 * The sole Main Deck draw service. Attempts are processed one card at a time so
 * a draw-two from a one-card deck draws the first card and loses on attempt two.
 * Historical effect/recycle profiles retain their capped-draw behavior; Upkeep
 * and the current rules always lose at the first impossible attempt.
 */
export function attemptDraw(
  state: GameState,
  playerId: 0 | 1,
  count: number,
  cause: DrawCause,
): DrawAttemptResult {
  const requested = Math.max(0, Math.floor(count));
  const opposingPlayerId: 0 | 1 = playerId === 0 ? 1 : 0;
  let current = state;
  let drawnCount = 0;
  let failedAttempt: number | null = null;
  let deckout = false;

  for (let attempt = 1; attempt <= requested; attempt++) {
    const player = current.players[playerId];
    const drawn = player.mainDeck[0];
    if (drawn === undefined) {
      failedAttempt = attempt;
      if (cause === 'upkeep' || current.config?.effectDrawDeckout === true) {
        current = { ...current, winner: opposingPlayerId };
        deckout = true;
      }
      break;
    }
    const nextPlayer: PlayerState = {
      ...player,
      mainDeck: player.mainDeck.slice(1),
      hand: [...player.hand, drawn],
    };
    const players = [...current.players] as [PlayerState, PlayerState];
    players[playerId] = nextPlayer;
    current = { ...current, players };
    drawnCount++;
  }

  return {
    state: current,
    events: [
      ...(drawnCount === 0
        ? []
        : [{ type: 'CARD_DRAWN' as const, playerId, count: drawnCount }]),
      ...(deckout
        ? [
            {
              type: 'GAME_ENDED' as const,
              winnerPlayerId: opposingPlayerId,
              losingPlayerId: playerId,
              reason: 'deck_exhaustion' as const,
            },
          ]
        : []),
    ],
    failedAttempt,
    drawnCount,
  };
}

/**
 * useViewingPlayer — player-relative selectors for hot-seat play.
 *
 * Instead of always showing the active player's perspective,
 * this hook indexes into state.players using viewingPlayer from ui-store.
 * This lets the turn handoff overlay swap perspectives cleanly.
 */
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
import type { PlayerState } from '@aetherion-sim/engine';

interface ViewingPlayerResult {
  readonly viewingPlayer: 0 | 1;
  readonly isMyTurn: boolean;
  readonly myState: PlayerState | null;
  readonly opponentState: PlayerState | null;
}

export function useViewingPlayer(): ViewingPlayerResult {
  const viewingPlayer = useUiStore((s) => s.viewingPlayer);
  const state = useGameStore((s) => s.state);

  if (!state) {
    return {
      viewingPlayer,
      isMyTurn: false,
      myState: null,
      opponentState: null,
    };
  }

  const opponentIndex = viewingPlayer === 0 ? 1 : 0;

  return {
    viewingPlayer,
    isMyTurn: state.activePlayerIndex === viewingPlayer,
    myState: state.players[viewingPlayer],
    opponentState: state.players[opponentIndex],
  };
}

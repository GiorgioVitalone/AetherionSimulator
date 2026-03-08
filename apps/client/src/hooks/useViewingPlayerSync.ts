/**
 * useViewingPlayerSync — syncs viewingPlayer to activePlayerIndex after mulligan.
 *
 * During mulligan, viewingPlayer stays at 0 (for P1's mulligan, then the handoff
 * screen handles P2). Once both players have mulliganed and the engine transitions
 * to the playing states (upkeep → strategy), this hook snaps viewingPlayer to
 * whoever the engine picked as the first active player.
 *
 * Without this, if activePlayerIndex is 1 after mulligan, the UI would show P1's
 * perspective while P2 is active — making isMyTurn false and the game appear frozen.
 */
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';

export function useViewingPlayerSync(): void {
  const phase = useGameStore((s) => s.state?.phase);
  const activePlayerIndex = useGameStore((s) => s.state?.activePlayerIndex ?? 0);
  const setViewingPlayer = useUiStore((s) => s.setViewingPlayer);
  const prevPhaseRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const wasInMulligan = prevPhaseRef.current === 'mulligan';
    prevPhaseRef.current = phase;

    // When transitioning out of mulligan, sync to whoever goes first
    if (wasInMulligan && phase !== undefined && phase !== 'mulligan') {
      setViewingPlayer(activePlayerIndex);
    }
  }, [phase, activePlayerIndex, setViewingPlayer]);
}

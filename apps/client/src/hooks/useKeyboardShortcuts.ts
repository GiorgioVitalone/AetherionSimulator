/**
 * useKeyboardShortcuts — Enter to end phase, Escape to cancel action flow.
 */
import { useEffect } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useActionFlowStore } from '@/stores/action-flow-store';
import { useUiStore } from '@/stores/ui-store';

export function useKeyboardShortcuts(): void {
  const dispatch = useGameStore((s) => s.dispatch);
  const canEndPhase = useGameStore((s) => s.availableActions?.canEndPhase ?? false);
  const cancelFlow = useActionFlowStore((s) => s.cancel);
  const selectCard = useUiStore((s) => s.selectCard);
  const hoverCard = useUiStore((s) => s.hoverCard);
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const hoveredCardId = useUiStore((s) => s.hoveredCardId);
  const flowStep = useActionFlowStore((s) => s.flowState.step);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if inside input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Enter' && canEndPhase) {
        e.preventDefault();
        dispatch({ type: 'end_phase' });
      }

      if (e.key === 'Escape') {
        if (flowStep !== 'idle') {
          // Cancel active action flow (card_selected, awaiting_zone, awaiting_target)
          cancelFlow();
          selectCard(null);
          hoverCard(null);
          e.preventDefault();
        } else if (hoveredCardId || selectedCardId) {
          // Dismiss card detail preview and selection in idle state
          hoverCard(null);
          selectCard(null);
          e.preventDefault();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, canEndPhase, cancelFlow, selectCard, hoverCard, selectedCardId, hoveredCardId, flowStep]);
}

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
  const flowStep = useActionFlowStore((s) => s.flowState.step);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore if inside input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === 'Enter' && canEndPhase) {
        e.preventDefault();
        dispatch({ type: 'end_phase' });
      }

      if (e.key === 'Escape' && flowStep !== 'idle') {
        e.preventDefault();
        cancelFlow();
        selectCard(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch, canEndPhase, cancelFlow, selectCard, flowStep]);
}

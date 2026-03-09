/**
 * PhaseIndicator — shows current game phase, turn counter, and "End Phase" button.
 */
import type { ReactNode } from 'react';
import type { GamePhase } from '@aetherion-sim/engine';
import { useGameStore } from '@/stores/game-store';
import { Tooltip } from '@/features/shared/Tooltip';

interface PhaseIndicatorProps {
  readonly phase: GamePhase;
  readonly turnNumber: number;
  readonly isMyTurn: boolean;
}

const PHASE_LABELS: Record<GamePhase, string> = {
  setup: 'Setup',
  mulligan: 'Mulligan',
  upkeep: 'Upkeep',
  strategy: 'Strategy',
  action: 'Action',
  end: 'End',
  game_over: 'Game Over',
};

const PHASE_DESCRIPTIONS: Record<GamePhase, string> = {
  setup: 'Game is being set up',
  mulligan: 'Choose to keep or redraw your opening hand',
  upkeep: 'Refresh cards, draw a resource, draw a card',
  strategy: 'Deploy characters, cast spells, equip items',
  action: 'Attack, move, activate abilities',
  end: 'End of turn cleanup',
  game_over: 'The game has ended',
};

export function PhaseIndicator({ phase, turnNumber, isMyTurn }: PhaseIndicatorProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const canEndPhase = useGameStore((s) => s.availableActions?.canEndPhase ?? false);

  const showEndButton = isMyTurn && canEndPhase && (phase === 'strategy' || phase === 'action');

  return (
    <div className="flex items-center gap-3">
      {/* Phase name */}
      <Tooltip content={PHASE_DESCRIPTIONS[phase]}>
        <span className="text-[9px] uppercase tracking-widest font-semibold text-[var(--color-accent-light)] font-body">
          {PHASE_LABELS[phase]}
        </span>
      </Tooltip>

      {/* Turn counter */}
      <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
        T{turnNumber}
      </span>

      {/* End Phase button */}
      {showEndButton && (
        <button
          type="button"
          onClick={() => dispatch({ type: 'end_phase' })}
          className="
            px-3 py-1 rounded-[var(--radius-md)] text-[11px] font-semibold font-body
            bg-[var(--color-accent)] text-[var(--color-text-inverse)]
            hover:bg-[var(--color-accent-light)] hover:shadow-[0_0_8px_rgba(190,148,56,0.3)] active:scale-[0.97] active:brightness-95 transition-all duration-150 cursor-pointer
          "
        >
          End Phase
        </button>
      )}
    </div>
  );
}

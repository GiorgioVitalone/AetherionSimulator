/**
 * MulliganChoice — full-screen mulligan UI shown at game start.
 * Each player decides to keep or redraw their opening hand.
 */
import type { ReactNode } from 'react';
import type { PendingChoice, CardInstance } from '@aetherion-sim/engine';
import { CardDisplay } from '@aetherion-sim/ui';
import { useGameStore } from '@/stores/game-store';
import { mapCardToDisplay } from '@/utils/card-mappers';

interface MulliganChoiceProps {
  readonly choice: PendingChoice;
  readonly hand: readonly CardInstance[];
}

export function MulliganChoice({ choice, hand }: MulliganChoiceProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const playerId = choice.playerId;

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'var(--color-surface-overlay)',
      }}
    >
      <h2 className="text-2xl font-bold mb-2 font-body">
        Player {playerId + 1} — Mulligan
      </h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-6 font-body">
        Keep your hand or draw a new one (4 cards)
      </p>

      {/* Show hand cards */}
      <div className="flex gap-3 mb-8">
        {hand.map((card) => {
          const props = mapCardToDisplay(card, { mode: 'hand' });
          return <CardDisplay key={card.instanceId} {...props} />;
        })}
      </div>

      {/* Keep / Mulligan buttons */}
      <div className="flex gap-4">
        <button
          type="button"
          onClick={() => dispatch({ type: 'mulligan_decision', playerId, keep: true })}
          className="
            px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
            bg-[var(--color-accent)] text-[var(--color-text-inverse)]
            hover:brightness-110 transition-all duration-150 cursor-pointer
          "
        >
          Keep
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'mulligan_decision', playerId, keep: false })}
          className="
            px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
            border-2 border-[var(--color-border-strong)] text-[var(--color-text)]
            hover:border-[var(--color-accent-muted)] transition-all duration-150 cursor-pointer
          "
          style={{ backgroundColor: 'var(--color-surface)' }}
        >
          Mulligan
        </button>
      </div>
    </div>
  );
}

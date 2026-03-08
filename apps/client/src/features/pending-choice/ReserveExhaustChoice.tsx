/**
 * ReserveExhaustChoice — full-screen overlay for choosing reserve characters to exhaust.
 *
 * When the engine asks the player to exhaust reserve characters for resources,
 * this component renders their reserve cards with selection UI. Players select
 * which characters to exhaust and confirm.
 */
import { type ReactNode, useState, useCallback } from 'react';
import type { PendingChoice, CardInstance } from '@aetherion-sim/engine';
import { CardDisplay } from '@aetherion-sim/ui';
import { useGameStore } from '@/stores/game-store';
import { useViewingPlayer } from '@/hooks/useViewingPlayer';
import { mapCardToDisplay } from '@/utils/card-mappers';

interface ReserveExhaustChoiceProps {
  readonly choice: PendingChoice;
}

export function ReserveExhaustChoice({ choice }: ReserveExhaustChoiceProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const { myState } = useViewingPlayer();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleOption = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else if (next.size < choice.maxSelections) {
          next.add(id);
        }
        return next;
      });
    },
    [choice.maxSelections],
  );

  const canSubmit = selected.size >= choice.minSelections && selected.size <= choice.maxSelections;

  // Build a map of instanceId → CardInstance from reserve zone
  const reserveCards = new Map<string, CardInstance>();
  if (myState) {
    for (const card of myState.zones.reserve) {
      if (card) reserveCards.set(card.instanceId, card);
    }
  }

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'var(--color-surface-overlay)',
      }}
    >
      <h2 className="text-2xl font-bold mb-2 font-body">
        Exhaust Reserve Characters
      </h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-6 font-body">
        {choice.context}
        {choice.minSelections > 0 && (
          <span className="text-[var(--color-text-faint)]">
            {' '}(select {choice.minSelections === choice.maxSelections
              ? choice.minSelections
              : `${choice.minSelections}-${choice.maxSelections}`})
          </span>
        )}
      </p>

      {/* Reserve cards as visual cards */}
      <div className="flex gap-4 mb-8">
        {choice.options.map((option) => {
          const card = option.instanceId ? reserveCards.get(option.instanceId) : undefined;
          const isSelected = selected.has(option.id);

          if (card) {
            const props = mapCardToDisplay(card, {
              mode: 'hand',
              selected: isSelected,
              onClick: () => toggleOption(option.id),
            });
            return (
              <div key={option.id} className="flex flex-col items-center gap-2">
                <div
                  className={`rounded-[var(--radius-md)] transition-all duration-150 ${
                    isSelected ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-[var(--color-bg)]' : ''
                  }`}
                >
                  <CardDisplay {...props} />
                </div>
                <span className="text-xs font-body text-[var(--color-text-secondary)]">
                  {option.label}
                </span>
              </div>
            );
          }

          // Fallback: text-only option
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleOption(option.id)}
              className={`
                px-4 py-3 rounded-[var(--radius-md)] border-2 text-sm font-body
                transition-colors duration-150 cursor-pointer
                ${isSelected
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'}
              `}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Confirm */}
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => dispatch({ type: 'player_response', response: { selectedOptionIds: [...selected] } })}
        className={`
          px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
          transition-all duration-150
          ${canSubmit
            ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:brightness-110 cursor-pointer'
            : 'bg-[var(--color-surface-alt)] text-[var(--color-text-faint)] cursor-not-allowed'}
        `}
      >
        Confirm
      </button>
    </div>
  );
}

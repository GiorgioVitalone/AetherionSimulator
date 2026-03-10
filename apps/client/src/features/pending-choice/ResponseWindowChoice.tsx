/**
 * ResponseWindowChoice — displays available Counter/Flash responses
 * and a prominent Pass button when a response window opens.
 */
import { type ReactNode, useState, useCallback } from 'react';
import type { PendingChoice } from '@aetherion-sim/engine';
import { useGameStore } from '@/stores/game-store';

interface ResponseWindowChoiceProps {
  readonly choice: PendingChoice;
}

export function ResponseWindowChoice({ choice }: ResponseWindowChoiceProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const [selected, setSelected] = useState<string | null>(null);

  const handlePass = useCallback(() => {
    dispatch({
      type: 'player_response',
      response: { selectedOptionIds: ['pass'] },
    });
  }, [dispatch]);

  const handlePlay = useCallback(() => {
    if (selected === null) return;
    dispatch({
      type: 'player_response',
      response: { selectedOptionIds: [selected] },
    });
  }, [dispatch, selected]);

  const responseCards = choice.options.filter(o => o.id !== 'pass');

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'var(--color-surface-overlay)',
      }}
    >
      <div
        className="rounded-[var(--radius-lg)] border-2 p-6 max-w-lg w-full mx-4"
        style={{
          borderColor: 'var(--color-border-strong)',
          backgroundColor: 'var(--color-surface)',
        }}
      >
        <h2 className="text-lg font-bold mb-1 font-body">
          Response Window
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4 font-body">
          {choice.context}
        </p>

        {/* Response cards */}
        {responseCards.length > 0 && (
          <div className="flex flex-col gap-2 mb-4">
            {responseCards.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSelected(option.id === selected ? null : option.id)}
                className={`
                  text-left px-3 py-2 rounded-[var(--radius-md)] border-2 text-sm font-body
                  transition-colors duration-150 cursor-pointer
                  ${selected === option.id
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'}
                `}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {selected !== null && (
            <button
              type="button"
              onClick={handlePlay}
              className="flex-1 px-4 py-2 rounded-[var(--radius-md)] font-semibold text-sm font-body bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:brightness-110 cursor-pointer transition-all duration-150"
            >
              Play Response
            </button>
          )}
          <button
            type="button"
            onClick={handlePass}
            className={`
              ${selected !== null ? 'flex-1' : 'w-full'}
              px-4 py-2 rounded-[var(--radius-md)] font-semibold text-sm font-body
              border-2 border-[var(--color-border)] text-[var(--color-text-secondary)]
              hover:border-[var(--color-border-strong)] cursor-pointer
              transition-all duration-150
            `}
          >
            Pass
          </button>
        </div>
      </div>
    </div>
  );
}

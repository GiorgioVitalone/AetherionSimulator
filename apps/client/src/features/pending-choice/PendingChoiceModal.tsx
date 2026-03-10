/**
 * PendingChoiceModal — routes to the appropriate choice UI based on pendingChoice.type.
 * The engine pauses for player input via PendingChoice; this component renders the prompt.
 */
import { type ReactNode, useState, useCallback } from 'react';
import type { PendingChoice } from '@aetherion-sim/engine';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
import { MulliganChoice } from './MulliganChoice';
import { MulliganHandoff } from './MulliganHandoff';
import { ReserveExhaustChoice } from './ReserveExhaustChoice';
import { ResponseWindowChoice } from './ResponseWindowChoice';

interface PendingChoiceModalProps {
  readonly choice: PendingChoice;
}

export function PendingChoiceModal({ choice }: PendingChoiceModalProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const players = useGameStore((s) => s.state?.players);
  const setViewingPlayer = useUiStore((s) => s.setViewingPlayer);
  const [handoffAcknowledged, setHandoffAcknowledged] = useState(false);

  // For mulligan, use choice.playerId to get the correct player's hand
  if (choice.type === 'mulligan' && players) {
    const mulliganPlayer = players[choice.playerId];

    // Hot-seat: show handoff screen before P2 mulligan so P1 doesn't see P2's cards
    if (choice.playerId === 1 && !handoffAcknowledged) {
      return (
        <MulliganHandoff
          onReady={() => {
            setViewingPlayer(1);
            setHandoffAcknowledged(true);
          }}
        />
      );
    }

    if (mulliganPlayer) {
      return <MulliganChoice choice={choice} hand={mulliganPlayer.hand} />;
    }
  }

  // Reserve exhaust choice
  if (choice.type === 'reserve_exhaust') {
    return <ReserveExhaustChoice choice={choice} />;
  }

  // Response window for Counter/Flash
  if (choice.type === 'response_window') {
    return <ResponseWindowChoice choice={choice} />;
  }

  // Generic choice modal for other types
  return (
    <GenericChoiceModal choice={choice} onSubmit={(selectedIds) => {
      dispatch({ type: 'player_response', response: { selectedOptionIds: selectedIds } });
    }} />
  );
}

// ── Generic Choice Modal ───────────────────────────────────────────────────

interface GenericChoiceModalProps {
  readonly choice: PendingChoice;
  readonly onSubmit: (selectedIds: readonly string[]) => void;
}

function GenericChoiceModal({ choice, onSubmit }: GenericChoiceModalProps): ReactNode {
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
          {CHOICE_TITLES[choice.type] ?? 'Choose'}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)] mb-4 font-body">
          {choice.context}
          {choice.minSelections > 0 && (
            <span className="text-[var(--color-text-faint)]">
              {' '}(select {choice.minSelections === choice.maxSelections
                ? choice.minSelections
                : `${choice.minSelections}-${choice.maxSelections}`})
            </span>
          )}
        </p>

        {/* Options */}
        <div className="flex flex-col gap-2 mb-4 max-h-64 overflow-y-auto">
          {choice.options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => toggleOption(option.id)}
              className={`
                text-left px-3 py-2 rounded-[var(--radius-md)] border-2 text-sm font-body
                transition-colors duration-150 cursor-pointer
                ${selected.has(option.id)
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-text)]'
                  : 'border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text-secondary)] hover:border-[var(--color-border-strong)]'}
              `}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit([...selected])}
          className={`
            w-full px-4 py-2 rounded-[var(--radius-md)] font-semibold text-sm font-body
            transition-all duration-150
            ${canSubmit
              ? 'bg-[var(--color-accent)] text-[var(--color-text-inverse)] hover:brightness-110 cursor-pointer'
              : 'bg-[var(--color-surface-alt)] text-[var(--color-text-faint)] cursor-not-allowed'}
          `}
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

const CHOICE_TITLES: Record<string, string> = {
  select_targets: 'Select Targets',
  reserve_exhaust: 'Exhaust Reserve Characters',
  discard_to_hand_limit: 'Discard to Hand Limit',
  choose_one: 'Choose One',
  choose_zone_slot: 'Choose Zone',
  choose_discard: 'Choose Cards to Discard',
  response_window: 'Response Window',
  choose_x_value: 'Choose X Value',
  choose_flexible_split: 'Choose Resource Split',
};

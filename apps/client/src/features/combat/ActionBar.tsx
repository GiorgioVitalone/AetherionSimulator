/**
 * ActionBar — contextual buttons when a card has multiple possible actions.
 * Appears at the bottom of the screen above the hand row.
 */
import type { ReactNode } from 'react';
import { useActionFlowStore } from '@/stores/action-flow-store';
import type { ActionIntent } from '@/stores/action-flow-store';

interface ActionBarProps {
  readonly onChoose: (action: ActionIntent) => void;
  readonly onCancel: () => void;
}

const ACTION_LABELS: Record<ActionIntent, string> = {
  deploy: 'Deploy',
  cast_spell: 'Cast',
  attach_equipment: 'Equip',
  move: 'Move',
  activate_ability: 'Activate',
  attack: 'Attack',
  discard_for_energy: 'Discard',
};

export function ActionBar({ onChoose, onCancel }: ActionBarProps): ReactNode {
  const flowState = useActionFlowStore((s) => s.flowState);

  if (flowState.step === 'awaiting_zone') {
    return (
      <div
        className="flex items-center justify-center gap-3 px-4 py-2 border-t"
        style={{
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border)',
        }}
      >
        <span className="text-[9px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold font-body">
          Select destination
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="
            px-3 py-1.5 rounded-[var(--radius-md)] text-[11px] font-semibold font-body
            border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]
            transition-colors duration-150 cursor-pointer
          "
        >
          Cancel
        </button>
      </div>
    );
  }

  if (flowState.step !== 'card_selected') return null;

  return (
    <div
      className="flex items-center justify-center gap-2 px-4 py-2 border-t"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border)',
      }}
    >
      <span className="text-[9px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold font-body mr-2">
        Choose action
      </span>
      {flowState.possibleActions.map((action) => (
        <button
          key={action}
          type="button"
          onClick={() => onChoose(action)}
          className="
            px-3 py-1.5 rounded-[var(--radius-md)] text-[11px] font-semibold font-body
            border-2 border-[var(--color-border-strong)] text-[var(--color-text)]
            hover:border-[var(--color-accent-muted)] hover:text-[var(--color-accent-light)]
            transition-colors duration-150 cursor-pointer
          "
          style={{ backgroundColor: 'var(--color-surface)' }}
        >
          {ACTION_LABELS[action]}
        </button>
      ))}
      <button
        type="button"
        onClick={onCancel}
        className="
          px-3 py-1.5 rounded-[var(--radius-md)] text-[11px] font-semibold font-body
          border border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]
          transition-colors duration-150 cursor-pointer
        "
      >
        Cancel
      </button>
    </div>
  );
}

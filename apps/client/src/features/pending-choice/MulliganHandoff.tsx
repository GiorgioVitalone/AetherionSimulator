/**
 * MulliganHandoff — "Pass to Player 2" screen between mulligans in hot-seat mode.
 *
 * Prevents P1 from seeing P2's cards. Shows a blocking overlay with a Ready button.
 * When clicked, the parent sets viewingPlayer=1 and reveals the MulliganChoice.
 */
import type { ReactNode } from 'react';

interface MulliganHandoffProps {
  readonly onReady: () => void;
}

export function MulliganHandoff({ onReady }: MulliganHandoffProps): ReactNode {
  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center"
      data-testid="mulligan-handoff"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'var(--color-surface-overlay)',
      }}
    >
      <h2 className="text-3xl font-black mb-3">
        Player 2&apos;s Turn to Mulligan
      </h2>
      <p className="text-sm text-[var(--color-text-secondary)] mb-8 font-body">
        Pass the screen to Player 2
      </p>
      <button
        type="button"
        onClick={onReady}
        data-testid="mulligan-handoff-ready"
        className="
          px-8 py-3 rounded-[var(--radius-md)] font-semibold text-sm font-body
          bg-[var(--color-accent)] text-[var(--color-text-inverse)]
          hover:brightness-110 transition-all duration-150 cursor-pointer
        "
      >
        Ready
      </button>
    </div>
  );
}

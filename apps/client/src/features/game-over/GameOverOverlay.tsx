/**
 * GameOverOverlay — "VICTORY" / "DEFEAT" / "DRAW" screen with game summary.
 */
import type { ReactNode } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
import { GameSummary } from './GameSummary';

export function GameOverOverlay(): ReactNode {
  const winner = useGameStore((s) => s.state?.winner ?? null);
  const log = useGameStore((s) => s.state?.log ?? []);
  const reset = useGameStore((s) => s._reset);
  const toggleGameLog = useUiStore((s) => s.toggleGameLog);
  const showGameLog = useUiStore((s) => s.showGameLog);
  const viewingPlayer = useUiStore((s) => s.viewingPlayer);

  if (winner === null) return null;

  const isDraw = winner === 'draw';
  const isWinner = winner === viewingPlayer;
  const title = isDraw ? 'DRAW' : isWinner ? 'VICTORY' : 'DEFEAT';
  const titleColor = isDraw
    ? 'var(--color-text-muted)'
    : isWinner
      ? 'var(--color-accent-light)'
      : 'var(--color-error)';

  return (
    <div
      className="fixed inset-0 flex items-center justify-center"
      style={{
        zIndex: 'var(--z-modal)',
        backgroundColor: 'var(--color-surface-overlay)',
      }}
    >
      <div className="flex flex-col items-center gap-6">
        <h1
          className="text-6xl font-black tracking-tight"
          style={{ color: titleColor }}
        >
          {title}
        </h1>

        {!isDraw && (
          <p className="text-lg text-[var(--color-text-secondary)] font-body">
            Player {(winner as number) + 1} wins
          </p>
        )}

        {/* Game summary */}
        <GameSummary log={log} />

        {/* Action buttons */}
        <div className="flex gap-4 mt-4">
          <button
            type="button"
            onClick={reset}
            className="
              px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
              bg-[var(--color-accent)] text-[var(--color-text-inverse)]
              hover:brightness-110 transition-all duration-150 cursor-pointer
            "
          >
            Play Again
          </button>
          <button
            type="button"
            onClick={toggleGameLog}
            className="
              px-6 py-2.5 rounded-[var(--radius-md)] font-semibold text-sm font-body
              border-2 border-[var(--color-border-strong)] text-[var(--color-text)]
              hover:border-[var(--color-accent-muted)] transition-all duration-150 cursor-pointer
            "
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            {showGameLog ? 'Hide Log' : 'View Log'}
          </button>
        </div>
      </div>
    </div>
  );
}

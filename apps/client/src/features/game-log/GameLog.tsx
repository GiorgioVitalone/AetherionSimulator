/**
 * GameLog — collapsible panel showing the last 15 game events.
 * Auto-scrolls to the newest event.
 */
import { type ReactNode, useRef, useEffect, useMemo } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
import { formatGameEvent } from './formatGameEvent';
import { GameLogEntry } from './GameLogEntry';

const MAX_VISIBLE_EVENTS = 15;
const HAND_ROW_OFFSET_PX = 156;

export function GameLog(): ReactNode {
  const log = useGameStore((s) => s.state?.log ?? []);
  const showGameLog = useUiStore((s) => s.showGameLog);
  const toggleGameLog = useUiStore((s) => s.toggleGameLog);
  const scrollRef = useRef<HTMLDivElement>(null);

  const recentEvents = useMemo(
    () => log.slice(-MAX_VISIBLE_EVENTS).map((e, i) => ({
      formatted: formatGameEvent(e),
      index: log.length - MAX_VISIBLE_EVENTS + i + 1,
    })),
    [log],
  );

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollRef.current && showGameLog) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [recentEvents, showGameLog]);

  return (
    <div
      className="fixed right-0 w-80"
      data-testid="game-log"
      style={{
        zIndex: 'var(--z-dropdown)',
        bottom: `${String(HAND_ROW_OFFSET_PX)}px`,
      }}
    >
      {/* Toggle button */}
      <button
        type="button"
        onClick={toggleGameLog}
        data-testid="game-log-toggle"
        className="
          w-full px-3 py-1.5 text-left text-[9px] font-semibold uppercase tracking-widest
          font-body cursor-pointer transition-colors duration-150
          hover:text-[var(--color-text)]
        "
        style={{
          backgroundColor: 'var(--color-surface)',
          borderTop: '1px solid var(--color-border)',
          borderLeft: '1px solid var(--color-border)',
          color: 'var(--color-text-muted)',
          borderRadius: 'var(--radius-md) 0 0 0',
        }}
      >
        Game Log ({log.length})
      </button>

      {/* Log panel */}
      {showGameLog && (
        <div
          ref={scrollRef}
          data-testid="game-log-panel"
          className="max-h-60 overflow-y-auto p-2 border-l"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
          }}
        >
          {recentEvents.length === 0 ? (
            <p className="text-[11px] text-[var(--color-text-faint)] font-body py-2 text-center">
              No events yet
            </p>
          ) : (
            recentEvents.map(({ formatted, index }) => (
              <GameLogEntry key={index} event={formatted} index={index} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

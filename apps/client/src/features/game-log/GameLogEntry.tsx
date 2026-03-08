/**
 * GameLogEntry — single event line in the game log with color coding.
 */
import type { ReactNode } from 'react';
import type { FormattedEvent } from './formatGameEvent';

interface GameLogEntryProps {
  readonly event: FormattedEvent;
  readonly index: number;
}

export function GameLogEntry({ event, index }: GameLogEntryProps): ReactNode {
  return (
    <div className="flex items-start gap-2 py-0.5">
      <span className="font-mono text-[9px] text-[var(--color-text-faint)] tabular-nums w-4 shrink-0 text-right">
        {index}
      </span>
      <span className="text-[11px] leading-snug font-body" style={{ color: event.color }}>
        {event.text}
      </span>
    </div>
  );
}

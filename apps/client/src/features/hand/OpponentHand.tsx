/**
 * OpponentHand — row of face-down CardBacks showing opponent's hand count.
 * Displayed within the OpponentPanel.
 */
import type { ReactNode } from 'react';
import { CardBack } from '@aetherion-sim/ui';

interface OpponentHandProps {
  readonly count: number;
}

export function OpponentHand({ count }: OpponentHandProps): ReactNode {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: Math.min(count, 8) }, (_, i) => (
        <CardBack key={i} size="sm" />
      ))}
      {count > 8 && (
        <span className="font-mono text-[10px] text-[var(--color-text-faint)]">+{count - 8}</span>
      )}
    </div>
  );
}

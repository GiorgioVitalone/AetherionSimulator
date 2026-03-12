/**
 * HandRow — scrollable horizontal row of HandCards for the viewing player.
 * Uses AnimatePresence for smooth card enter/exit animations.
 */
import type { ReactNode } from 'react';
import type { CardInstance } from '@aetherion-sim/engine';
import { AnimatePresence } from 'motion/react';
import { HandCard } from './HandCard';

interface HandRowProps {
  readonly cards: readonly CardInstance[];
  readonly onCardClick: (instanceId: string) => void;
}

export function HandRow({ cards, onCardClick }: HandRowProps): ReactNode {
  if (cards.length === 0) {
    return (
      <div
        className="h-[156px] flex items-center justify-center border-t border-[var(--color-border)] shrink-0"
        data-testid="hand-row"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <span className="text-[var(--color-text-faint)] text-sm font-body">No cards in hand</span>
      </div>
    );
  }

  return (
    <div
      className="border-t border-[var(--color-border)] px-4 py-2 overflow-x-auto shrink-0"
      data-testid="hand-row"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      <div className="flex gap-2 justify-center min-w-min">
        <AnimatePresence mode="popLayout">
          {cards.map((card) => (
            <HandCard
              key={card.instanceId}
              card={card}
              onClick={onCardClick}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

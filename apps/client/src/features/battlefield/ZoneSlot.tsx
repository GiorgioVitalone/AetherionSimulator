/**
 * ZoneSlot — a single slot within a zone row.
 * Empty slots show a dashed border; occupied slots render a BattlefieldCard.
 * Highlighted slots glow when they're valid deployment/move targets.
 * Uses AnimatePresence for card enter/exit transitions.
 */
import type { ReactNode } from 'react';
import type { CardInstance } from '@aetherion-sim/engine';
import { AnimatePresence } from 'motion/react';
import { BattlefieldCard } from './BattlefieldCard';

interface ZoneSlotProps {
  readonly card: CardInstance | null;
  readonly highlighted: boolean;
  readonly highlightLabel?: string;
  readonly onSlotClick: () => void;
  readonly onCardClick?: (instanceId: string) => void;
}

export function ZoneSlot({
  card,
  highlighted,
  highlightLabel,
  onSlotClick,
  onCardClick,
}: ZoneSlotProps): ReactNode {
  return (
    <div className="w-[80px] h-[110px] relative">
      <AnimatePresence mode="wait">
        {card ? (
          <BattlefieldCard
            key={card.instanceId}
            card={card}
            highlighted={highlighted}
            onClick={() => onCardClick?.(card.instanceId)}
          />
        ) : (
          <div
            key="empty"
            onClick={onSlotClick}
            className={`
              w-[80px] h-[110px] rounded-[var(--radius-md)]
              border-2 border-dashed flex items-center justify-center
              transition-all duration-150
              ${highlighted
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-subtle)] cursor-pointer shadow-[0_0_12px_rgba(190,148,56,0.3)]'
                : 'border-[var(--color-border-subtle)] bg-transparent'}
            `}
          >
            {highlighted && (
              <span className="text-[8px] text-[var(--color-accent)] font-semibold uppercase tracking-widest">
                {highlightLabel ?? 'Deploy'}
              </span>
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

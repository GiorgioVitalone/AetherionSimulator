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
  readonly battlefieldSide: 'player' | 'opponent';
  readonly zone: string;
  readonly slotIndex: number;
  readonly highlighted: boolean;
  readonly highlightLabel?: string;
  readonly onSlotClick: () => void;
  readonly onCardClick?: (instanceId: string) => void;
}

export function ZoneSlot({
  card,
  battlefieldSide,
  zone,
  slotIndex,
  highlighted,
  highlightLabel,
  onSlotClick,
  onCardClick,
}: ZoneSlotProps): ReactNode {
  return (
    <div
      className="w-[72px] h-[96px] relative"
      data-testid={`${battlefieldSide}-${zone}-slot-${String(slotIndex)}`}
      data-battlefield-side={battlefieldSide}
      data-zone={zone}
      data-slot-index={String(slotIndex)}
      data-occupied={card ? 'true' : 'false'}
      data-highlighted={highlighted ? 'true' : 'false'}
    >
      <AnimatePresence mode="wait">
        {card ? (
          <div
            key={card.instanceId}
            data-testid="battlefield-slot-card"
            data-card-name={card.name}
            data-card-type={card.cardType}
          >
            <BattlefieldCard
              card={card}
              highlighted={highlighted}
              onClick={() => onCardClick?.(card.instanceId)}
            />
          </div>
        ) : (
          <div
            key="empty"
            onClick={onSlotClick}
            data-testid="battlefield-empty-slot"
            className={`
              w-[72px] h-[96px] rounded-[var(--radius-md)]
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

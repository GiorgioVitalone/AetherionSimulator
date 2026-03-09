/**
 * ZoneRow — horizontal row of ZoneSlots with a zone label on the left.
 * Renders all slots for a zone (reserve=2, frontline=3, highGround=2).
 */
import type { ReactNode } from 'react';
import type { CardInstance, ZoneType } from '@aetherion-sim/engine';
import { ZoneSlot } from './ZoneSlot';

interface ZoneRowProps {
  readonly zone: ZoneType;
  readonly slots: readonly (CardInstance | null)[];
  readonly highlightedSlots: ReadonlySet<number>;
  readonly highlightLabel?: string;
  readonly onSlotClick: (zone: ZoneType, slotIndex: number) => void;
  readonly onCardClick?: (instanceId: string) => void;
}

const ZONE_LABELS: Record<ZoneType, string> = {
  reserve: 'Reserve',
  frontline: 'Frontline',
  high_ground: 'High Ground',
};

export function ZoneRow({
  zone,
  slots,
  highlightedSlots,
  highlightLabel,
  onSlotClick,
  onCardClick,
}: ZoneRowProps): ReactNode {
  return (
    <div className="flex items-center gap-2">
      {/* Zone label */}
      <span className="w-16 text-[8px] uppercase tracking-widest font-semibold text-[var(--color-text-faint)] text-right font-body shrink-0">
        {ZONE_LABELS[zone]}
      </span>

      {/* Slots */}
      <div className="flex gap-2">
        {slots.map((card, index) => (
          <ZoneSlot
            key={`${zone}-${index}`}
            card={card}
            highlighted={highlightedSlots.has(index)}
            highlightLabel={highlightLabel}
            onSlotClick={() => onSlotClick(zone, index)}
            onCardClick={onCardClick}
          />
        ))}
      </div>
    </div>
  );
}

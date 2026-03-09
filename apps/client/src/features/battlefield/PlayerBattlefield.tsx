/**
 * PlayerBattlefield — three ZoneRows stacked vertically.
 * For the viewing player: High Ground (top, near divider) → Frontline → Reserve (bottom).
 * For the opponent: Reserve (top) → Frontline → High Ground (bottom, near divider).
 */
import type { ReactNode } from 'react';
import type { ZoneState, ZoneType } from '@aetherion-sim/engine';
import { ZoneRow } from './ZoneRow';

interface PlayerBattlefieldProps {
  readonly zones: ZoneState;
  readonly isOpponent: boolean;
  readonly highlightedSlots: Map<ZoneType, ReadonlySet<number>>;
  readonly highlightLabel?: string;
  readonly onSlotClick: (zone: ZoneType, slotIndex: number) => void;
  readonly onCardClick?: (instanceId: string) => void;
}

export function PlayerBattlefield({
  zones,
  isOpponent,
  highlightedSlots,
  highlightLabel,
  onSlotClick,
  onCardClick,
}: PlayerBattlefieldProps): ReactNode {
  // Order: opponent shows reserve→frontline→HG (top→bottom, HG near divider)
  //        player shows HG→frontline→reserve (top→bottom, HG near divider)
  const zoneOrder: { zone: ZoneType; slots: readonly (import('@aetherion-sim/engine').CardInstance | null)[] }[] = isOpponent
    ? [
        { zone: 'reserve', slots: zones.reserve },
        { zone: 'frontline', slots: zones.frontline },
        { zone: 'high_ground', slots: zones.highGround },
      ]
    : [
        { zone: 'high_ground', slots: zones.highGround },
        { zone: 'frontline', slots: zones.frontline },
        { zone: 'reserve', slots: zones.reserve },
      ];

  return (
    <div className="flex flex-col gap-2 items-center py-2">
      {zoneOrder.map(({ zone, slots }) => (
        <ZoneRow
          key={zone}
          zone={zone}
          slots={slots}
          highlightedSlots={highlightedSlots.get(zone) ?? new Set()}
          highlightLabel={highlightLabel}
          onSlotClick={onSlotClick}
          onCardClick={onCardClick}
        />
      ))}
    </div>
  );
}

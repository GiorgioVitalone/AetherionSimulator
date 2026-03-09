/**
 * BattlefieldArea — combines opponent's battlefield, divider, and player's battlefield.
 * Highlighted slots are computed from the action flow store for both zone selection
 * (deployment/movement) and target selection (attacks/spells).
 */
import { type ReactNode, useMemo } from 'react';
import type { ZoneType, CardInstance } from '@aetherion-sim/engine';
import { useViewingPlayer } from '@/hooks/useViewingPlayer';
import { useActionFlowStore } from '@/stores/action-flow-store';
import { PlayerBattlefield } from './PlayerBattlefield';
import { Divider } from './Divider';

interface BattlefieldAreaProps {
  readonly onSlotClick: (zone: ZoneType, slotIndex: number) => void;
  readonly onCardClick: (instanceId: string) => void;
}

export function BattlefieldArea({ onSlotClick, onCardClick }: BattlefieldAreaProps): ReactNode {
  const { myState, opponentState } = useViewingPlayer();
  const flowState = useActionFlowStore((s) => s.flowState);
  const zoneHighlightLabel = flowState.step === 'awaiting_zone'
    ? (flowState.actionType === 'move' ? 'Move' : 'Deploy')
    : undefined;

  // Compute highlighted slots from zone-based action flow (deploy/move)
  const zoneHighlights = useMemo(() => {
    const map = new Map<ZoneType, ReadonlySet<number>>();
    if (flowState.step === 'awaiting_zone') {
      for (const slot of flowState.validSlots) {
        const existing = map.get(slot.zone);
        if (existing) {
          const newSet = new Set(existing);
          newSet.add(slot.slotIndex);
          map.set(slot.zone, newSet);
        } else {
          map.set(slot.zone, new Set([slot.slotIndex]));
        }
      }
    }
    return map;
  }, [flowState]);

  // Compute target highlights for cards on the player's battlefield
  const playerTargetHighlights = useMemo(() => {
    if (flowState.step !== 'awaiting_target' || !myState) {
      return new Map<ZoneType, ReadonlySet<number>>();
    }
    return computeTargetHighlights(flowState.validTargets, myState.zones);
  }, [flowState, myState]);

  // Compute target highlights for cards on the opponent's battlefield
  const opponentTargetHighlights = useMemo(() => {
    if (flowState.step !== 'awaiting_target' || !opponentState) {
      return new Map<ZoneType, ReadonlySet<number>>();
    }
    return computeTargetHighlights(flowState.validTargets, opponentState.zones);
  }, [flowState, opponentState]);

  // Merge zone highlights (deploy/move) with target highlights for the player
  const mergedPlayerHighlights = useMemo(() => {
    const merged = new Map(zoneHighlights);
    for (const [zone, indices] of playerTargetHighlights) {
      const existing = merged.get(zone);
      if (existing) {
        merged.set(zone, new Set([...existing, ...indices]));
      } else {
        merged.set(zone, indices);
      }
    }
    return merged;
  }, [zoneHighlights, playerTargetHighlights]);

  if (!myState || !opponentState) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-center">
      {/* Opponent battlefield (mirrored order) */}
      <PlayerBattlefield
        zones={opponentState.zones}
        isOpponent
        highlightedSlots={opponentTargetHighlights}
        highlightLabel={zoneHighlightLabel}
        onSlotClick={onSlotClick}
        onCardClick={onCardClick}
      />

      <Divider />

      {/* Player battlefield */}
      <PlayerBattlefield
        zones={myState.zones}
        isOpponent={false}
        highlightedSlots={mergedPlayerHighlights}
        highlightLabel={zoneHighlightLabel}
        onSlotClick={onSlotClick}
        onCardClick={onCardClick}
      />
    </div>
  );
}

/** Find slot indices where valid target cards are located. */
function computeTargetHighlights(
  validTargets: readonly string[],
  zones: { readonly reserve: readonly (CardInstance | null)[]; readonly frontline: readonly (CardInstance | null)[]; readonly highGround: readonly (CardInstance | null)[] },
): Map<ZoneType, ReadonlySet<number>> {
  const map = new Map<ZoneType, ReadonlySet<number>>();
  const validSet = new Set(validTargets);
  const zoneEntries: [ZoneType, readonly (CardInstance | null)[]][] = [
    ['reserve', zones.reserve],
    ['frontline', zones.frontline],
    ['high_ground', zones.highGround],
  ];
  for (const [zone, slots] of zoneEntries) {
    const indices = new Set<number>();
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] && validSet.has(slots[i]!.instanceId)) indices.add(i);
    }
    if (indices.size > 0) map.set(zone, indices);
  }
  return map;
}

/**
 * BattlefieldArea — combines opponent's battlefield, divider, and player's battlefield.
 * Highlighted slots are computed from the action flow store.
 */
import { type ReactNode, useMemo } from 'react';
import type { ZoneType } from '@aetherion-sim/engine';
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

  // Compute highlighted slots from action flow
  const playerHighlights = useMemo(() => {
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

  const emptyHighlights = useMemo(() => new Map<ZoneType, ReadonlySet<number>>(), []);

  if (!myState || !opponentState) return null;

  return (
    <div className="flex-1 flex flex-col justify-center">
      {/* Opponent battlefield (mirrored order) */}
      <PlayerBattlefield
        zones={opponentState.zones}
        isOpponent
        highlightedSlots={emptyHighlights}
        onSlotClick={onSlotClick}
        onCardClick={onCardClick}
      />

      <Divider />

      {/* Player battlefield */}
      <PlayerBattlefield
        zones={myState.zones}
        isOpponent={false}
        highlightedSlots={playerHighlights}
        onSlotClick={onSlotClick}
        onCardClick={onCardClick}
      />
    </div>
  );
}

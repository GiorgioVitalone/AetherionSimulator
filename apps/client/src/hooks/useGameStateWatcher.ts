/**
 * useGameStateWatcher — diffs game log entries and maps new GameEvents to AnimationEvents.
 *
 * On each state update, compares the log length to the previous snapshot.
 * New entries are mapped to animation events and enqueued to the UI store.
 */
import { useEffect, useRef } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore, type AnimationEvent } from '@/stores/ui-store';
import type { GameEvent } from '@aetherion-sim/engine';

let animationIdCounter = 0;

function mapGameEventToAnimation(event: GameEvent): AnimationEvent | null {
  switch (event.type) {
    case 'CARD_DEPLOYED':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'deploy',
        targetId: event.cardInstanceId,
      };
    case 'CHARACTER_ATTACKED':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'attack',
        sourceId: event.attackerId,
        targetId: event.targetId,
      };
    case 'DAMAGE_DEALT':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'damage',
        sourceId: event.sourceId,
        targetId: event.targetId,
        value: event.amount,
      };
    case 'HERO_DAMAGED':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'damage',
        targetId: `hero-${event.playerId}`,
        value: event.amount,
      };
    case 'HERO_HEALED':
    case 'CHARACTER_HEALED':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'heal',
        targetId: event.type === 'HERO_HEALED' ? `hero-${event.playerId}` : event.cardInstanceId,
        value: event.amount,
      };
    case 'CARD_DESTROYED':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'destroy',
        targetId: event.cardInstanceId,
      };
    case 'CARD_MOVED':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'move',
        targetId: event.cardInstanceId,
      };
    case 'SPELL_CAST':
      return {
        id: `anim-${++animationIdCounter}`,
        type: 'spell',
        targetId: event.cardInstanceId,
      };
    default:
      return null;
  }
}

export function useGameStateWatcher(): void {
  const log = useGameStore((s) => s.state?.log);
  const enqueueAnimation = useUiStore((s) => s.enqueueAnimation);
  const prevLengthRef = useRef(0);

  useEffect(() => {
    if (!log) {
      prevLengthRef.current = 0;
      return;
    }

    const prevLength = prevLengthRef.current;
    prevLengthRef.current = log.length;

    // Process only new entries
    if (log.length <= prevLength) return;

    for (let i = prevLength; i < log.length; i++) {
      const event = log[i];
      if (!event) continue;
      const animation = mapGameEventToAnimation(event);
      if (animation) {
        enqueueAnimation(animation);
      }
    }
  }, [log, enqueueAnimation]);
}

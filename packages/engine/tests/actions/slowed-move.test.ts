import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import type { ActiveStatus, CardInstance } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

const SLOWED: ActiveStatus = { statusType: 'slowed', value: 1, remainingTurns: 2 };

function zoneOf(state: ReturnType<typeof mockGameState>, id: string): string | null {
  const z = state.players[0].zones;
  if (z.reserve.some(c => c?.instanceId === id)) return 'reserve';
  if (z.frontline.some(c => c?.instanceId === id)) return 'frontline';
  if (z.highGround.some(c => c?.instanceId === id)) return 'high_ground';
  return null;
}

function stateWith(card: CardInstance) {
  return mockGameState({
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ frontline: [card] }) }),
      mockPlayerState(1),
    ],
    activePlayerIndex: 0,
    phase: 'strategy',
  });
}

describe('Slowed — movement is blocked', () => {
  beforeEach(resetInstanceCounter);

  it('a Slowed character cannot move (stays in its zone, no event)', () => {
    const slowed = mockCard({ exhausted: false, statusEffects: [SLOWED] });
    const result = executePlayerAction(stateWith(slowed), {
      type: 'move',
      cardInstanceId: slowed.instanceId,
      toZone: 'high_ground',
    });
    expect(result.events).toEqual([]);
    expect(zoneOf(result.state, slowed.instanceId)).toBe('frontline');
  });

  it('a non-Slowed character moves normally', () => {
    const free = mockCard({ exhausted: false });
    const result = executePlayerAction(stateWith(free), {
      type: 'move',
      cardInstanceId: free.instanceId,
      toZone: 'high_ground',
    });
    expect(zoneOf(result.state, free.instanceId)).toBe('high_ground');
  });
});

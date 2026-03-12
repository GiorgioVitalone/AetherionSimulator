import { describe, it, expect, beforeEach } from 'vitest';
import { processStatusTicks } from '../../src/state-machine/status-processing.js';
import type { GameState } from '../../src/types/game-state.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

describe('processStatusTicks', () => {
  it('should destroy a character with persistent damage exceeding HP', () => {
    const card = mockCard({
      currentHp: 2,
      baseHp: 3,
      owner: 0,
      statusEffects: [{ statusType: 'persistent', value: 3, remainingTurns: null }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = processStatusTicks(state);

    const destroyed = result.events.filter(e => e.type === 'CARD_DESTROYED');
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({
      cardInstanceId: card.instanceId,
      cause: 'effect',
    });
  });

  it('should heal with regeneration up to baseHp', () => {
    const card = mockCard({
      currentHp: 1,
      baseHp: 5,
      owner: 0,
      statusEffects: [{ statusType: 'regeneration', value: 3, remainingTurns: 2 }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = processStatusTicks(state);

    // Should heal 3 but not exceed baseHp
    const healEvents = result.events.filter(e => e.type === 'CHARACTER_HEALED');
    expect(healEvents).toHaveLength(1);
    expect(healEvents[0]).toMatchObject({ amount: 3 }); // Was only at -2 from cap, can get 3 before cap (1+3=4 < 5)

    // Card should NOT be destroyed
    const destroyed = result.events.filter(e => e.type === 'CARD_DESTROYED');
    expect(destroyed).toHaveLength(0);
  });

  it('should decrement remainingTurns and remove expired statuses', () => {
    const card = mockCard({
      currentHp: 5,
      baseHp: 5,
      owner: 0,
      statusEffects: [{ statusType: 'slowed', value: 1, remainingTurns: 1 }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = processStatusTicks(state);

    // Check the card no longer has the status
    const p0 = result.state.players[0]!;
    const updatedCard = p0.zones.frontline[0];
    expect(updatedCard).not.toBeNull();
    expect(updatedCard!.statusEffects).toHaveLength(0);
  });

  it('should not remove statuses with null remainingTurns (permanent)', () => {
    const card = mockCard({
      currentHp: 5,
      baseHp: 5,
      owner: 0,
      statusEffects: [{ statusType: 'hexproof', value: 1, remainingTurns: null }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = processStatusTicks(state);

    const updatedCard = result.state.players[0]!.zones.frontline[0];
    expect(updatedCard!.statusEffects).toHaveLength(1);
  });
});

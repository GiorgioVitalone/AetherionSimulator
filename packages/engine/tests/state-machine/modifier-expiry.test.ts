import { describe, it, expect, beforeEach } from 'vitest';
import { expireEndOfTurnModifiers } from '../../src/state-machine/modifier-expiry.js';
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

describe('expireEndOfTurnModifiers', () => {
  it('should remove until_end_of_turn modifiers', () => {
    const card = mockCard({
      currentHp: 5,
      baseHp: 3,
      currentAtk: 4,
      baseAtk: 2,
      owner: 0,
      modifiers: [{
        id: 'mod_1',
        sourceInstanceId: 'src_1',
        modifier: { atk: 2, hp: 2 },
        duration: { type: 'until_end_of_turn' },
      }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = expireEndOfTurnModifiers(state);

    const updatedCard = result.state.players[0]!.zones.frontline[0]!;
    expect(updatedCard.modifiers).toHaveLength(0);
    expect(updatedCard.currentAtk).toBe(2); // 4 - 2
    expect(updatedCard.currentHp).toBe(3); // 5 - 2
  });

  it('should destroy a card when HP-granting modifier expires and HP drops to 0', () => {
    const card = mockCard({
      currentHp: 1,
      baseHp: 1,
      owner: 0,
      modifiers: [{
        id: 'mod_1',
        sourceInstanceId: 'src_1',
        modifier: { hp: 3 },
        duration: { type: 'until_end_of_turn' },
      }],
    });
    // currentHp is 1, but the modifier was granting +3 HP
    // When it expires: currentHp = 1 - 3 = 0 → destroyed

    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = expireEndOfTurnModifiers(state);

    const destroyed = result.events.filter(e => e.type === 'CARD_DESTROYED');
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0]).toMatchObject({
      cardInstanceId: card.instanceId,
      cause: 'effect',
    });
  });

  it('should remove until_end_of_turn granted traits', () => {
    const card = mockCard({
      currentHp: 3,
      baseHp: 3,
      owner: 0,
      grantedTraits: [{
        trait: 'haste',
        sourceInstanceId: 'src_1',
        duration: { type: 'until_end_of_turn' },
      }],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = expireEndOfTurnModifiers(state);

    const updatedCard = result.state.players[0]!.zones.frontline[0]!;
    expect(updatedCard.grantedTraits).toHaveLength(0);
  });

  it('should keep permanent modifiers', () => {
    const card = mockCard({
      currentHp: 5,
      baseHp: 3,
      owner: 0,
      modifiers: [
        {
          id: 'mod_perm',
          sourceInstanceId: 'src_1',
          modifier: { hp: 2 },
          duration: { type: 'permanent' },
        },
        {
          id: 'mod_temp',
          sourceInstanceId: 'src_2',
          modifier: { atk: 1 },
          duration: { type: 'until_end_of_turn' },
        },
      ],
    });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = expireEndOfTurnModifiers(state);

    const updatedCard = result.state.players[0]!.zones.frontline[0]!;
    expect(updatedCard.modifiers).toHaveLength(1);
    expect(updatedCard.modifiers[0]!.id).toBe('mod_perm');
  });
});

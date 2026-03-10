import { describe, it, expect, beforeEach } from 'vitest';
import { executeExile } from '../../src/effects/exile.js';
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

describe('executeExile', () => {
  it('should exile a non-token to exileZone, not discardPile', () => {
    const card = mockCard({ owner: 0, isToken: false });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executeExile(state, card.instanceId);

    // Card should be in exileZone
    expect(result.state.players[0]!.exileZone).toHaveLength(1);
    expect(result.state.players[0]!.exileZone[0]!.instanceId).toBe(card.instanceId);

    // Card should NOT be in discardPile
    expect(result.state.players[0]!.discardPile).toHaveLength(0);

    // Card should NOT be on battlefield
    const frontline = result.state.players[0]!.zones.frontline;
    expect(frontline.every(s => s === null)).toBe(true);
  });

  it('should remove tokens from game entirely (not in exileZone)', () => {
    const token = mockCard({ owner: 0, isToken: true });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [token, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executeExile(state, token.instanceId);

    expect(result.state.players[0]!.exileZone).toHaveLength(0);
    expect(result.state.players[0]!.discardPile).toHaveLength(0);
  });

  it('should emit CARD_EXILED but NOT CARD_DESTROYED', () => {
    const card = mockCard({ owner: 0 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executeExile(state, card.instanceId);

    expect(result.events.some(e => e.type === 'CARD_EXILED')).toBe(true);
    expect(result.events.some(e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === card.instanceId)).toBe(false);
  });

  it('should emit CARD_LEFT_BATTLEFIELD', () => {
    const card = mockCard({ owner: 0 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executeExile(state, card.instanceId);

    const leftEvent = result.events.find(e => e.type === 'CARD_LEFT_BATTLEFIELD');
    expect(leftEvent).toBeDefined();
    expect(leftEvent).toMatchObject({
      cardInstanceId: card.instanceId,
      destination: 'exile',
      playerId: 0,
    });
  });

  it('should detach equipment and send it to discard', () => {
    const equipment = mockCard({ cardType: 'E', name: 'Test Sword', owner: 0 });
    const card = mockCard({ owner: 0, equipment });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executeExile(state, card.instanceId);

    // Equipment should be in discard
    expect(result.state.players[0]!.discardPile).toHaveLength(1);
    expect(result.state.players[0]!.discardPile[0]!.instanceId).toBe(equipment.instanceId);

    // Exiled card should have no equipment
    expect(result.state.players[0]!.exileZone[0]!.equipment).toBeNull();
  });
});

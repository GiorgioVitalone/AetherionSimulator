import { describe, expect, it } from 'vitest';
import { attemptDraw } from '../../src/effects/draw-service.js';
import { executeEffect } from '../../src/effects/interpreter.js';
import { drawMainDeckCard } from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
} from '../helpers/card-factory.js';

const currentConfig = {
  terminationMode: 'turn_cap' as const,
  effectDrawDeckout: true,
};

describe('central Main Deck draw service', () => {
  it('draws the available card, then loses at the first impossible attempt', () => {
    const last = mockCard({ instanceId: 'last' });
    const state = mockGameState({
      config: currentConfig,
      players: [
        mockPlayerState(0, { hand: [], mainDeck: [last] }),
        mockPlayerState(1),
      ],
    });

    const result = attemptDraw(state, 0, 3, 'effect');
    expect(result.drawnCount).toBe(1);
    expect(result.failedAttempt).toBe(2);
    expect(result.state.players[0].hand.map((card) => card.instanceId)).toEqual(['last']);
    expect(result.state.winner).toBe(1);
    expect(result.events).toEqual([
      { type: 'CARD_DRAWN', playerId: 0, count: 1 },
      {
        type: 'GAME_ENDED',
        winnerPlayerId: 1,
        losingPlayerId: 0,
        reason: 'deck_exhaustion',
      },
    ]);
  });

  it('uses the service for Upkeep and loses on an empty Main Deck', () => {
    const state = mockGameState({
      activePlayerIndex: 0,
      players: [
        mockPlayerState(0, { mainDeck: [] }),
        mockPlayerState(1),
      ],
    });
    const result = drawMainDeckCard(state);
    expect(result.deckEmpty).toBe(true);
    expect(result.state.winner).toBe(1);
  });

  it('uses the service through scheduled/effect execution semantics', () => {
    const state = mockGameState({
      config: currentConfig,
      players: [
        mockPlayerState(0, { mainDeck: [] }),
        mockPlayerState(1),
      ],
    });
    const result = executeEffect(
      state,
      {
        type: 'draw_cards',
        player: 'allied',
        count: { type: 'fixed', value: 1 },
      },
      { sourceInstanceId: 'scheduled-source', controllerId: 0, triggerDepth: 0 },
    );
    expect(result.newState.winner).toBe(1);
  });

  it('retains capped legacy effect draws without changing the central algorithm', () => {
    const state = mockGameState({
      players: [
        mockPlayerState(0, { mainDeck: [] }),
        mockPlayerState(1),
      ],
    });
    const result = attemptDraw(state, 0, 2, 'recycle');
    expect(result.failedAttempt).toBe(1);
    expect(result.state.winner).toBeNull();
  });
});

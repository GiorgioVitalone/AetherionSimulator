import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, GameState } from '../../src/types/game-state.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

let state: GameState;
let context: EffectContext;
let targetCard: ReturnType<typeof mockCard>;

beforeEach(() => {
  resetInstanceCounter();
  targetCard = mockCard({ currentHp: 2, baseHp: 3, currentAtk: 1, baseAtk: 1, owner: 1 });
  state = mockGameState({
    players: [
      mockPlayerState(0),
      mockPlayerState(1, {
        zones: zonesWithCards({ frontline: [targetCard, null, null] }),
      }),
    ],
  });
  context = { sourceInstanceId: 'source_1', controllerId: 0, triggerDepth: 0 };
});

describe('stat-reduction destruction', () => {
  it('should destroy a character when -HP reduces to 0', () => {
    const effect: Effect = {
      type: 'modify_stats',
      modifier: { atk: -2, hp: -2 },
      target: { type: 'target_character', side: 'enemy' },
      duration: { type: 'permanent' },
    };

    const result = executeEffect(state, effect, {
      ...context,
      selectedTargets: [targetCard.instanceId],
    });

    const destroyedEvents = result.events.filter(e => e.type === 'CARD_DESTROYED');
    expect(destroyedEvents).toHaveLength(1);
    expect(destroyedEvents[0]).toMatchObject({
      type: 'CARD_DESTROYED',
      cardInstanceId: targetCard.instanceId,
      cause: 'effect',
    });
  });

  it('should destroy a 1/1 when applying -1/-1 and emit cause effect', () => {
    resetInstanceCounter();
    const weakCard = mockCard({ currentHp: 1, baseHp: 1, currentAtk: 1, baseAtk: 1, owner: 1 });
    const localState = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [weakCard, null, null] }),
        }),
      ],
    });

    const effect: Effect = {
      type: 'modify_stats',
      modifier: { atk: -1, hp: -1 },
      target: { type: 'target_character', side: 'enemy' },
      duration: { type: 'permanent' },
    };

    const result = executeEffect(localState, effect, {
      ...context,
      selectedTargets: [weakCard.instanceId],
    });

    const destroyedEvent = result.events.find(e => e.type === 'CARD_DESTROYED');
    expect(destroyedEvent).toBeDefined();
    expect(destroyedEvent).toMatchObject({ cause: 'effect' });
  });

  it('should NOT destroy when HP remains above 0', () => {
    resetInstanceCounter();
    const toughCard = mockCard({ currentHp: 3, baseHp: 3, currentAtk: 1, baseAtk: 1, owner: 1 });
    const localState = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [toughCard, null, null] }),
        }),
      ],
    });

    const effect: Effect = {
      type: 'modify_stats',
      modifier: { atk: -1, hp: -1 },
      target: { type: 'target_character', side: 'enemy' },
      duration: { type: 'permanent' },
    };

    const result = executeEffect(localState, effect, {
      ...context,
      selectedTargets: [toughCard.instanceId],
    });

    expect(result.events.filter(e => e.type === 'CARD_DESTROYED')).toHaveLength(0);
  });

  it('should clamp HP to 0, never negative', () => {
    const effect: Effect = {
      type: 'modify_stats',
      modifier: { hp: -10 },
      target: { type: 'target_character', side: 'enemy' },
      duration: { type: 'permanent' },
    };

    const result = executeEffect(state, effect, {
      ...context,
      selectedTargets: [targetCard.instanceId],
    });

    // The card should be destroyed (removed from battlefield)
    const destroyedEvents = result.events.filter(e => e.type === 'CARD_DESTROYED');
    expect(destroyedEvents).toHaveLength(1);
  });
});

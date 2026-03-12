import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import type { EffectContext, GameState } from '../../src/types/game-state.js';
import type { TargetExpr } from '../../src/types/targets.js';
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

describe('resolveTargets selectedTargets override', () => {
  it('should use selectedTargets for target_character', () => {
    const card1 = mockCard({ owner: 0 });
    const card2 = mockCard({ owner: 1 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card1, null, null] }),
        }),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [card2, null, null] }),
        }),
      ],
    });

    const context: EffectContext = {
      sourceInstanceId: card1.instanceId,
      controllerId: 0,
      triggerDepth: 0,
      selectedTargets: [card2.instanceId],
    };

    const target: TargetExpr = { type: 'target_character', side: 'enemy' };
    const result = resolveTargets(state, target, context);

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.targetIds).toEqual([card2.instanceId]);
    }
  });

  it('should resolve self to sourceInstanceId even when selectedTargets is set', () => {
    const card1 = mockCard({ owner: 0 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card1, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const context: EffectContext = {
      sourceInstanceId: card1.instanceId,
      controllerId: 0,
      triggerDepth: 0,
      selectedTargets: ['some_other_target'],
    };

    const target: TargetExpr = { type: 'self' };
    const result = resolveTargets(state, target, context);

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.targetIds).toEqual([card1.instanceId]);
    }
  });

  it('should resolve owner_hero to controller hero even when selectedTargets is set', () => {
    const card1 = mockCard({ owner: 0 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card1, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const context: EffectContext = {
      sourceInstanceId: card1.instanceId,
      controllerId: 0,
      triggerDepth: 0,
      selectedTargets: ['some_other_target'],
    };

    const target: TargetExpr = { type: 'owner_hero' };
    const result = resolveTargets(state, target, context);

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.targetIds).toEqual(['hero_0']);
    }
  });

  it('should resolve all_characters to all cards even when selectedTargets is set', () => {
    const card1 = mockCard({ owner: 0 });
    const card2 = mockCard({ owner: 1 });
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [card1, null, null] }),
        }),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [card2, null, null] }),
        }),
      ],
    });

    const context: EffectContext = {
      sourceInstanceId: card1.instanceId,
      controllerId: 0,
      triggerDepth: 0,
      selectedTargets: ['some_other_target'],
    };

    const target: TargetExpr = { type: 'all_characters', side: 'any' };
    const result = resolveTargets(state, target, context);

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.targetIds).toContain(card1.instanceId);
      expect(result.targetIds).toContain(card2.instanceId);
    }
  });
});

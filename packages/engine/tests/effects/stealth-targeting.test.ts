import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import type { TargetExpr } from '../../src/types/targets.js';
import type { EffectContext } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

const ALL_ENEMY: TargetExpr = { type: 'all_characters', side: 'enemy' };

function ctx(controllerId: 0 | 1): EffectContext {
  return { sourceInstanceId: 'src', controllerId, triggerDepth: 0 };
}

describe('Stealth — untargetable by opponent until it acts (Rulebook 16)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('excludes an enemy Stealth character that has not yet acted', () => {
    const stealthEnemy = mockCard({ owner: 1, traits: ['stealth'] });
    const plainEnemy = mockCard({ owner: 1 });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [stealthEnemy, plainEnemy, null] }),
        }),
      ],
    });

    const resolved = resolveTargets(state, ALL_ENEMY, ctx(0));
    expect(resolved.resolved).toBe(true);
    if (!resolved.resolved) return;
    expect(resolved.targetIds).toEqual([plainEnemy.instanceId]);
  });

  it('includes an enemy Stealth character once it has acted (hasActed = true)', () => {
    const actedStealth = mockCard({ owner: 1, traits: ['stealth'], hasActed: true });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [actedStealth, null, null] }),
        }),
      ],
    });

    const resolved = resolveTargets(state, ALL_ENEMY, ctx(0));
    expect(resolved.resolved).toBe(true);
    if (!resolved.resolved) return;
    expect(resolved.targetIds).toEqual([actedStealth.instanceId]);
  });

  it('a controller can still target their OWN un-acted Stealth character (allied buffs)', () => {
    const myStealth = mockCard({ owner: 0, traits: ['stealth'] });
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [myStealth, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const allied: TargetExpr = { type: 'all_characters', side: 'allied' };
    const resolved = resolveTargets(state, allied, ctx(0));
    expect(resolved.resolved).toBe(true);
    if (!resolved.resolved) return;
    expect(resolved.targetIds).toEqual([myStealth.instanceId]);
  });
});

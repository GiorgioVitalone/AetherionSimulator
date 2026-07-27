import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import type { TargetExpr } from '../../src/types/targets.js';
import type { EffectContext, ActiveStatus } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: 'SRC', controllerId, triggerDepth: 0 };
}

const HEXPROOF: ActiveStatus = { statusType: 'hexproof', value: 1, remainingTurns: null };

describe('hexproof — opponent targeting exclusion', () => {
  beforeEach(resetInstanceCounter);

  it('excludes an enemy hexproof character from target_character', () => {
    const protectedCard = mockCard({ name: 'Warded', owner: 1, statusEffects: [HEXPROOF] });
    const plain = mockCard({ name: 'Plain', owner: 1 });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { zones: zonesWithCards({ frontline: [protectedCard, plain] }) }),
      ],
    });
    const target: TargetExpr = { type: 'target_character', side: 'enemy' };
    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(false);
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.options.map(o => o.id)).toEqual([plain.instanceId]);
  });

  it('still lets the controller target their OWN hexproof character', () => {
    const ownProtected = mockCard({ name: 'MyWarded', owner: 0, statusEffects: [HEXPROOF] });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [ownProtected] }) }),
        mockPlayerState(1),
      ],
    });
    const target: TargetExpr = { type: 'target_character', side: 'allied' };
    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(false);
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.options.map(o => o.id)).toEqual([ownProtected.instanceId]);
  });

  it('excludes enemy hexproof from all_characters (any side)', () => {
    const enemyWarded = mockCard({ name: 'EnemyWarded', owner: 1, statusEffects: [HEXPROOF] });
    const myWarded = mockCard({ name: 'MyWarded', owner: 0, statusEffects: [HEXPROOF] });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [myWarded] }) }),
        mockPlayerState(1, { zones: zonesWithCards({ frontline: [enemyWarded] }) }),
      ],
    });
    const target: TargetExpr = { type: 'all_characters', side: 'any' };
    const result = resolveTargets(state, target, ctx(0));
    if (!result.resolved) throw new Error('expected resolved');
    expect(result.targetIds).toEqual([myWarded.instanceId]);
  });

  it('excludes enemy hexproof from all_characters_in_zone', () => {
    const enemyWarded = mockCard({ name: 'EnemyWarded', owner: 1, statusEffects: [HEXPROOF] });
    const enemyPlain = mockCard({ name: 'EnemyPlain', owner: 1 });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { zones: zonesWithCards({ frontline: [enemyWarded, enemyPlain] }) }),
      ],
    });
    const target: TargetExpr = { type: 'all_characters_in_zone', side: 'enemy', zone: 'frontline' };
    const result = resolveTargets(state, target, ctx(0));
    if (!result.resolved) throw new Error('expected resolved');
    expect(result.targetIds).toEqual([enemyPlain.instanceId]);
  });

  it('includes Hexproof in All effects under current rules', () => {
    const hexproof = mockCard({
      instanceId: 'hexproof',
      owner: 1,
      statusEffects: [{ statusType: 'hexproof', value: 1, remainingTurns: null }],
    });
    const ordinary = mockCard({ instanceId: 'ordinary', owner: 1 });
    const state = mockGameState({
      config: {
        terminationMode: 'resource_deck_empty_transform',
        simultaneousAllEffects: true,
      },
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [hexproof, ordinary, null] }),
        }),
      ],
    });
    const result = resolveTargets(
      state,
      { type: 'all_characters', side: 'enemy' },
      { sourceInstanceId: 'src', controllerId: 0, triggerDepth: 0 },
    );
    expect(result).toEqual({
      resolved: true,
      targetIds: ['hexproof', 'ordinary'],
    });
  });
});

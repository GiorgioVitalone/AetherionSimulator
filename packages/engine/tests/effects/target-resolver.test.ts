import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import type { TargetExpr } from '../../src/types/targets.js';
import type { EffectContext } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: 'SRC', controllerId, triggerDepth: 0 };
}

describe('resolveTargets — target_card_in_discard', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('returns a pendingChoice listing matching cards from the controller discard pile', () => {
    const match = mockCard({ name: 'CheapChar', cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 } });
    const tooExpensive = mockCard({ name: 'PriceyChar', cardType: 'C', cost: { mana: 5, energy: 0, flexible: 0 } });
    const wrongType = mockCard({ name: 'CheapSpell', cardType: 'S', cost: { mana: 1, energy: 0, flexible: 0 } });

    const state = mockGameState({
      players: [
        mockPlayerState(0, { discardPile: [match, tooExpensive, wrongType] }),
        mockPlayerState(1),
      ],
    });

    const target: TargetExpr = {
      type: 'target_card_in_discard',
      side: 'allied',
      filter: { maxCost: 3, cardType: 'C' },
    };

    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(false);
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.type).toBe('select_targets');
    expect(result.pendingChoice.options.map(o => o.id)).toEqual([match.instanceId]);
  });

  it('reads the enemy discard pile when side is enemy', () => {
    const enemyCard = mockCard({ name: 'EnemyDiscard', cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 } });
    const state = mockGameState({
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { discardPile: [enemyCard] }),
      ],
    });

    const target: TargetExpr = { type: 'target_card_in_discard', side: 'enemy' };
    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(false);
    if (result.resolved) throw new Error('expected pendingChoice');
    expect(result.pendingChoice.options.map(o => o.id)).toEqual([enemyCard.instanceId]);
  });

  it('resolves to empty (no choice) when the discard pile has no match', () => {
    const state = mockGameState({
      players: [mockPlayerState(0, { discardPile: [] }), mockPlayerState(1)],
    });
    const target: TargetExpr = { type: 'target_card_in_discard', side: 'allied' };
    const result = resolveTargets(state, target, ctx(0));
    expect(result.resolved).toBe(true);
    if (!result.resolved) throw new Error('expected resolved');
    expect(result.targetIds).toEqual([]);
  });

  it('is deterministic — repeated calls yield identical option ids', () => {
    const a = mockCard({ name: 'A', cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 } });
    const b = mockCard({ name: 'B', cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 } });
    const state = mockGameState({
      players: [mockPlayerState(0, { discardPile: [a, b] }), mockPlayerState(1)],
    });
    const target: TargetExpr = { type: 'target_card_in_discard', side: 'allied', filter: { maxCost: 3 } };

    const r1 = resolveTargets(state, target, ctx(0));
    const r2 = resolveTargets(state, target, ctx(0));
    if (r1.resolved || r2.resolved) throw new Error('expected pendingChoice');
    expect(r1.pendingChoice.options).toEqual(r2.pendingChoice.options);
    expect(r1.pendingChoice.options.map(o => o.id)).toEqual([a.instanceId, b.instanceId]);
  });
});

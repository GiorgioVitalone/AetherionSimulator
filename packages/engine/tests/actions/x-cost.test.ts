import { describe, it, expect, beforeEach } from 'vitest';
import { canAfford, payCost, computeMaxX } from '../../src/actions/cost-checker.js';
import { evaluateAmount } from '../../src/effects/amount-evaluator.js';
import { mockPlayerState, mockGameState, resetInstanceCounter } from '../helpers/card-factory.js';
import type { ResourceCard, EffectContext } from '../../src/types/game-state.js';

function makeBank(resources: readonly { type: 'mana' | 'energy' }[]): readonly ResourceCard[] {
  return resources.map((r, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: r.type,
    exhausted: false,
  }));
}

beforeEach(() => {
  resetInstanceCounter();
});

describe('X-cost', () => {
  it('should always afford X-cost card when base cost met (X can be 0)', () => {
    // Grovekeeper 3000: { mana: 0, energy: 0, flexible: 0, xEnergy: true }
    const player = mockPlayerState(0, { resourceBank: [] });
    expect(canAfford(player, { mana: 0, energy: 0, flexible: 0, xEnergy: true })).toBe(true);
  });

  it('should compute max X from remaining resources', () => {
    const bank = makeBank([
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
    ]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    // Grovekeeper 3000: base cost 0, so maxX = 5
    const maxX = computeMaxX(player, { mana: 0, energy: 0, flexible: 0, xEnergy: true });
    expect(maxX).toBe(5);
  });

  it('should compute max X accounting for base cost', () => {
    const bank = makeBank([
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
    ]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    // Steel-Root Armor: { mana: 0, energy: 4, xEnergy: true } → base 4, maxX = 3
    const maxX = computeMaxX(player, { mana: 0, energy: 4, flexible: 0, xEnergy: true });
    expect(maxX).toBe(3);
  });

  it('should pay base + X resources', () => {
    const bank = makeBank([
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'energy' },
    ]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    // Steel-Root Armor: base 4 + X=3 = 7 total
    const result = payCost(player, { mana: 0, energy: 4, flexible: 0, xEnergy: true }, 3);

    const exhaustedCount = result.resourceBank.filter(r => r.exhausted).length;
    expect(exhaustedCount).toBe(7);
  });

  it('should evaluate x_cost amount expression using context.xValue', () => {
    const state = mockGameState();
    const context: EffectContext = {
      sourceInstanceId: 'src_1',
      controllerId: 0,
      triggerDepth: 0,
      xValue: 4,
    };
    const amount = evaluateAmount(state, { type: 'x_cost', resource: 'energy' }, context);
    expect(amount).toBe(4);
  });

  it('should default x_cost to 0 when no xValue in context', () => {
    const state = mockGameState();
    const context: EffectContext = {
      sourceInstanceId: 'src_1',
      controllerId: 0,
      triggerDepth: 0,
    };
    const amount = evaluateAmount(state, { type: 'x_cost', resource: 'energy' }, context);
    expect(amount).toBe(0);
  });
});

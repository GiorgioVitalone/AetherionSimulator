import { describe, it, expect, beforeEach } from 'vitest';
import { canAfford, payCost } from '../../src/actions/cost-checker.js';
import { mockPlayerState, resetInstanceCounter } from '../helpers/card-factory.js';
import type { ResourceCard } from '../../src/types/game-state.js';

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

describe('flexible cost', () => {
  it('should allow paying flexible cost with any mix of mana and energy', () => {
    // Forest Beast: { mana: 0, energy: 3, flexible: 1 } = 3 total with any mix
    const bank = makeBank([
      { type: 'mana' },
      { type: 'mana' },
      { type: 'energy' },
    ]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    expect(canAfford(player, { mana: 0, energy: 3, flexible: 1 })).toBe(true);
  });

  it('should return false when total resources insufficient for flexible cost', () => {
    // Regrowth: { mana: 0, energy: 2, flexible: 1 } = 2 total, but player has only 1
    const bank = makeBank([{ type: 'mana' }]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    expect(canAfford(player, { mana: 0, energy: 2, flexible: 1 })).toBe(false);
  });

  it('should exhaust correct number of resources when paying flexible', () => {
    // Pay 3 total with any mix
    const bank = makeBank([
      { type: 'mana' },
      { type: 'energy' },
      { type: 'energy' },
      { type: 'mana' },
    ]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    const result = payCost(player, { mana: 0, energy: 3, flexible: 1 });

    const exhaustedCount = result.resourceBank.filter(r => r.exhausted).length;
    expect(exhaustedCount).toBe(3);
  });

  it('should treat flexible: 0 as standard specific-resource cost', () => {
    // Not flexible: need specific mana
    const bank = makeBank([{ type: 'energy' }, { type: 'energy' }]);
    const player = mockPlayerState(0, { resourceBank: bank as ResourceCard[] });
    // Need 1 mana specifically, but only have energy
    expect(canAfford(player, { mana: 1, energy: 0, flexible: 0 })).toBe(false);
  });
});

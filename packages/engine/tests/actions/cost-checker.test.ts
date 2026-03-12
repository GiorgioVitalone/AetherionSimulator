import { describe, it, expect, beforeEach } from 'vitest';
import { canAfford, payCost, getAvailableResources } from '../../src/actions/cost-checker.js';
import { mockPlayerState, resetInstanceCounter } from '../helpers/card-factory.js';
import type { PlayerState, ResourceCard } from '../../src/types/game-state.js';

function makeBank(resources: readonly { type: 'mana' | 'energy'; exhausted?: boolean }[]): readonly ResourceCard[] {
  return resources.map((r, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: r.type,
    exhausted: r.exhausted ?? false,
  }));
}

function playerWithResources(
  bank: readonly ResourceCard[],
  tempMana = 0,
  tempEnergy = 0,
): PlayerState {
  const temps = [];
  if (tempMana > 0) temps.push({ resourceType: 'mana' as const, amount: tempMana });
  if (tempEnergy > 0) temps.push({ resourceType: 'energy' as const, amount: tempEnergy });

  return mockPlayerState(0, {
    resourceBank: bank as ResourceCard[],
    temporaryResources: temps,
  });
}

describe('Cost Checker', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('getAvailableResources', () => {
    it('should count unexhausted bank resources', () => {
      const bank = makeBank([
        { type: 'mana' },
        { type: 'mana' },
        { type: 'energy' },
        { type: 'energy', exhausted: true },
      ]);
      const player = playerWithResources(bank);
      const avail = getAvailableResources(player);
      expect(avail.mana).toBe(2);
      expect(avail.energy).toBe(1);
    });

    it('should include temporary resources', () => {
      const bank = makeBank([{ type: 'mana' }]);
      const player = playerWithResources(bank, 1, 2);
      const avail = getAvailableResources(player);
      expect(avail.mana).toBe(2);
      expect(avail.energy).toBe(2);
    });
  });

  describe('canAfford', () => {
    it('should return true when exact resources available', () => {
      const bank = makeBank([{ type: 'mana' }, { type: 'mana' }, { type: 'energy' }]);
      const player = playerWithResources(bank);
      expect(canAfford(player, { mana: 2, energy: 1, flexible: 0 })).toBe(true);
    });

    it('should return false when mana insufficient', () => {
      const bank = makeBank([{ type: 'mana' }, { type: 'energy' }, { type: 'energy' }]);
      const player = playerWithResources(bank);
      expect(canAfford(player, { mana: 2, energy: 0, flexible: 0 })).toBe(false);
    });

    it('should allow flexible cost with any resource mix', () => {
      // Flexible flag: total cost (mana+energy) is payable with any mix
      const bank = makeBank([{ type: 'energy' }, { type: 'energy' }, { type: 'energy' }]);
      const player = playerWithResources(bank);
      // Cost is energy:3, flexible:1 means pay 3 total with any resources
      expect(canAfford(player, { mana: 0, energy: 3, flexible: 1 })).toBe(true);
    });

    it('should return false when total resources below flexible cost', () => {
      const bank = makeBank([{ type: 'mana' }]);
      const player = playerWithResources(bank);
      // Flexible: total cost = mana + energy = 3, player has 1 resource
      expect(canAfford(player, { mana: 0, energy: 3, flexible: 1 })).toBe(false);
    });

    it('should handle zero cost', () => {
      const player = playerWithResources([]);
      expect(canAfford(player, { mana: 0, energy: 0, flexible: 0 })).toBe(true);
    });

    it('should count exhausted resources as unavailable', () => {
      const bank = makeBank([
        { type: 'mana', exhausted: true },
        { type: 'mana', exhausted: true },
      ]);
      const player = playerWithResources(bank);
      expect(canAfford(player, { mana: 1, energy: 0, flexible: 0 })).toBe(false);
    });
  });

  describe('payCost', () => {
    it('should exhaust specific resources first', () => {
      const bank = makeBank([
        { type: 'mana' },
        { type: 'mana' },
        { type: 'energy' },
      ]);
      const player = playerWithResources(bank);
      const result = payCost(player, { mana: 1, energy: 1, flexible: 0 });

      const exhaustedCount = result.resourceBank.filter(r => r.exhausted).length;
      expect(exhaustedCount).toBe(2);
    });

    it('should exhaust any resources for flexible cost', () => {
      const bank = makeBank([
        { type: 'mana' },
        { type: 'mana' },
        { type: 'energy' },
      ]);
      const player = playerWithResources(bank);
      // Flexible flag: total cost = 0 + 2 = 2, pay with any 2 resources
      const result = payCost(player, { mana: 0, energy: 2, flexible: 1 });

      const exhaustedCount = result.resourceBank.filter(r => r.exhausted).length;
      expect(exhaustedCount).toBe(2);
    });

    it('should deduct from temporary resources when bank insufficient', () => {
      const player = playerWithResources([], 2, 0);
      const result = payCost(player, { mana: 1, energy: 0, flexible: 0 });

      expect(result.temporaryResources.length).toBe(1);
      expect(result.temporaryResources[0]!.amount).toBe(1);
    });

    it('should remove temporary resources that reach zero', () => {
      const player = playerWithResources([], 1, 0);
      const result = payCost(player, { mana: 1, energy: 0, flexible: 0 });

      expect(result.temporaryResources.length).toBe(0);
    });
  });
});

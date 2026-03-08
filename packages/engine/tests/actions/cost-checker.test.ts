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

    it('should use remaining resources for flexible cost', () => {
      const bank = makeBank([
        { type: 'mana' },
        { type: 'mana' },
        { type: 'energy' },
        { type: 'energy' },
      ]);
      const player = playerWithResources(bank);
      // 1 mana specific + 2 flexible = 3 total, leaving 1 mana + 2 energy = 3 remaining for flexible
      expect(canAfford(player, { mana: 1, energy: 0, flexible: 2 })).toBe(true);
    });

    it('should return false when flexible exceeds remaining', () => {
      const bank = makeBank([{ type: 'mana' }, { type: 'energy' }]);
      const player = playerWithResources(bank);
      // 1 mana specific, leaves 1 energy for flexible, but need 2 flexible
      expect(canAfford(player, { mana: 1, energy: 0, flexible: 2 })).toBe(false);
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

    it('should exhaust flexible from remaining bank cards', () => {
      const bank = makeBank([
        { type: 'mana' },
        { type: 'energy' },
        { type: 'energy' },
      ]);
      const player = playerWithResources(bank);
      const result = payCost(player, { mana: 0, energy: 1, flexible: 1 });

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

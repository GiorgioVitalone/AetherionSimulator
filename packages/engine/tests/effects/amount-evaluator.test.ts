import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateAmount } from '../../src/effects/amount-evaluator.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { AmountExpr } from '../../src/types/common.js';
import type { EffectContext } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function ctx(controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: 'src', controllerId, triggerDepth: 0 };
}

describe('Amount Evaluator', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('empty_slots', () => {
    it('should return correct count for frontline (3 slots)', () => {
      const card = mockCard({ owner: 0 });
      const zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: { type: 'empty_slots', zone: 'frontline', side: 'allied' },
      };

      // Frontline has 3 slots, 1 occupied → 2 empty
      expect(evaluateAmount(state, amount, ctx(0))).toBe(2);
    });

    it('should return correct count for reserve (2 slots)', () => {
      const state = mockGameState();

      const amount: AmountExpr = {
        type: 'count',
        counting: { type: 'empty_slots', zone: 'reserve', side: 'allied' },
      };

      // Reserve has 2 slots, all empty
      expect(evaluateAmount(state, amount, ctx(0))).toBe(2);
    });

    it('should return correct count for high_ground (2 slots)', () => {
      const card = mockCard({ owner: 0 });
      const zones = deployToZone(emptyZones(), card, 'high_ground');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: { type: 'empty_slots', zone: 'high_ground', side: 'allied' },
      };

      // High ground has 2 slots, 1 occupied → 1 empty
      expect(evaluateAmount(state, amount, ctx(0))).toBe(1);
    });

    it('should count enemy empty slots', () => {
      const card = mockCard({ owner: 1 });
      const zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        players: [
          mockPlayerState(0),
          mockPlayerState(1, { zones }),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: { type: 'empty_slots', zone: 'frontline', side: 'enemy' },
      };

      // Enemy frontline: 3 slots, 1 occupied → 2 empty
      expect(evaluateAmount(state, amount, ctx(0))).toBe(2);
    });
  });

  describe('cards_in_zone with filter (hand/discard)', () => {
    it('should filter hand cards by cardType', () => {
      const spell = mockCard({ cardType: 'S' as any, owner: 0 });
      const character = mockCard({ cardType: 'C' as any, owner: 0 });
      const equipment = mockCard({ cardType: 'E' as any, owner: 0 });

      const state = mockGameState({
        players: [
          mockPlayerState(0, { hand: [spell, character, equipment] }),
          mockPlayerState(1),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: {
          type: 'cards_in_zone',
          zone: 'hand',
          side: 'allied',
          filter: { cardType: 'S' },
        },
      };

      // Only 1 spell in hand
      expect(evaluateAmount(state, amount, ctx(0))).toBe(1);
    });

    it('should filter discard pile by tag', () => {
      const dragon = mockCard({ tags: ['Dragon'], owner: 0 });
      const human = mockCard({ tags: ['Human'], owner: 0 });
      const dragon2 = mockCard({ tags: ['Dragon', 'Elite'], owner: 0 });

      const state = mockGameState({
        players: [
          mockPlayerState(0, { discardPile: [dragon, human, dragon2] }),
          mockPlayerState(1),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: {
          type: 'cards_in_zone',
          zone: 'discard',
          side: 'allied',
          filter: { tag: 'Dragon' },
        },
      };

      // 2 dragons in discard
      expect(evaluateAmount(state, amount, ctx(0))).toBe(2);
    });

    it('should return unfiltered count when no filter specified', () => {
      const cards = [mockCard({ owner: 0 }), mockCard({ owner: 0 })];

      const state = mockGameState({
        players: [
          mockPlayerState(0, { hand: cards }),
          mockPlayerState(1),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: {
          type: 'cards_in_zone',
          zone: 'hand',
          side: 'allied',
        },
      };

      expect(evaluateAmount(state, amount, ctx(0))).toBe(2);
    });

    it('should filter hand cards by maxCost', () => {
      const cheap = mockCard({ cost: { mana: 1, energy: 0, flexible: 0 }, owner: 0 });
      const expensive = mockCard({ cost: { mana: 3, energy: 2, flexible: 0 }, owner: 0 });

      const state = mockGameState({
        players: [
          mockPlayerState(0, { hand: [cheap, expensive] }),
          mockPlayerState(1),
        ],
      });

      const amount: AmountExpr = {
        type: 'count',
        counting: {
          type: 'cards_in_zone',
          zone: 'hand',
          side: 'allied',
          filter: { maxCost: 2 },
        },
      };

      // Only the cheap card (cost 1) passes maxCost 2
      expect(evaluateAmount(state, amount, ctx(0))).toBe(1);
    });
  });
});

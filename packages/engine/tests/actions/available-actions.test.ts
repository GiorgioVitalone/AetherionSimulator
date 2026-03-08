import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import type { CardInstance, ResourceCard } from '../../src/types/game-state.js';

function makeBank(resources: readonly { type: 'mana' | 'energy'; exhausted?: boolean }[]): ResourceCard[] {
  return resources.map((r, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: r.type,
    exhausted: r.exhausted ?? false,
  }));
}

describe('Available Actions', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('deploy options', () => {
    it('should list deployable characters with affordable cost', () => {
      const handCard = mockCard({
        name: 'Warrior',
        cardType: 'C',
        cost: { mana: 1, energy: 0, flexible: 0 },
        owner: 0,
      });
      const bank = makeBank([{ type: 'mana' }]);

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [handCard], resourceBank: bank }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDeploy).toHaveLength(1);
      expect(actions.canDeploy[0]!.cardInstanceId).toBe(handCard.instanceId);
      // Should have both frontline and reserve as valid deploy zones
      expect(actions.canDeploy[0]!.validSlots.length).toBeGreaterThanOrEqual(2);
    });

    it('should exclude cards player cannot afford', () => {
      const expensiveCard = mockCard({
        name: 'Expensive',
        cardType: 'C',
        cost: { mana: 5, energy: 0, flexible: 0 },
        owner: 0,
      });

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [expensiveCard], resourceBank: [] }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDeploy).toHaveLength(0);
    });

    it('should exclude deploy when all zones are full', () => {
      const handCard = mockCard({
        name: 'Warrior',
        cardType: 'C',
        cost: { mana: 0, energy: 0, flexible: 0 },
        owner: 0,
      });

      // Fill all deployable zones
      let zones = emptyZones();
      zones = deployToZone(zones, mockCard({ owner: 0 }), 'frontline', 0);
      zones = deployToZone(zones, mockCard({ owner: 0 }), 'frontline', 1);
      zones = deployToZone(zones, mockCard({ owner: 0 }), 'frontline', 2);
      zones = deployToZone(zones, mockCard({ owner: 0 }), 'reserve', 0);
      zones = deployToZone(zones, mockCard({ owner: 0 }), 'reserve', 1);

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [handCard], zones }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDeploy).toHaveLength(0);
    });

    it('should not allow deploy during action phase', () => {
      const handCard = mockCard({
        name: 'Warrior',
        cardType: 'C',
        cost: { mana: 0, energy: 0, flexible: 0 },
        owner: 0,
      });

      const state = mockGameState({
        phase: 'action',
        players: [
          mockPlayerState(0, { hand: [handCard] }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDeploy).toHaveLength(0);
    });
  });

  describe('spell options', () => {
    it('should list affordable spells in strategy phase', () => {
      const spell = mockCard({
        name: 'Fireball',
        cardType: 'S',
        cost: { mana: 2, energy: 0, flexible: 0 },
        owner: 0,
      });
      const bank = makeBank([{ type: 'mana' }, { type: 'mana' }]);

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [spell], resourceBank: bank }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canCastSpell).toHaveLength(1);
      expect(actions.canCastSpell[0]!.cardInstanceId).toBe(spell.instanceId);
    });
  });

  describe('equipment options', () => {
    it('should list equipment when there are unequipped characters', () => {
      const equipment = mockCard({
        name: 'Sword',
        cardType: 'E',
        cost: { mana: 1, energy: 0, flexible: 0 },
        owner: 0,
      });
      const character = mockCard({ cardType: 'C', owner: 0 });
      let zones = deployToZone(emptyZones(), character, 'frontline');
      const bank = makeBank([{ type: 'mana' }]);

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [equipment], zones, resourceBank: bank }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canAttachEquipment).toHaveLength(1);
      expect(actions.canAttachEquipment[0]!.validTargets).toContain(character.instanceId);
    });

    it('should exclude characters that already have equipment', () => {
      const equipment = mockCard({
        name: 'Sword',
        cardType: 'E',
        cost: { mana: 0, energy: 0, flexible: 0 },
        owner: 0,
      });
      const equippedChar = mockCard({
        cardType: 'C',
        owner: 0,
        equipment: mockCard({ cardType: 'E', owner: 0 }) as CardInstance,
      });
      let zones = deployToZone(emptyZones(), equippedChar, 'frontline');

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [equipment], zones }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canAttachEquipment).toHaveLength(0);
    });
  });

  describe('movement options', () => {
    it('should allow ready characters to move to adjacent zones', () => {
      const card = mockCard({ owner: 0, exhausted: false, movedThisTurn: false });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canMove).toHaveLength(1);
      expect(actions.canMove[0]!.validDestinations).toContain('reserve');
      expect(actions.canMove[0]!.validDestinations).toContain('high_ground');
    });

    it('should not allow exhausted characters to move', () => {
      const card = mockCard({ owner: 0, exhausted: true });
      let zones = deployToZone(emptyZones(), card, 'frontline');

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canMove).toHaveLength(0);
    });

    it('should not allow movement to full zones', () => {
      const mover = mockCard({ owner: 0, exhausted: false, movedThisTurn: false });
      let zones = emptyZones();
      zones = deployToZone(zones, mover, 'reserve', 0);
      // Fill all frontline slots with exhausted cards (so they can't move themselves)
      zones = deployToZone(zones, mockCard({ owner: 0, exhausted: true }), 'frontline', 0);
      zones = deployToZone(zones, mockCard({ owner: 0, exhausted: true }), 'frontline', 1);
      zones = deployToZone(zones, mockCard({ owner: 0, exhausted: true }), 'frontline', 2);

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { zones }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      // Reserve can only move to frontline, which is full
      // Only the mover is checked (exhausted cards can't move)
      expect(actions.canMove).toHaveLength(0);
    });
  });

  describe('attack options', () => {
    it('should allow ready characters to attack in action phase', () => {
      const attacker = mockCard({ owner: 0, exhausted: false, summoningSick: false });
      const defender = mockCard({ owner: 1, exhausted: false });

      let p0Zones = deployToZone(emptyZones(), attacker, 'frontline');
      let p1Zones = deployToZone(emptyZones(), defender, 'frontline');

      const state = mockGameState({
        phase: 'action',
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1, { zones: p1Zones }),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canAttack).toHaveLength(1);
      expect(actions.canAttack[0]!.validTargets.length).toBeGreaterThan(0);
    });

    it('should not allow summoning-sick characters to attack', () => {
      const attacker = mockCard({ owner: 0, summoningSick: true });
      const defender = mockCard({ owner: 1 });

      let p0Zones = deployToZone(emptyZones(), attacker, 'frontline');
      let p1Zones = deployToZone(emptyZones(), defender, 'frontline');

      const state = mockGameState({
        phase: 'action',
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1, { zones: p1Zones }),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canAttack).toHaveLength(0);
    });

    it('should not list attacks during strategy phase', () => {
      const attacker = mockCard({ owner: 0, exhausted: false, summoningSick: false });
      const defender = mockCard({ owner: 1 });

      let p0Zones = deployToZone(emptyZones(), attacker, 'frontline');
      let p1Zones = deployToZone(emptyZones(), defender, 'frontline');

      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1, { zones: p1Zones }),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canAttack).toHaveLength(0);
    });
  });

  describe('discard for energy', () => {
    it('should allow discard if hand is not empty and not used this turn', () => {
      const card = mockCard({ owner: 0 });
      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [card] }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDiscardForEnergy).toBe(true);
    });

    it('should not allow discard if already used this turn', () => {
      const card = mockCard({ owner: 0 });
      const state = mockGameState({
        phase: 'strategy',
        turnState: { discardedForEnergy: true, firstPlayerFirstTurn: false },
        players: [
          mockPlayerState(0, { hand: [card] }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDiscardForEnergy).toBe(false);
    });

    it('should not allow discard with empty hand', () => {
      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, { hand: [] }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canDiscardForEnergy).toBe(false);
    });
  });

  describe('transform', () => {
    it('should allow transform when hero LP <= 10', () => {
      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, {
            hero: {
              cardDefId: 1,
              name: 'Test Hero',
              currentLp: 10,
              maxLp: 25,
              transformed: false,
              canTransformThisGame: true,
              transformedThisTurn: false,
              abilities: [],
              cooldowns: new Map(),
              registeredTriggers: [],
            },
          }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canTransform).toBe(true);
    });

    it('should not allow transform if already transformed', () => {
      const state = mockGameState({
        phase: 'strategy',
        players: [
          mockPlayerState(0, {
            hero: {
              cardDefId: 1,
              name: 'Test Hero',
              currentLp: 5,
              maxLp: 25,
              transformed: true,
              canTransformThisGame: true,
              transformedThisTurn: false,
              abilities: [],
              cooldowns: new Map(),
              registeredTriggers: [],
            },
          }),
          mockPlayerState(1),
        ],
      });

      const actions = computeAvailableActions(state);
      expect(actions.canTransform).toBe(false);
    });
  });

  describe('canEndPhase', () => {
    it('should be true in strategy and action phases', () => {
      const strategyState = mockGameState({ phase: 'strategy' });
      const actionState = mockGameState({ phase: 'action' });
      const upkeepState = mockGameState({ phase: 'upkeep' });

      expect(computeAvailableActions(strategyState).canEndPhase).toBe(true);
      expect(computeAvailableActions(actionState).canEndPhase).toBe(true);
      expect(computeAvailableActions(upkeepState).canEndPhase).toBe(false);
    });
  });
});

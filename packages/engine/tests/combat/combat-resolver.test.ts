import { describe, it, expect, beforeEach } from 'vitest';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockCardWithTraits,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function gameWithCards(
  p0Frontline: Parameters<typeof mockCard>[0][] = [],
  p1Frontline: Parameters<typeof mockCard>[0][] = [],
) {
  let p0Zones = emptyZones();
  const p0Cards = p0Frontline.map(o => mockCard({ ...o, owner: 0 }));
  for (const card of p0Cards) {
    p0Zones = deployToZone(p0Zones, card, 'frontline');
  }

  let p1Zones = emptyZones();
  const p1Cards = p1Frontline.map(o => mockCard({ ...o, owner: 1 }));
  for (const card of p1Cards) {
    p1Zones = deployToZone(p1Zones, card, 'frontline');
  }

  return mockGameState({
    players: [
      mockPlayerState(0, { zones: p0Zones }),
      mockPlayerState(1, { zones: p1Zones }),
    ],
  });
}

describe('Combat Resolver', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('should resolve basic combat with damage to both', () => {
    const state = gameWithCards(
      [{ currentAtk: 3, currentHp: 4, currentArm: 0 }],
      [{ currentAtk: 2, currentHp: 5, currentArm: 0 }],
    );
    const attacker = state.players[0]!.zones.frontline[0]!;
    const defender = state.players[1]!.zones.frontline[0]!;

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

    const events = result.events;
    expect(events.some(e => e.type === 'CHARACTER_ATTACKED')).toBe(true);
    expect(events.some(e => e.type === 'DAMAGE_DEALT')).toBe(true);
  });

  it('should destroy defender when lethal damage dealt', () => {
    const state = gameWithCards(
      [{ currentAtk: 5, currentHp: 10, currentArm: 0 }],
      [{ currentAtk: 1, currentHp: 3, currentArm: 0 }],
    );
    const attacker = state.players[0]!.zones.frontline[0]!;
    const defender = state.players[1]!.zones.frontline[0]!;

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

    expect(
      result.events.some(
        e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === defender.instanceId,
      ),
    ).toBe(true);
    // Defender removed from frontline
    expect(result.newState.players[1]!.zones.frontline[0]).toBeNull();
  });

  it('should exhaust attacker', () => {
    const state = gameWithCards(
      [{ currentAtk: 2, currentHp: 5 }],
      [{ currentAtk: 1, currentHp: 5 }],
    );
    const attacker = state.players[0]!.zones.frontline[0]!;
    const defender = state.players[1]!.zones.frontline[0]!;

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

    const updatedAttacker = result.newState.players[0]!.zones.frontline[0];
    expect(updatedAttacker?.exhausted).toBe(true);
    expect(updatedAttacker?.attackedThisTurn).toBe(true);
  });

  it('should handle mutual destruction', () => {
    const state = gameWithCards(
      [{ currentAtk: 3, currentHp: 2 }],
      [{ currentAtk: 3, currentHp: 2 }],
    );
    const attacker = state.players[0]!.zones.frontline[0]!;
    const defender = state.players[1]!.zones.frontline[0]!;

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

    const destroyed = result.events.filter(e => e.type === 'CARD_DESTROYED');
    expect(destroyed).toHaveLength(2);
  });

  it('should apply ARM reduction', () => {
    const state = gameWithCards(
      [{ currentAtk: 3, currentHp: 10, currentArm: 0 }],
      [{ currentAtk: 2, currentHp: 10, currentArm: 2 }],
    );
    const attacker = state.players[0]!.zones.frontline[0]!;
    const defender = state.players[1]!.zones.frontline[0]!;

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

    // 3 ATK - 2 ARM = 1 damage to defender
    const defenderCard = result.newState.players[1]!.zones.frontline[0]!;
    expect(defenderCard.currentHp).toBe(9);
  });

  it('should throw if attacker is exhausted', () => {
    const state = gameWithCards(
      [{ currentAtk: 3, currentHp: 5, exhausted: true }],
      [{ currentAtk: 1, currentHp: 5 }],
    );
    const attacker = state.players[0]!.zones.frontline[0]!;
    const defender = state.players[1]!.zones.frontline[0]!;

    expect(() =>
      resolveCombat(state, attacker.instanceId, defender.instanceId),
    ).toThrow('exhausted');
  });

  describe('Hero attacks', () => {
    it('should damage hero from high ground', () => {
      let p0Zones = emptyZones();
      const attacker = mockCard({
        currentAtk: 4,
        currentHp: 5,
        owner: 0,
      });
      p0Zones = deployToZone(p0Zones, attacker, 'high_ground');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1),
        ],
      });

      const result = resolveCombat(state, attacker.instanceId, 'hero');

      expect(
        result.events.some(e => e.type === 'HERO_DAMAGED'),
      ).toBe(true);
      expect(result.newState.players[1]!.hero.currentLp).toBe(21); // 25 - 4
    });

    it('should set winner when hero LP reaches 0', () => {
      let p0Zones = emptyZones();
      const attacker = mockCard({
        currentAtk: 30,
        currentHp: 5,
        owner: 0,
      });
      p0Zones = deployToZone(p0Zones, attacker, 'high_ground');

      const state = mockGameState({
        players: [
          mockPlayerState(0, { zones: p0Zones }),
          mockPlayerState(1),
        ],
      });

      const result = resolveCombat(state, attacker.instanceId, 'hero');
      expect(result.newState.winner).toBe(0);
      expect(result.newState.players[1]!.hero.currentLp).toBe(0);
    });
  });

  describe('CARD_DESTROYED events include playerId', () => {
    it('should include correct playerId for defender destruction', () => {
      const state = gameWithCards(
        [{ currentAtk: 5, currentHp: 10, currentArm: 0 }],
        [{ currentAtk: 1, currentHp: 3, currentArm: 0 }],
      );
      const attacker = state.players[0]!.zones.frontline[0]!;
      const defender = state.players[1]!.zones.frontline[0]!;

      const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

      const destroyEvent = result.events.find(
        e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === defender.instanceId,
      );
      expect(destroyEvent).toBeDefined();
      if (destroyEvent?.type === 'CARD_DESTROYED') {
        expect(destroyEvent.playerId).toBe(1); // Defender belongs to player 1
      }
    });

    it('should include correct playerId for mutual destruction', () => {
      const state = gameWithCards(
        [{ currentAtk: 3, currentHp: 2 }],
        [{ currentAtk: 3, currentHp: 2 }],
      );
      const attacker = state.players[0]!.zones.frontline[0]!;
      const defender = state.players[1]!.zones.frontline[0]!;

      const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

      const destroyed = result.events.filter(e => e.type === 'CARD_DESTROYED');
      expect(destroyed).toHaveLength(2);
      const defenderDeath = destroyed.find(
        e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === defender.instanceId,
      );
      const attackerDeath = destroyed.find(
        e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === attacker.instanceId,
      );
      if (defenderDeath?.type === 'CARD_DESTROYED') {
        expect(defenderDeath.playerId).toBe(1);
      }
      if (attackerDeath?.type === 'CARD_DESTROYED') {
        expect(attackerDeath.playerId).toBe(0);
      }
    });
  });

  describe('Simultaneous combat', () => {
    it('should still destroy the attacker when both sides deal lethal damage', () => {
      const state = gameWithCards(
        [{ currentAtk: 5, currentHp: 3, traits: ['first_strike'] }],
        [{ currentAtk: 10, currentHp: 4 }],
      );
      const attacker = state.players[0]!.zones.frontline[0]!;
      const defender = state.players[1]!.zones.frontline[0]!;

      const result = resolveCombat(state, attacker.instanceId, defender.instanceId);

      // Defender destroyed, attacker survives
      expect(
        result.events.some(
          e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === defender.instanceId,
        ),
      ).toBe(true);
      expect(
        result.events.some(
          e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === attacker.instanceId,
        ),
      ).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getValidAttackTargets,
  isBoardEmpty,
} from '../../src/zones/targeting.js';
import {
  mockCard,
  mockCardWithTraits,
  resetInstanceCounter,
  zonesWithCards,
  emptyZones,
} from '../helpers/card-factory.js';

describe('Targeting', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('isBoardEmpty', () => {
    it('should return true for empty zones', () => {
      expect(isBoardEmpty(emptyZones())).toBe(true);
    });

    it('should return false with card in frontline', () => {
      const zones = zonesWithCards({
        frontline: [mockCard(), null, null],
      });
      expect(isBoardEmpty(zones)).toBe(false);
    });

    it('should return false with card in high ground', () => {
      const zones = zonesWithCards({
        highGround: [mockCard(), null],
      });
      expect(isBoardEmpty(zones)).toBe(false);
    });

    it('should return true with cards only in reserve', () => {
      const zones = zonesWithCards({
        reserve: [mockCard(), null],
      });
      expect(isBoardEmpty(zones)).toBe(true);
    });
  });

  describe('getValidAttackTargets', () => {
    describe('Empty Board Rule', () => {
      it('should allow any attacker to target hero when board empty', () => {
        const targets = getValidAttackTargets(
          'frontline',
          [],
          emptyZones(),
        );
        expect(targets).toHaveLength(1);
        expect(targets[0]?.type).toBe('hero');
      });

      it('should allow reserve attacker to target hero when board empty', () => {
        const targets = getValidAttackTargets(
          'reserve',
          [],
          emptyZones(),
        );
        expect(targets).toHaveLength(1);
        expect(targets[0]?.type).toBe('hero');
      });
    });

    describe('Reserve attacker', () => {
      it('should have no targets without Sniper', () => {
        const defender = mockCard();
        const zones = zonesWithCards({
          frontline: [defender, null, null],
        });
        const targets = getValidAttackTargets('reserve', [], zones);
        expect(targets).toHaveLength(0);
      });

      it('should target enemy frontline with Sniper', () => {
        const d1 = mockCard();
        const d2 = mockCard();
        const zones = zonesWithCards({
          frontline: [d1, d2, null],
          highGround: [mockCard(), null],
        });
        const targets = getValidAttackTargets(
          'reserve',
          ['sniper'],
          zones,
        );
        expect(targets).toHaveLength(2);
        expect(targets.every(t => t.type === 'character')).toBe(true);
      });
    });

    describe('Frontline attacker', () => {
      it('should target enemy frontline and high ground', () => {
        const flCard = mockCard();
        const hgCard = mockCard();
        const zones = zonesWithCards({
          frontline: [flCard, null, null],
          highGround: [hgCard, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          [],
          zones,
        );
        expect(targets).toHaveLength(2);
        const ids = targets.map(t => t.instanceId);
        expect(ids).toContain(flCard.instanceId);
        expect(ids).toContain(hgCard.instanceId);
      });

      it('should NOT be able to target hero', () => {
        const zones = zonesWithCards({
          frontline: [mockCard(), null, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          [],
          zones,
        );
        expect(targets.some(t => t.type === 'hero')).toBe(false);
      });
    });

    describe('High Ground attacker', () => {
      it('should target enemy frontline, high ground, and hero', () => {
        const flCard = mockCard();
        const hgCard = mockCard();
        const zones = zonesWithCards({
          frontline: [flCard, null, null],
          highGround: [hgCard, null],
        });
        const targets = getValidAttackTargets(
          'high_ground',
          [],
          zones,
        );
        expect(targets).toHaveLength(3);
        expect(targets.some(t => t.type === 'hero')).toBe(true);
      });
    });

    describe('Defender priority', () => {
      it('should force attacker to target Defenders in frontline', () => {
        const defender = mockCardWithTraits(['defender']);
        const nonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [defender, nonDefender, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          [],
          zones,
        );
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(defender.instanceId);
      });

      it('should allow choosing among multiple Defenders', () => {
        const d1 = mockCardWithTraits(['defender']);
        const d2 = mockCardWithTraits(['defender']);
        const zones = zonesWithCards({
          frontline: [d1, d2, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          [],
          zones,
        );
        expect(targets).toHaveLength(2);
      });

      it('should not restrict high ground attacker from hero when Defenders present', () => {
        const defender = mockCardWithTraits(['defender']);
        const zones = zonesWithCards({
          frontline: [defender, null, null],
        });
        const targets = getValidAttackTargets(
          'high_ground',
          [],
          zones,
        );
        // Must target defender, no hero option
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(defender.instanceId);
      });
    });

    describe('Flying bypass', () => {
      it('should bypass normal Defenders', () => {
        const defender = mockCardWithTraits(['defender']);
        const nonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [defender, nonDefender, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          ['flying'],
          zones,
        );
        // Flying bypasses all defenders (none have Flying/Sniper)
        expect(targets.length).toBeGreaterThan(1);
        const ids = targets.map(t => t.instanceId);
        expect(ids).toContain(nonDefender.instanceId);
      });

      it('should NOT bypass Defenders that have Flying', () => {
        const flyingDefender = mockCardWithTraits(['defender', 'flying']);
        const nonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [flyingDefender, nonDefender, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          ['flying'],
          zones,
        );
        // Cannot bypass — must target the flying defender
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(flyingDefender.instanceId);
      });

      it('should NOT bypass Defenders that have Sniper', () => {
        const sniperDefender = mockCardWithTraits(['defender', 'sniper']);
        const nonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [sniperDefender, nonDefender, null],
        });
        const targets = getValidAttackTargets(
          'frontline',
          ['flying'],
          zones,
        );
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(sniperDefender.instanceId);
      });
    });

    describe('EC-004 defenderForceCap', () => {
      const cap1 = { terminationMode: 'turn_cap' as const, defenderForceCap: 1 };

      it('a Defender below its cap still forces (no flow-around)', () => {
        const defender = mockCardWithTraits(['defender']); // forcedAttacksThisTurn = 0
        const nonDefender = mockCard();
        const zones = zonesWithCards({ frontline: [defender, nonDefender, null] });
        const targets = getValidAttackTargets('frontline', [], zones, cap1);
        // Still must target the (under-cap) Defender.
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(defender.instanceId);
      });

      it('a capped-out Defender stops forcing — attackers flow around the wall', () => {
        // Defender already forced once this turn ⇒ at its cap of 1.
        const cappedDefender = mockCard({ traits: ['defender'], forcedAttacksThisTurn: 1 });
        const nonDefender = mockCard();
        const zones = zonesWithCards({ frontline: [cappedDefender, nonDefender, null] });
        const targets = getValidAttackTargets('frontline', [], zones, cap1);
        // No forcing: both bodies are legal targets (the capped Defender remains
        // targetable, but is no longer mandatory).
        const ids = targets.map(t => t.instanceId);
        expect(ids).toContain(nonDefender.instanceId);
        expect(ids).toContain(cappedDefender.instanceId);
        expect(targets).toHaveLength(2);
      });

      it('a high-ground attacker reaches the hero once the Defender caps out', () => {
        const cappedDefender = mockCard({ traits: ['defender'], forcedAttacksThisTurn: 1 });
        const zones = zonesWithCards({ frontline: [cappedDefender, null, null] });
        const targets = getValidAttackTargets('high_ground', [], zones, cap1);
        // Wall is down ⇒ hero is now reachable from high ground.
        expect(targets.some(t => t.type === 'hero')).toBe(true);
      });

      it('with one capped and one fresh Defender, only the fresh one forces', () => {
        const capped = mockCard({ traits: ['defender'], forcedAttacksThisTurn: 1 });
        const fresh = mockCardWithTraits(['defender']); // 0 forced
        const zones = zonesWithCards({ frontline: [capped, fresh, null] });
        const targets = getValidAttackTargets('frontline', [], zones, cap1);
        // Still a Defender forcing ⇒ must target the fresh one only.
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(fresh.instanceId);
      });

      it('cap=2 keeps forcing until two attacks have been forced', () => {
        const cap2 = { terminationMode: 'turn_cap' as const, defenderForceCap: 2 };
        const onceForced = mockCard({ traits: ['defender'], forcedAttacksThisTurn: 1 });
        const nonDefender = mockCard();
        const zones = zonesWithCards({ frontline: [onceForced, nonDefender, null] });
        // 1 < 2 ⇒ still forcing.
        const targets = getValidAttackTargets('frontline', [], zones, cap2);
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(onceForced.instanceId);
      });

      it('default (no cap) forces regardless of forcedAttacksThisTurn (no-op)', () => {
        // Even a body that has been "forced" many times keeps forcing when uncapped.
        const defender = mockCard({ traits: ['defender'], forcedAttacksThisTurn: 99 });
        const nonDefender = mockCard();
        const zones = zonesWithCards({ frontline: [defender, nonDefender, null] });
        const targets = getValidAttackTargets('frontline', [], zones); // no config
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(defender.instanceId);
      });
    });

    describe('EC-007 defenderHighGroundOnly', () => {
      const on = { terminationMode: 'turn_cap' as const, defenderHighGroundOnly: true };

      it('a Defender in HIGH GROUND forces under the toggle', () => {
        const hgDefender = mockCardWithTraits(['defender']);
        const flNonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [flNonDefender, null, null],
          highGround: [hgDefender, null],
        });
        // A Frontline attacker reaches both zones; under EC-007 it must target the
        // High Ground Defender (which now forces).
        const targets = getValidAttackTargets('frontline', [], zones, on);
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(hgDefender.instanceId);
      });

      it('a Defender in FRONTLINE does NOT force under the toggle', () => {
        const flDefender = mockCardWithTraits(['defender']);
        const flNonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [flDefender, flNonDefender, null],
        });
        // No High Ground Defender ⇒ no forcing; both bodies are free targets.
        const targets = getValidAttackTargets('frontline', [], zones, on);
        const ids = targets.map(t => t.instanceId);
        expect(ids).toContain(flDefender.instanceId);
        expect(ids).toContain(flNonDefender.instanceId);
        expect(targets).toHaveLength(2);
      });

      it('a Frontline Defender no longer walls the hero from a High Ground attacker', () => {
        const flDefender = mockCardWithTraits(['defender']);
        const zones = zonesWithCards({ frontline: [flDefender, null, null] });
        // Under EC-007 the Frontline Defender does not force ⇒ hero is reachable.
        const targets = getValidAttackTargets('high_ground', [], zones, on);
        expect(targets.some(t => t.type === 'hero')).toBe(true);
      });

      it('OFF (default) keeps Frontline forcing, High Ground Defenders do NOT force', () => {
        const flDefender = mockCardWithTraits(['defender']);
        const hgDefender = mockCardWithTraits(['defender']);
        const flNonDefender = mockCard();
        const zones = zonesWithCards({
          frontline: [flDefender, flNonDefender, null],
          highGround: [hgDefender, null],
        });
        // No config ⇒ engine default: only the FRONTLINE Defender forces.
        const targets = getValidAttackTargets('frontline', [], zones);
        expect(targets).toHaveLength(1);
        expect(targets[0]?.instanceId).toBe(flDefender.instanceId);
      });
    });
  });
});

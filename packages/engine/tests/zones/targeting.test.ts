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
  });
});

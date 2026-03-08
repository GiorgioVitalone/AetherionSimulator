import { describe, it, expect } from 'vitest';
import {
  calculateCombatDamage,
  calculateHeroDamage,
} from '../../src/combat/damage-calculator.js';

describe('Damage Calculator', () => {
  describe('calculateCombatDamage', () => {
    it('should deal ATK minus ARM to defender', () => {
      const r = calculateCombatDamage(5, 0, 4, 2, 0, 3, [], []);
      expect(r.damageToDefender).toBe(5);
      expect(r.damageToAttacker).toBe(2);
    });

    it('should reduce damage by ARM (min 0)', () => {
      const r = calculateCombatDamage(3, 0, 5, 2, 2, 5, [], []);
      expect(r.damageToDefender).toBe(1); // 3 - 2 ARM
      expect(r.damageToAttacker).toBe(2); // no ARM on attacker
    });

    it('should not go below 0 damage', () => {
      const r = calculateCombatDamage(1, 0, 5, 1, 5, 5, [], []);
      expect(r.damageToDefender).toBe(0); // 1 - 5 ARM = 0
      expect(r.damageToAttacker).toBe(1);
    });

    it('should detect defender destruction', () => {
      const r = calculateCombatDamage(5, 0, 10, 1, 0, 3, [], []);
      expect(r.defenderDestroyed).toBe(true);
      expect(r.attackerDestroyed).toBe(false);
    });

    it('should detect mutual destruction (simultaneous)', () => {
      const r = calculateCombatDamage(3, 0, 2, 3, 0, 2, [], []);
      expect(r.defenderDestroyed).toBe(true);
      expect(r.attackerDestroyed).toBe(true);
      expect(r.damageToDefender).toBe(3);
      expect(r.damageToAttacker).toBe(3);
    });

    it('should handle exact lethal (HP reaches 0)', () => {
      const r = calculateCombatDamage(3, 0, 5, 1, 0, 3, [], []);
      expect(r.defenderDestroyed).toBe(true);
    });

    describe('First Strike', () => {
      it('attacker FS kills defender before counter-damage', () => {
        const r = calculateCombatDamage(
          5, 0, 3, 10, 0, 4,
          ['first_strike'], [],
        );
        expect(r.defenderDestroyed).toBe(true);
        expect(r.damageToAttacker).toBe(0); // Defender dies first
        expect(r.attackerDestroyed).toBe(false);
      });

      it('attacker FS does not prevent counter if defender survives', () => {
        const r = calculateCombatDamage(
          2, 0, 3, 4, 0, 5,
          ['first_strike'], [],
        );
        expect(r.defenderDestroyed).toBe(false);
        expect(r.damageToAttacker).toBe(4);
        expect(r.attackerDestroyed).toBe(true);
      });

      it('defender FS kills attacker before damage dealt', () => {
        const r = calculateCombatDamage(
          10, 0, 3, 5, 0, 4,
          [], ['first_strike'],
        );
        expect(r.attackerDestroyed).toBe(true);
        expect(r.damageToDefender).toBe(0);
        expect(r.defenderDestroyed).toBe(false);
      });

      it('both FS cancels out — simultaneous', () => {
        const r = calculateCombatDamage(
          3, 0, 2, 3, 0, 2,
          ['first_strike'], ['first_strike'],
        );
        expect(r.defenderDestroyed).toBe(true);
        expect(r.attackerDestroyed).toBe(true);
      });
    });
  });

  describe('calculateHeroDamage', () => {
    it('should return ATK as damage (no ARM on heroes by default)', () => {
      expect(calculateHeroDamage(5, 0)).toBe(5);
    });

    it('should reduce by ARM', () => {
      expect(calculateHeroDamage(5, 2)).toBe(3);
    });

    it('should not go below 0', () => {
      expect(calculateHeroDamage(1, 5)).toBe(0);
    });
  });
});

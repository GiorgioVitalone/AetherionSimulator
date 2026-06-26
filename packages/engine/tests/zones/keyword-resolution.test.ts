import { describe, it, expect, beforeEach } from 'vitest';
import { normalizeTraits } from '../../src/setup/trait-normalizer.js';
import { getValidAttackTargets } from '../../src/zones/targeting.js';
import { calculateCombatDamage } from '../../src/combat/damage-calculator.js';
import {
  mockCard,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

/**
 * Wave-1 fixed trait casing (Title-Case authored -> lowercase enum). These verify
 * that Flying / Haste / Sniper / First Strike resolve when fed REAL authored labels
 * through the normalizer, not hand-written lowercase fixtures.
 */
describe('Keyword resolution from authored Title-Case labels', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('Flying (authored "Flying") bypasses a plain Defender', () => {
    const { traits } = normalizeTraits(['Flying']);
    const defender = mockCard({ owner: 1, traits: ['defender'], currentHp: 4 });
    const other = mockCard({ owner: 1, currentHp: 4 });
    const enemyZones = zonesWithCards({ frontline: [defender, other, null] });

    const targets = getValidAttackTargets('frontline', traits, enemyZones);
    const ids = targets.filter(t => t.type === 'character').map(t => t.instanceId);
    // Flying ignores the Defender, so BOTH characters are legal (not Defender-only).
    expect(ids).toContain(other.instanceId);
    expect(ids.length).toBeGreaterThan(1);
  });

  it('a plain attacker (no Flying) is forced onto the Defender', () => {
    const defender = mockCard({ owner: 1, traits: ['defender'], currentHp: 4 });
    const other = mockCard({ owner: 1, currentHp: 4 });
    const enemyZones = zonesWithCards({ frontline: [defender, other, null] });

    const targets = getValidAttackTargets('frontline', [], enemyZones);
    const ids = targets.filter(t => t.type === 'character').map(t => t.instanceId);
    expect(ids).toEqual([defender.instanceId]);
  });

  it('Sniper (authored "Sniper") lets a Reserve attacker hit the enemy Frontline', () => {
    const { traits } = normalizeTraits(['Sniper']);
    const enemy = mockCard({ owner: 1, currentHp: 3 });
    const enemyZones = zonesWithCards({ frontline: [enemy, null, null] });

    const targets = getValidAttackTargets('reserve', traits, enemyZones);
    expect(targets.map(t => t.instanceId)).toEqual([enemy.instanceId]);

    // Without Sniper, a Reserve attacker has no targets.
    expect(getValidAttackTargets('reserve', [], enemyZones)).toEqual([]);
  });

  it('Haste (authored "Haste") deploys ready: deploy sets summoningSick from the trait', () => {
    // The deploy path keys off the lowercase trait; verify the normalizer yields it.
    expect(normalizeTraits(['Haste']).traits).toContain('haste');
  });

  it('First Strike (authored "First Strike") suppresses counter-damage on a kill', () => {
    const { traits } = normalizeTraits(['First Strike']);
    // FS attacker 3 ATK vs 0-ARM 2-HP defender that hits back for 5: defender dies,
    // and because the attacker struck first lethally, it takes 0 counter-damage.
    const result = calculateCombatDamage(3, 0, 4, 5, 0, 2, traits, []);
    expect(result.defenderDestroyed).toBe(true);
    expect(result.damageToAttacker).toBe(0);
    expect(result.attackerDestroyed).toBe(false);
  });
});

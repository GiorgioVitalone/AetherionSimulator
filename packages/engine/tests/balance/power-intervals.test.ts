import { describe, expect, it } from 'vitest';
import { computeCardPower } from '../../src/balance/card-power.js';
import { CARD_TO_HAND } from '../../src/balance/weights.js';
import { body, card, enemyCharacter, fixed, triggered } from './factory.js';

describe('computeCardPower — §S3 power intervals + context flags', () => {
  it('vanilla body: powerLow === power === powerHigh, no flags (bit-identical pre-S3 pin)', () => {
    const p = computeCardPower(body(1, 'Vanilla', 4, 4));
    expect(p.power).toBeCloseTo(8); // pre-S3 pin (card-power.test.ts)
    expect(p.powerLow).toBeCloseTo(p.power);
    expect(p.powerHigh).toBeCloseTo(p.power);
    expect(p.flags).toEqual([]);
  });

  it('conditional effect: low <= point <= high, strictly widened; point unchanged', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'conditional',
        condition: { type: 'is_alive' },
        ifTrue: [{ type: 'destroy', target: enemyCharacter }],
      },
    ]);
    const p = computeCardPower(card({ id: 2, name: 'Conditional', abilities: [ability] }));
    expect(p.power).toBeCloseTo(0.6 * 5.5); // pre-S3 CONDITIONAL_P midpoint, unchanged
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('tutor card: selection flag; high >= point >= low >= blind-draw value', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      { type: 'search_deck', filter: {}, destination: 'hand' },
    ]);
    const p = computeCardPower(card({ id: 3, name: 'Tutor', abilities: [ability] }));
    expect(p.flags).toContain('selection');
    expect(p.powerHigh).toBeGreaterThanOrEqual(p.power);
    expect(p.power).toBeGreaterThanOrEqual(p.powerLow);
    expect(p.powerLow).toBeGreaterThanOrEqual(CARD_TO_HAND);
  });

  it('search_deck with castFreeIfCost: free_cast + selection flags', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      { type: 'search_deck', filter: {}, destination: 'hand', castFreeIfCost: 3 },
    ]);
    const p = computeCardPower(card({ id: 4, name: 'FreeTutor', abilities: [ability] }));
    expect(p.flags).toContain('free_cast');
    expect(p.flags).toContain('selection');
  });

  it('copy_card / return_from_discard: recursion flag', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      { type: 'copy_card', source: 'discard', destination: 'hand' },
    ]);
    const p = computeCardPower(card({ id: 5, name: 'Copier', abilities: [ability] }));
    expect(p.flags).toContain('recursion');
  });

  it('cost-reduction aura: free_cast flag', () => {
    const ability = {
      type: 'aura' as const,
      effects: [
        {
          type: 'cost_reduction' as const,
          reduction: 1,
          appliesTo: { cardType: 'C' as const },
          duration: { type: 'permanent' as const },
        },
      ],
    };
    const p = computeCardPower(card({ id: 6, name: 'CostReducer', abilities: [ability] }));
    expect(p.flags).toContain('free_cast');
  });

  it('ARM body: rules_sensitive flagged, no interval widening (flag-only)', () => {
    const p = computeCardPower(body(7, 'Armored', 2, 2, 2));
    expect(p.flags).toContain('rules_sensitive');
    expect(p.powerLow).toBeCloseTo(p.power);
    expect(p.powerHigh).toBeCloseTo(p.power);
  });

  it('does not flag a vanilla Defender as rules_sensitive (no ARM, no shield)', () => {
    const p = computeCardPower(body(8, 'PlainWall', 1, 2, 0, { traits: ['defender'] }));
    expect(p.flags).not.toContain('rules_sensitive');
  });

  it('handles every card-power.test.ts fixture without changing power (regression pin)', () => {
    expect(computeCardPower(body(9, 'Vanilla2', 4, 4)).power).toBeCloseTo(8);
    expect(computeCardPower(body(10, 'Armored2', 2, 2, 2)).statBase).toBeCloseTo(6.0);
  });

  it('sums 2 damage as a dynamic-amount-free chip (no flag on fixed amounts)', () => {
    const p = computeCardPower(
      card({
        id: 11,
        name: 'ChipDamage',
        abilities: [
          triggered({ type: 'on_deploy' }, [
            { type: 'deal_damage', amount: fixed(2), target: enemyCharacter },
          ]),
        ],
      }),
    );
    expect(p.flags).toEqual([]);
    expect(p.powerLow).toBeCloseTo(p.power);
    expect(p.powerHigh).toBeCloseTo(p.power);
  });
});

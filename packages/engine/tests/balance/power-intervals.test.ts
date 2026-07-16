import { describe, expect, it } from 'vitest';
import { computeCardPower } from '../../src/balance/card-power.js';
import { CARD_TO_HAND } from '../../src/balance/weights.js';
import { alliedCharacter, body, card, enemyCharacter, fixed, triggered } from './factory.js';

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

  // ── §P1 (R3 fix): wrapper flag propagation ─────────────────────────────────
  // Round-3 auditor probe: scheduled/replacement/grant_ability wrappers
  // returned a FLAT result with NO flags, dropping any risky shape nested
  // inside them; choose_one only kept the BEST option's flags, dropping any
  // in the non-selected branch.

  it('choose_one propagates flags from a NON-selected (lower-value) option', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'choose_one',
        options: [
          {
            label: 'big-but-plain',
            effects: [{ type: 'deal_damage', amount: fixed(3), target: enemyCharacter }],
          },
          {
            label: 'small-but-tutor',
            effects: [{ type: 'search_deck', filter: {}, destination: 'hand' }],
          },
        ],
      },
    ]);
    const p = computeCardPower(card({ id: 20, name: 'HiddenTutor', abilities: [ability] }));
    expect(p.flags).toContain('selection');
  });

  it('scheduled effect propagates flags from its nested effects', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'scheduled',
        timing: { type: 'next_turn_start' },
        effects: [{ type: 'copy_card', source: 'discard', destination: 'hand' }],
      },
    ]);
    const p = computeCardPower(card({ id: 21, name: 'ScheduledCopier', abilities: [ability] }));
    expect(p.flags).toContain('recursion');
  });

  it('replacement (on_would_be_destroyed) propagates flags from its `instead` effects', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'replacement',
        replaces: { type: 'on_would_be_destroyed' },
        instead: [{ type: 'search_deck', filter: {}, destination: 'hand' }],
      },
    ]);
    const p = computeCardPower(card({ id: 22, name: 'ReplacementTutor', abilities: [ability] }));
    expect(p.flags).toContain('selection');
  });

  it('grant_ability propagates flags from the granted ability nested effects', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'grant_ability',
        target: enemyCharacter,
        duration: { type: 'permanent' },
        ability: {
          trigger: { type: 'on_deploy' },
          effects: [{ type: 'copy_card', source: 'discard', destination: 'hand' }],
        },
      },
    ]);
    const p = computeCardPower(card({ id: 23, name: 'GrantedCopier', abilities: [ability] }));
    expect(p.flags).toContain('recursion');
  });

  // ── §V2 (round-7): uncertainty survives ability-level gates + more wrappers ─

  it('§V2(a): an ability-level Condition flags conditional and widens the interval (was flag-less and unwidened)', () => {
    const ability = triggered(
      { type: 'on_deploy' },
      [{ type: 'destroy', target: enemyCharacter }],
      { condition: { type: 'is_alive' } },
    );
    const p = computeCardPower(card({ id: 30, name: 'GatedRemoval', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§V2(a): an aura-level Condition also flags conditional + widens', () => {
    const ability = {
      type: 'aura' as const,
      condition: { type: 'is_alive' as const },
      effects: [{ type: 'modify_stats' as const, modifier: { atk: 1 }, target: alliedCharacter }],
    };
    const p = computeCardPower(card({ id: 31, name: 'GatedAura', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThanOrEqual(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§V2(b): stat_grant.dynamicModifier is priced (was silently ignored) and flags dynamic_amount', () => {
    const ability = {
      type: 'stat_grant' as const,
      modifier: {},
      dynamicModifier: { type: 'per_count' as const, valuePerCount: 1 },
    };
    const p = computeCardPower(
      card({ id: 32, name: 'DynamicEquip', cardType: 'E', abilities: [ability] }),
    );
    expect(p.abilityValue).toBeGreaterThan(0);
    expect(p.flags).toContain('dynamic_amount');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§V2(c): scheduled propagates nested conditional/dynamic_amount flags AND widens the interval (not just flags)', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'scheduled',
        timing: { type: 'next_turn_start' },
        effects: [{ type: 'deal_damage', amount: { type: 'x_cost' }, target: enemyCharacter }],
      },
    ]);
    const p = computeCardPower(card({ id: 33, name: 'ScheduledDynamic', abilities: [ability] }));
    expect(p.flags).toContain('dynamic_amount');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§V2(c): grant_ability propagates nested conditional flags AND widens the interval', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'grant_ability',
        target: enemyCharacter,
        duration: { type: 'permanent' },
        ability: {
          trigger: { type: 'on_deploy' },
          effects: [
            {
              type: 'conditional',
              condition: { type: 'is_alive' },
              ifTrue: [{ type: 'destroy', target: enemyCharacter }],
            },
          ],
        },
      },
    ]);
    const p = computeCardPower(card({ id: 34, name: 'GrantedConditional', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§V2(c): replacement (on_would_be_destroyed) propagates nested dynamic_amount flags AND widens the interval', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'replacement',
        replaces: { type: 'on_would_be_destroyed' },
        instead: [{ type: 'deal_damage', amount: { type: 'x_cost' }, target: enemyCharacter }],
      },
    ]);
    const p = computeCardPower(card({ id: 35, name: 'ReplacementDynamic', abilities: [ability] }));
    expect(p.flags).toContain('dynamic_amount');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });
});

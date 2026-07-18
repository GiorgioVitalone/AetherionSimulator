import { describe, expect, it } from 'vitest';
import { computeCardPower } from '../../src/balance/card-power.js';
import { effectStaticValueDetailed } from '../../src/balance/effect-interval.js';
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
      effects: [
        {
          type: 'modify_stats' as const,
          modifier: { atk: 1 },
          target: alliedCharacter,
          duration: { type: 'until_end_of_turn' as const },
        },
      ],
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

  // ── §W1 (round-8 fix): grant_ability must honor the GRANTED ability's OWN
  // condition — a distinct field from a `conditional` effect nested inside
  // the granted effects (already covered above by §V2(c)). The runtime
  // (interpreter.ts's grantAbilityToCard) wires ref.condition straight into
  // the registered trigger's condition, so a conditionally-granted ability
  // that static valuation scores flat/flagless is falsely precise.

  it('§W1: grant_ability with a condition on the GRANTED ability itself is flagged conditional and widened (not flat/flagless)', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'grant_ability',
        target: enemyCharacter,
        duration: { type: 'permanent' },
        ability: {
          trigger: { type: 'on_deploy' },
          effects: [{ type: 'destroy', target: enemyCharacter }],
          condition: { type: 'is_alive' },
        },
      },
    ]);
    const p = computeCardPower(card({ id: 36, name: 'GatedGrant', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§W1/§H1-5 (round-13 correction): a grant_ability with NO condition stays flat on LOW but its HIGH widens to the granted effect\'s own magnitude (was falsely flat — the granted "deal 2" is worth more than FLAT_ONE)', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'grant_ability',
        target: enemyCharacter,
        duration: { type: 'permanent' },
        ability: {
          trigger: { type: 'on_deploy' },
          effects: [{ type: 'deal_damage', amount: fixed(2), target: enemyCharacter }],
        },
      },
    ]);
    const p = computeCardPower(card({ id: 37, name: 'UngatedGrant', abilities: [ability] }));
    expect(p.flags).not.toContain('conditional');
    expect(p.powerLow).toBeCloseTo(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
    expect(p.powerHigh).toBeCloseTo(2); // nested magnitude (2 chip dmg) × on_deploy recurrence (1.0)
  });

  // ── §W2 (round-8 fix): widenFlatByNested must not divide by a negative or
  // zero nested.value — property-style checks across sign cases, exercised
  // through effectStaticValueDetailed's 'scheduled' wrapper (uses
  // widenFlatByNested internally; scheduled's own value stays flat by design,
  // so any low/high spread observed here comes purely from the widening).

  it('§W2: POSITIVE nested value widens low <= flat <= high', () => {
    const d = effectStaticValueDetailed({
      type: 'scheduled',
      timing: { type: 'next_turn_start' },
      effects: [
        {
          type: 'conditional',
          condition: { type: 'is_alive' },
          ifTrue: [{ type: 'deal_damage', amount: fixed(3), target: enemyCharacter }],
        },
      ],
    });
    expect(d.low).toBeLessThanOrEqual(d.value);
    expect(d.high).toBeGreaterThanOrEqual(d.value);
    expect(d.high).toBeGreaterThan(d.low);
  });

  it('§W2: NEGATIVE nested value (round-8 probe shape) does NOT collapse the spread', () => {
    // Mirrors the disproof probe {value:-0.3, low:-0.5, high:0}: a conditional
    // whose ifTrue is an allied sacrifice (negative point value) and no
    // ifFalse produces nested = {value: CONDITIONAL_P * neg, low: neg, high: 0}
    // — entirely non-positive, exactly the case the old ratio-based formula
    // (dividing by nested.value) collapsed to a flat point.
    const d = effectStaticValueDetailed({
      type: 'scheduled',
      timing: { type: 'next_turn_start' },
      effects: [
        {
          type: 'conditional',
          condition: { type: 'is_alive' },
          ifTrue: [{ type: 'sacrifice', target: alliedCharacter }],
        },
      ],
    });
    expect(d.low).toBeLessThan(d.value);
    expect(d.high).toBeGreaterThan(d.value);
  });

  it('§W2/§H1-4 (round-13 correction): ZERO INTERNAL nested spread still widens HIGH to the nested magnitude (was falsely flat — "next turn, deal 2" is worth more than FLAT_ONE even with no spread of its own)', () => {
    const d = effectStaticValueDetailed({
      type: 'scheduled',
      timing: { type: 'next_turn_start' },
      effects: [{ type: 'deal_damage', amount: fixed(2), target: enemyCharacter }],
    });
    expect(d.low).toBeCloseTo(d.value);
    expect(d.high).toBeGreaterThan(d.value);
    expect(d.high).toBeCloseTo(2); // nested chip-damage magnitude
  });

  it('§W2: MIXED-sign nested range (low negative, high positive) widens on both sides', () => {
    const d = effectStaticValueDetailed({
      type: 'scheduled',
      timing: { type: 'next_turn_start' },
      effects: [
        {
          type: 'conditional',
          condition: { type: 'is_alive' },
          ifTrue: [{ type: 'sacrifice', target: alliedCharacter }],
          ifFalse: [{ type: 'deal_damage', amount: fixed(3), target: enemyCharacter }],
        },
      ],
    });
    expect(d.low).toBeLessThan(d.value);
    expect(d.high).toBeGreaterThan(d.value);
  });

  // ── §X1 (round-9 fix): ScheduledEffect.condition — the runtime enforces it
  // (scheduled-handler.ts's ScheduledEntry + upkeep gate) but static valuation
  // ignored it entirely: a conditionally-scheduled effect (live-shaped Mana
  // Tide) scored flat/flagless just like an unconditional one. Same policy as
  // §W1's grant_ability condition.

  it('§X1: scheduled with a condition on the effect itself is flagged conditional and widened (Mana Tide shape, not flat/flagless)', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'scheduled',
        timing: { type: 'next_turn_start' },
        effects: [{ type: 'gain_resource', amount: 1 }],
        condition: { type: 'is_alive' },
      },
    ]);
    const p = computeCardPower(card({ id: 40, name: 'ManaTide', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  it('§X1/§H1-4 (round-13 correction): a scheduled effect with NO condition stays flat on LOW but its HIGH widens to the nested magnitude (was falsely flat)', () => {
    const ability = triggered({ type: 'on_deploy' }, [
      {
        type: 'scheduled',
        timing: { type: 'next_turn_start' },
        effects: [{ type: 'gain_resource', amount: 1 }],
      },
    ]);
    const p = computeCardPower(card({ id: 41, name: 'UngatedSchedule', abilities: [ability] }));
    expect(p.flags).not.toContain('conditional');
    expect(p.powerLow).toBeCloseTo(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
    expect(p.powerHigh).toBeCloseTo(1.5); // nested gain_resource magnitude (1 × RESOURCE_VALUE)
  });

  // ── §X1: WhileCondition — a conditional aura can ALSO be expressed as a
  // TriggeredAbilityDSL whose `trigger` is `{ type: 'while', condition }`
  // instead of AuraAbilityDSL's own `condition` field (triggers.ts's comment:
  // "for unconditional auras, use AuraAbilityDSL directly"). recurrence()'s
  // conditionFactor previously only inspected the ability-level `condition`,
  // missing this trigger-embedded one entirely.

  it('§X1: a `while` trigger with its OWN condition is flagged conditional and widened (not flat/flagless)', () => {
    const ability = triggered({ type: 'while', condition: { type: 'is_alive' } }, [
      { type: 'deal_damage', amount: fixed(2), target: enemyCharacter },
    ]);
    const p = computeCardPower(card({ id: 42, name: 'WhileGated', abilities: [ability] }));
    expect(p.flags).toContain('conditional');
    expect(p.powerLow).toBeLessThan(p.power);
    expect(p.powerHigh).toBeGreaterThan(p.power);
  });

  // ── §X3 (round-9 fix): `count max:-1` (DSL-legal — `max` is typed as a bare
  // optional number, unvalidated by the runtime) previously drove
  // amountValDetailed's `count` branch to {value:-1, low:0, high:-1} — an
  // INVERTED range (high < low) that widenFlatByNested's Math.max(0, …)
  // clamps collapsed to a falsely-precise value === low === high. A
  // malformed max must widen conservatively (dynamic, standard spread) and
  // keep dynamic_amount, never collapse to false precision.

  it('§X3: count max:-1 (malformed) widens conservatively and keeps dynamic_amount (not collapsed to a point)', () => {
    const d = effectStaticValueDetailed({
      type: 'deal_damage',
      amount: {
        type: 'count',
        counting: { type: 'cards_in_zone', zone: 'hand', side: 'allied' },
        max: -1,
      },
      target: enemyCharacter,
    });
    expect(d.flags).toContain('dynamic_amount');
    expect(d.low).toBeLessThanOrEqual(d.value);
    expect(d.high).toBeGreaterThanOrEqual(d.value);
    expect(d.high).toBeGreaterThan(d.low);
  });

  it('§X3: count with NO max is unaffected (regression, same behavior as before)', () => {
    const d = effectStaticValueDetailed({
      type: 'deal_damage',
      amount: { type: 'count', counting: { type: 'cards_in_zone', zone: 'hand', side: 'allied' } },
      target: enemyCharacter,
    });
    expect(d.flags).toContain('dynamic_amount');
    expect(d.low).toBeLessThanOrEqual(d.value);
    expect(d.high).toBeGreaterThanOrEqual(d.value);
  });

  // ── §R12-4 (round-14 fix): equals_stat/multiply dynamicModifier cases were
  // priced as zero-width, unflagged fixed points, though the runtime
  // (amount-evaluator.ts) grants the TARGET'S LIVE stat / scales with each
  // live target's stats. Widened to the same [midpoint-unchanged, honest
  // high] + 'dynamic_amount' policy the other dynamic-amount cases use.

  it('§R12-4: equals_stat dynamicModifier widens the interval and flags dynamic_amount (was zero-width, unflagged)', () => {
    const d = effectStaticValueDetailed({
      type: 'modify_stats',
      modifier: {},
      dynamicModifier: { type: 'equals_stat', stat: 'atk', sourceRef: 'hp' },
      target: alliedCharacter,
      duration: { type: 'until_end_of_turn' },
    });
    expect(d.flags).toContain('dynamic_amount');
    expect(d.low).toBeLessThan(d.value);
    expect(d.high).toBeGreaterThan(d.value);
  });

  it('§R12-4: multiply(factor 2) dynamicModifier widens the interval and flags dynamic_amount (was zero-width, unflagged)', () => {
    const d = effectStaticValueDetailed({
      type: 'modify_stats',
      modifier: {},
      dynamicModifier: { type: 'multiply', factor: 2 },
      target: alliedCharacter,
      duration: { type: 'until_end_of_turn' },
    });
    expect(d.flags).toContain('dynamic_amount');
    expect(d.low).toBeLessThan(d.value);
    expect(d.high).toBeGreaterThan(d.value);
  });

  it('§X3: count with a valid (non-negative) max is unaffected (regression)', () => {
    const d = effectStaticValueDetailed({
      type: 'deal_damage',
      amount: {
        type: 'count',
        counting: { type: 'cards_in_zone', zone: 'hand', side: 'allied' },
        max: 3,
      },
      target: enemyCharacter,
    });
    expect(d.flags).toContain('dynamic_amount');
    expect(d.low).toBeLessThanOrEqual(d.value);
    expect(d.high).toBeGreaterThanOrEqual(d.value);
  });
});

// Round-8 review exact-value pin (effect level, no recurrence entanglement):
// a conditionally-granted flat ability spans [0, UNDISCOUNTED flat] around the
// CONDITION_DISCOUNT midpoint — the high is the full value, NOT value/0.7^2
// (an erroneous extra `/ CONDITION_DISCOUNT` once inflated it 1.43x).
// §H1-5 (round-13 correction): that "undiscounted flat" ceiling (FLAT_ONE)
// was ITSELF falsely precise — the granted effect here (`destroy enemy`) is
// worth AVG_ENEMY_BODY*REMOVAL_WEIGHT=5.5, not 1.0, and the granted ability's
// own on_deploy recurrence is 1.0x (fires once per grant). The high pin below
// is updated to 5.5 (previously 1.0) to reflect widenFlatByNested/grant_ability
// now reaching at least the nested payload's own magnitude — see effect-
// interval.ts's H1-4/H1-5/H1-6 comments.
import { effectStaticValueDetailed as __w1Probe } from '../../src/balance/effect-interval.js';
describe('§W1 exact band (round-8 review, round-13 corrected)', () => {
  it('spans [0, magnitude-widened undiscounted high] around the discounted midpoint', () => {
    const v = __w1Probe({
      type: 'grant_ability',
      target: { type: 'target_character', side: 'allied' },
      duration: { type: 'permanent' },
      ability: {
        trigger: { type: 'on_deploy' },
        effects: [{ type: 'destroy', target: { type: 'target_character', side: 'enemy' } }],
        condition: { type: 'is_alive' },
      },
    } as never);
    expect(v.value).toBeCloseTo(1.0 * 0.7, 5); // FLAT_ONE × CONDITION_DISCOUNT (unchanged)
    expect(v.low).toBe(0);
    expect(v.high).toBeCloseTo(5.5, 5); // nested `destroy enemy` magnitude × on_deploy recurrence (1.0)
  });
});

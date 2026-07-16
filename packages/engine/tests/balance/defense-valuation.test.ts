/**
 * §S2 — defense valued under ruleset v1: ARM is first-instance-per-turn
 * (armFirstInstanceOnly, locked); shields are PER-INSTANCE (the engine's
 * unconfigured default — shieldFirstInstanceOnly is NOT in the v1 manifest;
 * round-5 correction, see valuation-profile.ts). Before the original S2 fix,
 * W_ARM=1.3 and the shield 'replacement' case carried a justification
 * describing the engine-DEFAULT per-instance rule as if it were repealed for
 * BOTH ARM and shields; that was only ever true for ARM. Pure unit tests of
 * the pricer's output — no simulations.
 */
import { describe, expect, it } from 'vitest';
import { computeCardPower, abilityContribution } from '../../src/balance/card-power.js';
import { effectStaticValue } from '../../src/balance/effect-value.js';
import { traitValue } from '../../src/balance/trait-scaling.js';
import { recurrence, SHIELD_INSTANCES_PER_TURN, W_ARM, W_HP } from '../../src/balance/weights.js';
import { VALUATION_PROFILE_V1 } from '../../src/balance/valuation-profile.js';
import type { Effect } from '../../src/types/effects.js';
import { aura, body } from './factory.js';

describe('§S2 defense valuation (v1: first-instance-per-turn)', () => {
  it('W_ARM sits at parity with W_HP, not the repealed multi-hit premium', () => {
    // A naive per-hit model (the repealed premise: ARM absorbs EVERY combat
    // instance a turn, not just the first) would scale ARM's contribution by
    // an assumed hits-per-turn factor > 1. The corrected, single-instance-cap
    // model never does that — it is flat per point, same unit as HP/ATK.
    const ASSUMED_GANG_HITS_PER_TURN = 2; // the exact repealed premise's shape
    for (const arm of [1, 5]) {
      const actual = arm * W_ARM;
      const naiveMultiHit = arm * W_ARM * ASSUMED_GANG_HITS_PER_TURN;
      expect(actual).toBeLessThan(naiveMultiHit);
    }
    expect(W_ARM).toBeCloseTo(W_HP);
  });

  it('ARM contribution to statBase scales sub-linearly vs a naive per-hit model at both low and high ARM', () => {
    const lowArm = computeCardPower(body(101, 'Low', 0, 0, 1)).statBase;
    const highArm = computeCardPower(body(102, 'High', 0, 0, 5)).statBase;
    // Naive per-hit model: each point absorbs damage on every one of an
    // assumed 2 hits/turn, i.e. 2x the corrected flat value.
    expect(lowArm).toBeLessThan(1 * W_ARM * 2);
    expect(highArm).toBeLessThan(5 * W_ARM * 2);
    // Linear in ARM points either way (no hidden multi-hit scaling snuck in).
    expect(highArm).toBeCloseTo(5 * lowArm, 10);
  });

  it('a shield replacement (EC-003, reduction=1) values as SHIELD_INSTANCES_PER_TURN mitigated hits (per-instance under v1), recurrence-scaled by the SAME aura anchor as any other continuous effect', () => {
    const shieldEffect: Effect = {
      type: 'replacement',
      replaces: { type: 'on_would_take_damage', reduction: 1 },
      instead: [],
    };
    // Per-turn value: reduction x SHIELD_INSTANCES_PER_TURN (v1 has no
    // shieldFirstInstanceOnly lock, so every combat instance is mitigated).
    expect(effectStaticValue(shieldEffect).value).toBeCloseTo(
      1 * VALUATION_PROFILE_V1.shieldMitigatedDamagePerPointPerTurn,
    );
    expect(VALUATION_PROFILE_V1.shieldMitigatedDamagePerPointPerTurn).toBe(
      SHIELD_INSTANCES_PER_TURN,
    );

    // Wrapped as an aura ability (how both Shieldbearer Paladin and Radiant
    // Shield encode it) — total value = reduction x instances-per-turn x
    // expectedActiveTurns, the profile's reused anchors, no separately
    // invented turns constant.
    const shieldAbility = aura([shieldEffect]);
    expect(abilityContribution(shieldAbility)).toBeCloseTo(
      1 * SHIELD_INSTANCES_PER_TURN * VALUATION_PROFILE_V1.expectedActiveTurns,
      10,
    );
    expect(abilityContribution(shieldAbility)).toBeCloseTo(
      SHIELD_INSTANCES_PER_TURN * recurrence(shieldAbility),
      10,
    );
  });

  it('a shield replacement scales linearly with its declared reduction amount', () => {
    const oneVal = effectStaticValue({
      type: 'replacement',
      replaces: { type: 'on_would_take_damage', reduction: 1 },
      instead: [],
    }).value;
    const twoVal = effectStaticValue({
      type: 'replacement',
      replaces: { type: 'on_would_take_damage', reduction: 2 },
      instead: [],
    }).value;
    expect(twoVal).toBeCloseTo(2 * oneVal, 10);
  });

  it('an on_would_be_destroyed replacement is unaffected (different mechanic, generic FLAT bucket)', () => {
    const v = effectStaticValue({
      type: 'replacement',
      replaces: { type: 'on_would_be_destroyed' },
      instead: [],
    }).value;
    expect(v).toBeCloseTo(1); // FLAT_ONE, unchanged
  });

  it('Defender premium weights ARM by W_ARM, not a flat 1:1 with HP', () => {
    const armored = traitValue('defender', { atk: 0, hp: 0, arm: 2 }, {});
    expect(armored).toBeCloseTo(0.6 * 2 * W_ARM, 10);
  });

  it('S2/round-5 fixture bodies equivalent to the flagged Radiant trio (ids 47/48/49): non-shield power does NOT increase; the Shieldbearer-style shield card is re-derived for per-instance shields', () => {
    // None of Shieldbearer Paladin (48), Protector of Faith (47), or
    // Faithkeeper of Dawn (49) print ARM > 0 in the live pool — their
    // "armor identity" comes from the Defender trait (arm=0, so W_ARM never
    // enters). id48's shield aura (reduction=1) now prices as per-instance
    // (SHIELD_INSTANCES_PER_TURN x AURA_REC, the round-5 re-derivation) rather
    // than the old first-instance-only (1 x AURA_REC) bucket — this is the
    // corrected value, not a regression. Protector/Faithkeeper carry no
    // shield, so their power is untouched by this fix.
    const shieldAbility = aura([
      {
        type: 'replacement',
        replaces: { type: 'on_would_take_damage', reduction: 1 },
        instead: [],
      },
    ]);
    const shieldbearer = computeCardPower(
      body(48, 'Shieldbearer Paladin', 2, 3, 0, {
        traits: ['defender'],
        abilities: [shieldAbility],
      }),
    );
    const protector = computeCardPower(
      body(47, 'Protector of Faith', 1, 3, 0, { traits: ['defender'] }),
    );
    const faithkeeper = computeCardPower(
      body(49, 'Faithkeeper of Dawn', 2, 4, 0, { traits: ['defender'] }),
    );
    expect(shieldbearer.statBase).toBeCloseTo(2 + 3, 10);
    expect(shieldbearer.traitValue).toBeCloseTo(0.6 * 3, 10);
    expect(shieldbearer.abilityValue).toBeCloseTo(
      1 * SHIELD_INSTANCES_PER_TURN * VALUATION_PROFILE_V1.expectedActiveTurns,
      10,
    );
    expect(protector.power).toBeCloseTo(1 + 3 + 0.6 * 3, 10);
    expect(faithkeeper.power).toBeCloseTo(2 + 4 + 0.6 * 4, 10);
  });
});

// Round-5 review hunt (2026-07-16): a negative shield `reduction` is nonsense
// data and must clamp to 0, never subtract defense.
import { effectStaticValueDetailed as __negProbe } from '../../src/balance/effect-interval.js';
describe('negative shield reduction clamps to zero', () => {
  it('values a reduction:-3 shield at 0, not −6', () => {
    const v = __negProbe({
      type: 'replacement',
      replaces: { type: 'on_would_take_damage', reduction: -3 },
      instead: [],
    } as never);
    expect(v.value).toBe(0);
  });
});

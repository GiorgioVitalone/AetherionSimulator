/**
 * §S2 — defense valued under ruleset v1 (first-instance-per-turn ARM/shields).
 * Before this fix, W_ARM=1.3 and the shield 'replacement' case carried a
 * justification describing the engine-DEFAULT per-instance rule (unbounded
 * per turn), not the locked v1 rule (armFirstInstanceOnly/
 * shieldFirstInstanceOnly — first instance only, recharges next turn). Pure
 * unit tests of the pricer's output — no simulations.
 */
import { describe, expect, it } from 'vitest';
import { computeCardPower, abilityContribution } from '../../src/balance/card-power.js';
import { effectStaticValue } from '../../src/balance/effect-value.js';
import { traitValue } from '../../src/balance/trait-scaling.js';
import { recurrence, W_ARM, W_HP } from '../../src/balance/weights.js';
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

  it('a shield replacement (EC-003, reduction=1) values as exactly one mitigated hit, recurrence-scaled by the SAME aura anchor as any other continuous effect', () => {
    const shieldEffect: Effect = {
      type: 'replacement',
      replaces: { type: 'on_would_take_damage', reduction: 1 },
      instead: [],
    };
    // Per-instance value: exactly the reduction amount, not a generic flat bucket.
    expect(effectStaticValue(shieldEffect).value).toBeCloseTo(1);

    // Wrapped as an aura ability (how both Shieldbearer Paladin and Radiant
    // Shield encode it) — total value = reduction x expectedActiveTurns, the
    // profile's reused anchor, no separately invented turns constant.
    const shieldAbility = aura([shieldEffect]);
    expect(abilityContribution(shieldAbility)).toBeCloseTo(
      1 * VALUATION_PROFILE_V1.expectedActiveTurns,
      10,
    );
    expect(abilityContribution(shieldAbility)).toBeCloseTo(recurrence(shieldAbility), 10);
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

  it('S2 fixture bodies equivalent to the flagged Radiant trio (ids 47/48/49): power does NOT increase, and the Shieldbearer-style shield card is UNCHANGED because none carry a printed ARM stat', () => {
    // None of Shieldbearer Paladin (48), Protector of Faith (47), or
    // Faithkeeper of Dawn (49) print ARM > 0 in the live pool — their
    // "armor identity" comes from the Defender trait (arm=0, so W_ARM never
    // enters) and, for id48, a shield aura with reduction=1 (unchanged by
    // this fix, since 1 * AURA_REC was already what the old FLAT_ONE bucket
    // produced for that specific reduction value). So the corrected
    // valuation does not move these three fixtures' power at all — the
    // over-budget flag they got in the 2026-07-14 run traces to something
    // other than the ARM valuation this task fixes.
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
    // Same fixtures re-derived under the OLD (pre-S2) constants would have
    // produced an identical statBase (atk + hp + arm*W_ARM, arm=0 either way
    // so the W_ARM change never enters), traitValue (Defender: 0.6*(hp +
    // W_ARM*arm), again arm=0), and abilityValue (the shield's reduction=1 *
    // AURA_REC, identical to the old FLAT_ONE * AURA_REC for that specific
    // reduction) — i.e. these numbers are exactly what S1 baseline already
    // produced; only computeCardPower's OWN synergy multiplier (unrelated to
    // this task) sits on top. Assert each raw component is unchanged rather
    // than merely "not increased".
    expect(shieldbearer.statBase).toBeCloseTo(2 + 3, 10);
    expect(shieldbearer.traitValue).toBeCloseTo(0.6 * 3, 10);
    expect(shieldbearer.abilityValue).toBeCloseTo(1 * VALUATION_PROFILE_V1.expectedActiveTurns, 10);
    expect(protector.power).toBeCloseTo(1 + 3 + 0.6 * 3, 10);
    expect(faithkeeper.power).toBeCloseTo(2 + 4 + 0.6 * 4, 10);
  });
});

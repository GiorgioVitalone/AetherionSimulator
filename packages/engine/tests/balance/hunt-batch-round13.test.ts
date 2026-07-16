/**
 * §H1 (round-13 hunt-batch, batch W-A/valuation) — targeted regression tests
 * for the runtime-parity divergences fixed in effect-interval.ts/target-util.ts/
 * signal-extract.ts. Kept in a separate file (per the batch spec) rather than
 * growing power-intervals.test.ts further.
 */
import { describe, expect, it } from 'vitest';
import { effectStaticValueDetailed } from '../../src/balance/effect-interval.js';
import { flattenEffects } from '../../src/balance/signal-extract.js';
import { AVG_ENEMY_BODY, CARD_TO_HAND, REMOVAL_WEIGHT } from '../../src/balance/weights.js';
import { alliedCharacter, enemyCharacter, fixed } from './factory.js';

describe('§H1-1: up_to multi-target scales with count (was priced 1x)', () => {
  it('up_to-2 destroy is ~2x a single-target destroy (within the AOE_WIDTH cap)', () => {
    const single = effectStaticValueDetailed({ type: 'destroy', target: enemyCharacter });
    const upToTwo = effectStaticValueDetailed({
      type: 'destroy',
      target: { type: 'up_to', count: 2, side: 'enemy' },
    });
    expect(upToTwo.value).toBeCloseTo(single.value * 2);
    expect(upToTwo.flags).toContain('dynamic_amount');
  });

  it('up_to-1 destroy is UNCHANGED from a single target (no over-widening)', () => {
    const single = effectStaticValueDetailed({ type: 'destroy', target: enemyCharacter });
    const upToOne = effectStaticValueDetailed({
      type: 'destroy',
      target: { type: 'up_to', count: 1, side: 'enemy' },
    });
    expect(upToOne.value).toBeCloseTo(single.value);
  });

  it('up_to count is capped at the AOE_WIDTH ceiling, not unbounded', () => {
    const single = effectStaticValueDetailed({ type: 'destroy', target: enemyCharacter });
    const upToTen = effectStaticValueDetailed({
      type: 'destroy',
      target: { type: 'up_to', count: 10, side: 'enemy' },
    });
    expect(upToTen.value).toBeLessThan(single.value * 10);
  });

  it('up_to also scales deal_damage/modify_stats (buff), not just destroy', () => {
    const singleDmg = effectStaticValueDetailed({
      type: 'deal_damage',
      amount: fixed(2),
      target: enemyCharacter,
    });
    const upToDmg = effectStaticValueDetailed({
      type: 'deal_damage',
      amount: fixed(2),
      target: { type: 'up_to', count: 2, side: 'enemy' },
    });
    expect(upToDmg.value).toBeCloseTo(singleDmg.value * 2);
  });
});

describe('§H1-7: each_player discard is priced (was 0 — no `side` on the target)', () => {
  it('each_player discard is a positive, symmetric-discounted value, not 0', () => {
    const d = effectStaticValueDetailed({
      type: 'discard',
      count: 1,
      target: { type: 'each_player' },
    });
    expect(d.value).toBeGreaterThan(0);
    expect(d.flags).toContain('dynamic_amount');
  });

  it('each_player discard is discounted below a pure enemy-facing discard of the same count', () => {
    const each = effectStaticValueDetailed({
      type: 'discard',
      count: 1,
      target: { type: 'each_player' },
    });
    const enemyOnly = effectStaticValueDetailed({
      type: 'discard',
      count: 1,
      target: { type: 'player', side: 'enemy' },
    });
    expect(each.value).toBeLessThan(enemyOnly.value);
  });
});

describe('§H1-10: allied bounce is no longer a hard 0 (runtime allows self-bounce reuse)', () => {
  it('allied bounce keeps a 0 point value but widens the interval up to CARD_TO_HAND', () => {
    const d = effectStaticValueDetailed({ type: 'bounce', target: alliedCharacter });
    expect(d.value).toBe(0);
    expect(d.low).toBe(0);
    expect(d.high).toBeCloseTo(CARD_TO_HAND);
    expect(d.flags).toContain('dynamic_amount');
  });

  it('enemy bounce is unaffected (regression)', () => {
    const d = effectStaticValueDetailed({ type: 'bounce', target: enemyCharacter });
    expect(d.value).toBeCloseTo(AVG_ENEMY_BODY * 0.7 * REMOVAL_WEIGHT);
    expect(d.isRemoval).toBe(true);
  });
});

describe('§H1-13: search_deck flags free_cast for castForFree, not just castFreeIfCost', () => {
  it('castForFree:true flags free_cast (was only castFreeIfCost)', () => {
    const d = effectStaticValueDetailed({
      type: 'search_deck',
      filter: {},
      destination: 'battlefield',
      castForFree: true,
    });
    expect(d.flags).toContain('free_cast');
  });
});

describe('§H1-2/H1-3/H1-8: false-precision flat family widens HIGH, keeps the flat midpoint', () => {
  it('grant_trait widens HIGH by a trait-value heuristic (a big trait grant is not falsely flat)', () => {
    const d = effectStaticValueDetailed({
      type: 'grant_trait',
      trait: 'flying',
      target: alliedCharacter,
      duration: { type: 'permanent' },
    });
    expect(d.value).toBe(1); // FLAT_ONE midpoint unchanged
    expect(d.high).toBeGreaterThan(d.value);
    expect(d.flags).toContain('dynamic_amount');
  });

  it('apply_status (regeneration) widens HIGH via the shared regenerationValue formula', () => {
    const d = effectStaticValueDetailed({
      type: 'apply_status',
      status: 'regeneration',
      target: alliedCharacter,
      value: 2,
    });
    expect(d.value).toBe(1);
    expect(d.high).toBeGreaterThan(d.value);
  });

  it('apply_status (stunned) widens HIGH via the declared status table', () => {
    const d = effectStaticValueDetailed({
      type: 'apply_status',
      status: 'stunned',
      target: enemyCharacter,
    });
    expect(d.value).toBe(1);
    expect(d.high).toBeGreaterThan(d.value);
  });

  it('cost_reduction widens HIGH for a broad, permanent reducer (not a tag-narrow one-shot)', () => {
    const broad = effectStaticValueDetailed({
      type: 'cost_reduction',
      reduction: 1,
      appliesTo: { cardType: 'C' },
      duration: { type: 'permanent' },
    });
    const narrow = effectStaticValueDetailed({
      type: 'cost_reduction',
      reduction: 1,
      appliesTo: { cardType: 'C', tag: 'construct' },
      duration: { type: 'until_end_of_turn' },
    });
    expect(broad.value).toBe(1);
    expect(broad.high).toBeGreaterThan(broad.value);
    expect(broad.high).toBeGreaterThan(narrow.high);
  });
});

describe('§H1-9: modify_stats duration — permanent buffs widen HIGH toward the undiscounted stat unit', () => {
  it('a PERMANENT ally buff widens HIGH above the TEMPO_WEIGHT-discounted midpoint', () => {
    const d = effectStaticValueDetailed({
      type: 'modify_stats',
      modifier: { atk: 2 },
      target: alliedCharacter,
      duration: { type: 'permanent' },
    });
    expect(d.high).toBeGreaterThan(d.value);
  });

  it('an UNTIL-END-OF-TURN ally buff is unaffected (regression, not over-widened)', () => {
    const d = effectStaticValueDetailed({
      type: 'modify_stats',
      modifier: { atk: 2 },
      target: alliedCharacter,
      duration: { type: 'until_end_of_turn' },
    });
    expect(d.high).toBeCloseTo(d.value);
  });
});

describe('§H4-6: flattenEffects recurses through every declared container type', () => {
  it('still flattens a grant_ability-wrapped nested effect (compile-time exhaustiveness regression)', () => {
    const flat = flattenEffects([
      {
        type: 'grant_ability',
        target: enemyCharacter,
        duration: { type: 'permanent' },
        ability: {
          trigger: { type: 'on_deploy' },
          effects: [{ type: 'destroy', target: enemyCharacter }],
        },
      },
    ]);
    expect(flat.some((e) => e.type === 'destroy')).toBe(true);
  });
});

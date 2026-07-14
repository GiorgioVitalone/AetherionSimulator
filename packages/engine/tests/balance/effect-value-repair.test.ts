/**
 * §13 mispricing repairs — the buff-arm autopsy found every engine effect class
 * priced at ~0.7–2.0 while the cost line demands 5–15 at those costs, plus two
 * outright bugs (any-side heals priced ZERO; heal/debuff AoE width dropped).
 * Each fix is anchored to the Rulebook or an existing engine constant — none
 * fitted to win rates. These tests pin the corrected semantics.
 */
import { describe, it, expect } from 'vitest';
import { effectStaticValue } from '../../src/balance/effect-value.js';
import {
  AOE_WIDTH,
  AVG_BODY_HP,
  AVG_WEAK_BODY,
  CARD_TO_HAND,
  CARD_VALUE,
  EMPTY_SLOTS_EXPECTED,
  HEAL_URGENCY,
  RESERVE_TAP_VALUE,
  RESOURCE_VALUE,
  RESOURCE_VALUE_TEMP,
  SELECTION_PREMIUM,
  TOKEN_BODY_FACTOR,
} from '../../src/balance/weights.js';
import type { Effect } from '../../src/types/effects.js';

const fixed = (value: number) => ({ type: 'fixed', value }) as const;

describe('heal pricing (Vinecall-zero bug + missing AoE width)', () => {
  it('should price an any-side heal as beneficial, not zero', () => {
    const e: Effect = {
      type: 'heal',
      amount: fixed(2),
      target: { side: 'any', type: 'target_character', filter: { excludeSelf: true } },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(2 * HEAL_URGENCY, 10);
  });

  it('should multiply heal-all by the AoE width (Celestial Aegis)', () => {
    const e: Effect = {
      type: 'heal',
      amount: fixed(1),
      target: { side: 'allied', type: 'all_characters' },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(1 * HEAL_URGENCY * AOE_WIDTH, 10);
  });

  it('should still price enemy-side heals at zero', () => {
    const e: Effect = {
      type: 'heal',
      amount: fixed(3),
      target: { side: 'enemy', type: 'target_character' },
    };
    expect(effectStaticValue(e).value).toBe(0);
  });
});

describe('debuff pricing (sign decides, AoE counts — Haunting / Plague Burst)', () => {
  it('should include the dynamic part of an any-side debuff', () => {
    // Haunting: -1 ATK plus -1 per character destroyed this turn (expected 2).
    const e: Effect = {
      type: 'modify_stats',
      target: { side: 'any', type: 'target_character' },
      duration: { type: 'until_end_of_turn' },
      modifier: { atk: -1 },
      dynamicModifier: {
        type: 'per_count',
        stat: 'atk',
        counting: { type: 'characters_destroyed_this_turn' },
        valuePerCount: -1,
      },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(Math.min(3, AVG_BODY_HP), 10);
  });

  it('should multiply an enemy AoE debuff by the AoE width (Plague Burst)', () => {
    const e: Effect = {
      type: 'modify_stats',
      target: { side: 'enemy', type: 'all_characters' },
      duration: { type: 'permanent' },
      modifier: { hp: -1, atk: -1 },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(2 * AOE_WIDTH, 10);
  });

  it('should price an allied self-drawback at zero, not as a weapon', () => {
    const e: Effect = {
      type: 'modify_stats',
      target: { side: 'allied', type: 'target_character' },
      duration: { type: 'permanent' },
      modifier: { hp: -1 },
    };
    expect(effectStaticValue(e).value).toBe(0);
  });
});

describe('multiply dynamic modifier (§13c — Synthetic Evolution was priced 0)', () => {
  it('should price doubling as adding the affected bodies once (AVG_WEAK_BODY per body)', () => {
    const e: Effect = {
      type: 'modify_stats',
      target: { side: 'allied', type: 'all_characters', filter: { tag: 'Bio-Construct' } },
      duration: { type: 'until_next_upkeep' },
      modifier: { hp: 0, atk: 0 },
      dynamicModifier: { type: 'multiply', factor: 2 },
    };
    // (factor−1) × AVG_WEAK_BODY per body × AoE width × tempo weight
    expect(effectStaticValue(e).value).toBeCloseTo(AVG_WEAK_BODY * AOE_WIDTH * 0.6, 10);
    expect(effectStaticValue(e).value).toBeGreaterThan(0);
  });
});

describe('resource pricing (Tech Bloom / temporary gains)', () => {
  it('should price a banked resource at RESOURCE_VALUE', () => {
    const e: Effect = { type: 'gain_resource', resourceType: 'energy', amount: 3 };
    expect(effectStaticValue(e).value).toBeCloseTo(3 * RESOURCE_VALUE, 10);
  });

  it('should price a temporary resource at half a banked one', () => {
    const e: Effect = { type: 'gain_resource', resourceType: 'energy', amount: 2, temporary: true };
    expect(effectStaticValue(e).value).toBeCloseTo(2 * RESOURCE_VALUE_TEMP, 10);
  });
});

describe('token pricing (Guardian Spirit / Heavenly Chorus / Reserve battery)', () => {
  it('should price token stats as real bodies with the token factor', () => {
    const e: Effect = {
      type: 'deploy_token',
      count: 2,
      token: { name: 'Sapling', atk: 1, hp: 1 },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(2 * 2 * TOKEN_BODY_FACTOR, 10);
  });

  it('should add the Reserve tap premium for Reserve tokens (Rulebook 8.4)', () => {
    const e: Effect = {
      type: 'deploy_token',
      count: 2,
      zone: 'reserve',
      token: { name: 'Sapling', atk: 1, hp: 1 },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(
      2 * (2 * TOKEN_BODY_FACTOR + RESERVE_TAP_VALUE),
      10,
    );
  });

  it('should value token traits (Heavenly Chorus Defender angels)', () => {
    const plain: Effect = { type: 'deploy_token', count: 2, token: { name: 'A', atk: 1, hp: 1 } };
    const defenders: Effect = {
      type: 'deploy_token',
      count: 2,
      token: { name: 'A', atk: 1, hp: 1, traits: ['defender'] },
    };
    expect(effectStaticValue(defenders).value).toBeGreaterThan(effectStaticValue(plain).value);
  });

  it('should expect ~2.5 empties for in-each-empty Frontline deploys', () => {
    const e: Effect = {
      type: 'deploy_token',
      inEachEmpty: true,
      zone: 'frontline',
      token: { name: 'Bio-Construct', atk: 4, hp: 1 },
    };
    expect(effectStaticValue(e).value).toBeCloseTo(
      EMPTY_SLOTS_EXPECTED * 5 * TOKEN_BODY_FACTOR,
      10,
    );
  });
});

describe('card-flow pricing (Echoes / Archivist / Necrotic Revival / counters)', () => {
  it('should give copy-from-discard a selection premium over a blind draw (§S1)', () => {
    const e: Effect = { type: 'copy_card', source: 'discard', destination: 'hand', filter: {} };
    expect(effectStaticValue(e).value).toBeCloseTo(CARD_TO_HAND * SELECTION_PREMIUM, 10);
  });

  it('should price a deck tutor as a chosen card to hand (§S1)', () => {
    const e: Effect = { type: 'search_deck', destination: 'hand', filter: {} } as Effect;
    expect(effectStaticValue(e).value).toBeCloseTo(CARD_TO_HAND * SELECTION_PREMIUM, 10);
  });

  it('should price reanimation-to-battlefield as a body plus the chosen card (§S1)', () => {
    const e: Effect = {
      type: 'return_from_discard',
      destination: 'battlefield',
      target: { side: 'allied', type: 'target_card_in_discard' },
    } as Effect;
    expect(effectStaticValue(e).value).toBeCloseTo(
      AVG_WEAK_BODY + CARD_TO_HAND * SELECTION_PREMIUM,
      10,
    );
  });

  it('should price a counterspell as a 1-for-1 with initiative, not 0.5', () => {
    const e: Effect = { type: 'counter_spell' } as Effect;
    expect(effectStaticValue(e).value).toBeCloseTo(CARD_VALUE + 0.5, 10);
  });
});

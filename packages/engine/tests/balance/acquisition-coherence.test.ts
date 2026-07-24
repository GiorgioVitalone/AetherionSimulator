/**
 * §S1 — coherent card-acquisition primitives. Before this fix, a hand-picked
 * card (tutor/copy/return) priced BELOW a blind draw, and the Discard-for-
 * Energy floor (every card in hand is worth >=1 resource) was violated by
 * several acquisition effects. These are pure unit tests of the pricer's
 * output — no simulations.
 */
import { describe, expect, it } from 'vitest';
import { effectStaticValue } from '../../src/balance/effect-value.js';
import { traitValue } from '../../src/balance/trait-scaling.js';
import { CARD_TO_HAND } from '../../src/balance/weights.js';
import type { Effect } from '../../src/types/effects.js';
import { fixed } from './factory.js';

const DISCARD_FLOOR = 1.1; // 1 resource x the spells/equip slope (see W_DRAW derivation)

const drawOne: Effect = { type: 'draw_cards', count: fixed(1), player: 'allied' };
const tutorToHand: Effect = { type: 'search_deck', destination: 'hand', filter: {} } as Effect;
const copyToHand: Effect = {
  type: 'copy_card',
  source: 'discard',
  destination: 'hand',
  filter: {},
};
const returnToHand: Effect = {
  type: 'return_from_discard',
  destination: 'hand',
  target: { side: 'allied', type: 'target_card_in_discard' },
} as Effect;
const rearrangeScry: Effect = { type: 'scry', lookCount: 2, action: { type: 'rearrange' } };
const pickToHandScry: Effect = {
  type: 'scry',
  lookCount: 2,
  action: { type: 'pick_and_remainder', pickCount: 1, pickTo: 'hand', remainder: 'bottom' },
};

describe('§S1 acquisition coherence', () => {
  it('a chosen card (tutor/copy/return) is worth at least a blind draw', () => {
    const drawValue = effectStaticValue(drawOne).value;
    expect(effectStaticValue(tutorToHand).value).toBeGreaterThanOrEqual(drawValue);
    expect(effectStaticValue(copyToHand).value).toBeGreaterThanOrEqual(drawValue);
    expect(effectStaticValue(returnToHand).value).toBeGreaterThanOrEqual(drawValue);
  });

  it('every acquisition-to-hand effect clears the Discard-for-Energy floor', () => {
    for (const e of [drawOne, tutorToHand, copyToHand, returnToHand, pickToHandScry]) {
      expect(effectStaticValue(e).value).toBeGreaterThanOrEqual(DISCARD_FLOOR);
    }
  });

  it('rearrange-only scry is worth less than a scry that puts a card in hand', () => {
    expect(effectStaticValue(rearrangeScry).value).toBeLessThan(
      effectStaticValue(pickToHandScry).value,
    );
  });

  it('recycle derives from the shared acquisition primitive (half CARD_TO_HAND)', () => {
    expect(traitValue('recycle', null, {})).toBeCloseTo(0.5 * CARD_TO_HAND, 10);
  });

  it('draw is linear: drawing 2 is exactly twice drawing 1', () => {
    const drawTwo: Effect = { type: 'draw_cards', count: fixed(2), player: 'allied' };
    expect(effectStaticValue(drawTwo).value).toBeCloseTo(2 * effectStaticValue(drawOne).value, 10);
  });
});

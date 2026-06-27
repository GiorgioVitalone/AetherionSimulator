/**
 * Fair-pilot value model (spell-eval valueMode) — proves the bot SEES control/value/
 * recursion effects under fairPilot while staying byte-identical (flat-1) when off.
 * The keystone is that wrapper effects (conditional/composite/choose_one) recurse
 * into their sub-effects and PROPAGATE isRemoval — so wrapped removal/draw/recursion
 * stop scoring as chaff. Pure-function assertions, no RNG.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { scoreSpell } from '../../src/bot/spell-eval.js';
import { gameplanFor } from '../../src/bot/gameplan.js';
import {
  mockCard,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { CardInstance, PlayerState } from '../../src/types/game-state.js';

const NEUTRAL = gameplanFor('Neutral');
const COND = {
  type: 'compare_to_opponent',
  metric: 'hand_count',
  comparison: 'less_than',
} as const;

function spell(effects: AbilityDSL['effects']): CardInstance {
  const ability = { type: 'triggered', trigger: { type: 'on_cast' }, effects } as AbilityDSL;
  return mockCard({ cardType: 'S', name: 'Test Spell', abilities: [ability] });
}
function score(card: CardInstance, valueMode: boolean, opp: PlayerState = mockPlayerState(1)) {
  return scoreSpell(mockPlayerState(0), opp, card, 0, NEUTRAL, valueMode);
}
function oppWithBody(): PlayerState {
  const body = mockCard({ owner: 1, currentAtk: 1, currentHp: 2, baseAtk: 1, baseHp: 2 });
  return mockPlayerState(1, { zones: zonesWithCards({ frontline: [body, null, null] }) });
}

describe('fair-pilot value model (valueMode)', () => {
  beforeEach(() => resetInstanceCounter());

  it('OFF: every value/wrapper effect scores the legacy flat 1 (byte-identical)', () => {
    const wrappedDraw = spell([
      {
        type: 'conditional',
        condition: COND,
        ifTrue: [{ type: 'draw_cards', player: 'allied', count: { type: 'fixed', value: 2 } }],
      },
    ]);
    const recursion = spell([
      {
        type: 'return_from_discard',
        target: {
          type: 'target_card_in_discard',
          side: 'allied',
          filter: { maxCost: 3, cardType: 'C' },
        },
        destination: 'hand',
      },
    ]);
    expect(score(wrappedDraw, false).value).toBe(1);
    expect(score(recursion, false).value).toBe(1);
  });

  it('KEYSTONE: a conditional recurses into its branch and is valued under fair', () => {
    const wrappedDraw = spell([
      {
        type: 'conditional',
        condition: COND,
        ifTrue: [{ type: 'draw_cards', player: 'allied', count: { type: 'fixed', value: 2 } }],
      },
    ]);
    // 0.6 (CONDITIONAL_P) * (2 cards * 1.2 CARD_VALUE) = 1.44 — and crucially > 1.
    expect(score(wrappedDraw, true).value).toBeCloseTo(1.44, 5);
    expect(score(wrappedDraw, true).value).toBeGreaterThan(1);
  });

  it('KEYSTONE: a conditional PROPAGATES isRemoval from a wrapped lethal removal', () => {
    const wrappedRemoval = spell([
      {
        type: 'conditional',
        condition: COND,
        ifTrue: [
          {
            type: 'deal_damage',
            amount: { type: 'fixed', value: 5 },
            target: { type: 'target_character', side: 'enemy' },
          },
        ],
      },
    ]);
    const off = score(wrappedRemoval, false, oppWithBody());
    const on = score(wrappedRemoval, true, oppWithBody());
    expect(off.isRemoval).toBe(false); // legacy: wrapped removal invisible
    expect(off.value).toBe(1);
    expect(on.isRemoval).toBe(true); // fair: the wrapped kill is finally seen
    expect(on.value).toBeGreaterThan(1);
  });

  it('composite recurses into all its sub-effects (removal + draw)', () => {
    const composite = spell([
      {
        type: 'composite',
        effects: [
          { type: 'destroy', target: { type: 'target_character', side: 'enemy' } },
          { type: 'draw_cards', player: 'allied', count: { type: 'fixed', value: 1 } },
        ],
      },
    ]);
    expect(score(composite, false, oppWithBody()).value).toBe(1);
    const on = score(composite, true, oppWithBody());
    expect(on.value).toBeGreaterThan(3); // bodyValue(1/2)=3 + draw 1.2
    expect(on.isRemoval).toBe(true);
  });

  it('ramp: permanent gain_resource is valued above the legacy flat 0.5 rate', () => {
    const techBloom = spell([{ type: 'gain_resource', resourceType: 'energy', amount: 3 }]);
    expect(score(techBloom, false).value).toBe(1.5); // 3 * 0.5 (legacy)
    expect(score(techBloom, true).value).toBe(3); // 3 * 1.0 (permanent ramp)
  });

  it('recursion/tutor/copy are valued ~a drawn card under fair', () => {
    const recursion = spell([
      {
        type: 'return_from_discard',
        target: {
          type: 'target_card_in_discard',
          side: 'allied',
          filter: { maxCost: 3, cardType: 'C' },
        },
        destination: 'hand',
      },
    ]);
    expect(score(recursion, true).value).toBeCloseTo(1.2, 5); // CARD_VALUE
    expect(score(recursion, true).value).toBeGreaterThan(1);
  });
});

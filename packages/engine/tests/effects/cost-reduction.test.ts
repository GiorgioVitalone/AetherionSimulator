/**
 * cost_reduction tests — a player-level discount the cost system consults.
 *
 * A `cost_reduction` effect registers an ActiveCostReduction on the controller.
 * effectiveCost() then lowers a matching card's cost so an otherwise-unaffordable
 * card becomes affordable; consumeReductions() enforces firstPerTurn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import {
  canAfford,
  effectiveCost,
  consumeReductions,
} from '../../src/actions/cost-checker.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, ResourceCard } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

function bank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `r_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

const reduce = (over: Partial<Extract<Effect, { type: 'cost_reduction' }>>): Effect => ({
  type: 'cost_reduction',
  reduction: 1,
  appliesTo: {},
  duration: { type: 'until_end_of_turn' },
  ...over,
});

describe('cost_reduction effect', () => {
  beforeEach(() => resetInstanceCounter());

  it('makes an otherwise-unaffordable card affordable', () => {
    const source = mockCard({ name: 'Discounter', owner: 0 });
    const expensive = mockCard({
      name: 'Big',
      cardType: 'S',
      cost: { mana: 3, energy: 0, flexible: 0 },
      owner: 0,
    });
    // Player has only 2 mana — cannot afford a 3-cost card.
    const state = mockGameState({
      players: [
        mockPlayerState(0, { resourceBank: bank(2) }),
        mockPlayerState(1),
      ],
    });

    expect(canAfford(state.players[0], expensive.cost)).toBe(false);

    const result = executeEffect(state, reduce({ reduction: 1 }), ctx(source.instanceId, 0));
    const player = result.newState.players[0];

    // After a 1-cost reduction, the effective cost (mana 2) is now affordable.
    const eff = effectiveCost(player, expensive);
    expect(eff.mana).toBe(2);
    expect(canAfford(player, eff)).toBe(true);
  });

  it('only discounts cards matching the cardType filter', () => {
    const source = mockCard({ owner: 0 });
    const spell = mockCard({ cardType: 'S', cost: { mana: 2, energy: 0, flexible: 0 }, owner: 0 });
    const character = mockCard({ cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 }, owner: 0 });
    const state = mockGameState();

    const result = executeEffect(
      state,
      reduce({ reduction: 1, appliesTo: { cardType: 'S' } }),
      ctx(source.instanceId, 0),
    );
    const player = result.newState.players[0];

    expect(effectiveCost(player, spell).mana).toBe(1); // matched
    expect(effectiveCost(player, character).mana).toBe(2); // unmatched
  });

  it('firstPerTurn applies once then is consumed', () => {
    const source = mockCard({ owner: 0 });
    const spell = mockCard({ cardType: 'S', cost: { mana: 2, energy: 0, flexible: 0 }, owner: 0 });
    const state = mockGameState();

    const registered = executeEffect(
      state,
      reduce({ reduction: 1, appliesTo: { cardType: 'S', firstPerTurn: true } }),
      ctx(source.instanceId, 0),
    ).newState;

    const before = registered.players[0];
    expect(effectiveCost(before, spell).mana).toBe(1);

    const after = consumeReductions(before, spell);
    // Once consumed, the firstPerTurn discount no longer applies.
    expect(effectiveCost(after, spell).mana).toBe(2);
  });

  it('is deterministic — same input yields the same registration', () => {
    const source = mockCard({ owner: 0 });
    const a = executeEffect(mockGameState(), reduce({}), ctx(source.instanceId, 0)).newState;
    const b = executeEffect(mockGameState(), reduce({}), ctx(source.instanceId, 0)).newState;
    expect(a.players[0].costReductions).toEqual(b.players[0].costReductions);
  });
});

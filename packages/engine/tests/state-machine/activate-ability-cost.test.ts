/**
 * Activated-ability cost payment (live play).
 *
 * Closes the audit's highest-impact hole: executeActivateAbility CHECKED
 * affordability but never PAID the trigger.cost, making every activated ability
 * free + unlimited. These tests assert that activating a costed ability now
 * deducts the resources (mana / energy / flexible, plus any X), that a 0-cost
 * ability (e.g. Kaelthar idx0) is unaffected, that an unaffordable activation is
 * a no-op, and that there is no double-charging.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { ResourceCost } from '../../src/types/common.js';
import type { ActivateAbilityAction } from '../../src/state-machine/types.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

function unexhausted(bank: readonly ResourceCard[]): number {
  return bank.filter(r => !r.exhausted).length;
}

/** An activated ability whose effect heals the active player's Hero by 1. */
function activatedHeal(cost: ResourceCost): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'activated', cost },
    effects: [{ type: 'heal', amount: { type: 'fixed', value: 1 }, target: { type: 'hero', side: 'allied' } }],
  };
}

describe('Activated-ability cost payment', () => {
  beforeEach(() => resetInstanceCounter());

  it('deducts the ability cost (2 mana) on activation', () => {
    const src = mockCard({
      instanceId: 'SRC',
      owner: 0,
      abilities: [activatedHeal({ mana: 2, energy: 0, flexible: 0 })],
    });
    const p0 = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [src, null, null] }),
      resourceBank: manaBank(5),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });

    const action: ActivateAbilityAction = {
      type: 'activate_ability',
      cardInstanceId: 'SRC',
      abilityIndex: 0,
    };
    const result = executePlayerAction(state, action);

    // 5 - 2 = 3 unexhausted resources remain (charged exactly once).
    expect(unexhausted(result.state.players[0].resourceBank)).toBe(3);
  });

  it('a 0-cost ability (Kaelthar idx0) deducts nothing', () => {
    const src = mockCard({
      instanceId: 'SRC',
      owner: 0,
      abilities: [activatedHeal({ mana: 0, energy: 0, flexible: 0 })],
    });
    const p0 = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [src, null, null] }),
      resourceBank: manaBank(3),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });

    const result = executePlayerAction(state, {
      type: 'activate_ability',
      cardInstanceId: 'SRC',
      abilityIndex: 0,
    });
    expect(unexhausted(result.state.players[0].resourceBank)).toBe(3);
  });

  it('adds X to the deducted cost (1 mana base + xValue 2 = 3)', () => {
    const src = mockCard({
      instanceId: 'SRC',
      owner: 0,
      abilities: [activatedHeal({ mana: 1, energy: 0, flexible: 0 })],
    });
    const p0 = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [src, null, null] }),
      resourceBank: manaBank(5),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });

    const result = executePlayerAction(state, {
      type: 'activate_ability',
      cardInstanceId: 'SRC',
      abilityIndex: 0,
      xValue: 2,
    });
    // 5 - (1 + 2) = 2 remain.
    expect(unexhausted(result.state.players[0].resourceBank)).toBe(2);
  });

  it('is a no-op when the player cannot afford the cost (no charge, no effect)', () => {
    const src = mockCard({
      instanceId: 'SRC',
      owner: 0,
      abilities: [activatedHeal({ mana: 4, energy: 0, flexible: 0 })],
    });
    const p0 = mockPlayerState(0, {
      hero: { ...mockPlayerState(0).hero, currentLp: 10, maxLp: 25 },
      zones: zonesWithCards({ frontline: [src, null, null] }),
      resourceBank: manaBank(2), // only 2 mana, cost is 4
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });

    const result = executePlayerAction(state, {
      type: 'activate_ability',
      cardInstanceId: 'SRC',
      abilityIndex: 0,
    });
    // Unaffordable: resources untouched and the heal did not run.
    expect(unexhausted(result.state.players[0].resourceBank)).toBe(2);
    expect(result.state.players[0].hero.currentLp).toBe(10);
  });

  it('charges exactly once per activation (two activations deduct 2x the cost)', () => {
    const src = mockCard({
      instanceId: 'SRC',
      owner: 0,
      abilities: [activatedHeal({ mana: 1, energy: 0, flexible: 0 })],
    });
    const p0 = mockPlayerState(0, {
      zones: zonesWithCards({ frontline: [src, null, null] }),
      resourceBank: manaBank(5),
    });
    const state = mockGameState({ phase: 'strategy', players: [p0, mockPlayerState(1)] });
    const action: ActivateAbilityAction = {
      type: 'activate_ability',
      cardInstanceId: 'SRC',
      abilityIndex: 0,
    };
    const once = executePlayerAction(state, action);
    expect(unexhausted(once.state.players[0].resourceBank)).toBe(4);
    const twice = executePlayerAction(once.state, action);
    expect(unexhausted(twice.state.players[0].resourceBank)).toBe(3);
  });
});

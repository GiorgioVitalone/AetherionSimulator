/**
 * Wave 5 — A8: Summoning sickness gates activated abilities, and using an
 * activated ability exhausts the character (Rulebook 3, "Summoning Sickness":
 * characters "cannot attack OR use activated abilities until they are refreshed").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { findCard } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';

const FREE_ACTIVATED: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 } },
  effects: [{ type: 'heal', amount: { type: 'fixed', value: 1 }, target: { type: 'hero', side: 'allied' } }],
};

function stateWith(card: ReturnType<typeof mockCard>) {
  return mockGameState({
    phase: 'strategy',
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ frontline: [card] }) }),
      mockPlayerState(1),
    ],
  });
}

describe('A8 — summoning sickness gates activated abilities', () => {
  beforeEach(resetInstanceCounter);

  it('does NOT offer an activated ability on a summoning-sick character', () => {
    const sick = mockCard({ summoningSick: true, abilities: [FREE_ACTIVATED] });
    const actions = computeAvailableActions(stateWith(sick));
    expect(actions.canActivateAbility.some(o => o.cardInstanceId === sick.instanceId)).toBe(false);
  });

  it('does NOT offer an activated ability on an exhausted character', () => {
    const tapped = mockCard({ exhausted: true, abilities: [FREE_ACTIVATED] });
    const actions = computeAvailableActions(stateWith(tapped));
    expect(actions.canActivateAbility.some(o => o.cardInstanceId === tapped.instanceId)).toBe(false);
  });

  it('offers the ability on a ready, non-sick character', () => {
    const ready = mockCard({ summoningSick: false, exhausted: false, abilities: [FREE_ACTIVATED] });
    const actions = computeAvailableActions(stateWith(ready));
    expect(actions.canActivateAbility.some(o => o.cardInstanceId === ready.instanceId)).toBe(true);
  });

  it('exhausts the character after it uses an activated ability', () => {
    const ready = mockCard({ summoningSick: false, exhausted: false, abilities: [FREE_ACTIVATED] });
    const result = executePlayerAction(stateWith(ready), {
      type: 'activate_ability',
      cardInstanceId: ready.instanceId,
      abilityIndex: 0,
    });
    const after = findCard(result.state.players[0].zones, ready.instanceId);
    expect(after?.card.exhausted).toBe(true);
  });
});

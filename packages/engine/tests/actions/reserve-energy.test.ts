/**
 * Wave 5 — A7: Reserve Energy Generation (Rulebook 8, Upkeep step 4). The active
 * player exhausts ready Reserve characters to generate 1 temporary resource each
 * (matching the character's resource type); those characters' abilities are
 * disabled until next Upkeep, and the refresh step re-enables them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { generateReserveEnergy, refreshCards } from '../../src/state-machine/actions.js';
import { getAllRegisteredTriggers } from '../../src/events/trigger-registry.js';
import { findCard } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { CardInstance } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

const ONDEPLOY_TRIGGER: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_turn_start' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
};

function reserveState(cards: readonly (CardInstance | null)[]) {
  return mockGameState({
    phase: 'upkeep',
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ reserve: cards }) }),
      mockPlayerState(1),
    ],
  });
}

describe('A7 — Reserve Energy Generation', () => {
  beforeEach(resetInstanceCounter);

  it('exhausts a ready Reserve character and grants 1 matching temporary resource', () => {
    const verdant = mockCard({ cost: { mana: 0, energy: 1, flexible: 0 }, alignment: ['Verdant'] });
    const result = generateReserveEnergy(reserveState([verdant, null]));
    expect(result.state.players[0].temporaryResources).toEqual([{ resourceType: 'energy', amount: 1 }]);
    expect(findCard(result.state.players[0].zones, verdant.instanceId)?.card.exhausted).toBe(true);
    expect(result.events).toContainEqual({
      type: 'RESOURCE_GAINED', playerId: 0, resourceType: 'energy', amount: 1,
    });
  });

  it('skips summoning-sick, already-exhausted, and Sniper Reserve characters', () => {
    const sick = mockCard({ summoningSick: true });
    const tapped = mockCard({ exhausted: true });
    const sniper = mockCard({ traits: ['sniper'] });
    const result = generateReserveEnergy(
      mockGameState({
        phase: 'upkeep',
        players: [
          mockPlayerState(0, {
            zones: { reserve: [sick, tapped], frontline: [sniper, null, null], highGround: [null, null] },
          }),
          mockPlayerState(1),
        ],
      }),
    );
    // Sniper is in frontline (not reserve) and the reserve cards are ineligible.
    expect(result.state.players[0].temporaryResources).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it('disables a generated character\'s triggers until refresh re-enables them', () => {
    const engine = mockCard({ abilities: [ONDEPLOY_TRIGGER], registeredTriggers: [
      { id: 't1', sourceInstanceId: 'X', ownerPlayerId: 0, trigger: { type: 'on_turn_start' }, effects: [], abilityIndex: 0 },
    ] });
    const generated = generateReserveEnergy(reserveState([engine, null]));
    // While exhausted for Reserve Energy, its triggers are excluded from the pool.
    expect(getAllRegisteredTriggers(generated.state)).toHaveLength(0);

    // The next Upkeep refresh clears reserveEnergyExhausted; triggers come back.
    const refreshed = refreshCards(generated.state);
    const card = findCard(refreshed.players[0].zones, engine.instanceId)?.card;
    expect(card?.reserveEnergyExhausted).toBe(false);
    expect(card?.exhausted).toBe(false);
    expect(getAllRegisteredTriggers(refreshed)).toHaveLength(1);
  });
});

/**
 * §13m rules package — reserveTapChoice (Rulebook 8 step 4's "may": tapping is a
 * player action, not automatic) + reserveTapStrain (tapping deals 1 direct damage;
 * a 1-HP character is too weak to generate). Both flags absent ⇒ byte-identical
 * legacy behavior (automatic, free).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import {
  generateReserveEnergy,
  executePlayerAction,
  refreshCards,
} from '../../src/state-machine/actions.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { isReserveTapEligible } from '../../src/actions/reserve-tap.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import { findCard } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { CardInstance, GameConfig, GameState } from '../../src/types/game-state.js';

function stateWith(
  cards: readonly (CardInstance | null)[],
  config: GameConfig | undefined,
  phase: GameState['phase'] = 'strategy',
): GameState {
  return mockGameState({
    phase,
    ...(config !== undefined ? { config } : {}),
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ reserve: cards }) }),
      mockPlayerState(1),
    ],
  });
}

const body = (hp: number, over?: Partial<CardInstance>) =>
  mockCard({
    cost: { mana: 0, energy: 1, flexible: 0 },
    alignment: ['Verdant'],
    currentHp: hp,
    baseHp: hp,
    ...over,
  });

describe('§13m — reserveTapChoice', () => {
  beforeEach(resetInstanceCounter);

  it('upkeep generates nothing when choice mode is on', () => {
    const c = body(2);
    const result = generateReserveEnergy(
      stateWith([c, null], { reserveTapChoice: true }, 'upkeep'),
    );
    expect(result.events).toEqual([]);
    expect(result.state.players[0].temporaryResources).toEqual([]);
    expect(findCard(result.state.players[0].zones, c.instanceId)?.card.exhausted).toBe(false);
  });

  it('retains the legacy Strategy surface for non-authoritative profiles', () => {
    const c = body(2);
    const on = computeAvailableActions(stateWith([c, null], { reserveTapChoice: true }));
    expect(on.canTapReserve).toEqual([c.instanceId]);
    const off = computeAvailableActions(stateWith([c, null], undefined));
    expect(off.canTapReserve).toEqual([]);
  });

  it('offers current-rules taps only in the explicit Upkeep Reserve Energy window', () => {
    const c = body(2);
    const base = stateWith([c, null], CURRENT_GAME_CONFIG, 'upkeep');
    const reserveWindow: GameState = {
      ...base,
      turnState: {
        ...base.turnState,
        upkeepActionWindow: 'reserve_energy',
      },
    };

    expect(computeAvailableActions(reserveWindow).canTapReserve).toEqual([
      c.instanceId,
    ]);
    expect(computeAvailableActions(reserveWindow).canEndPhase).toBe(true);
    expect(
      computeAvailableActions({
        ...reserveWindow,
        turnState: {
          ...reserveWindow.turnState,
          upkeepActionWindow: 'transform',
        },
      }).canTapReserve,
    ).toEqual([]);
    expect(
      computeAvailableActions({
        ...reserveWindow,
        phase: 'strategy',
        turnState: {
          ...reserveWindow.turnState,
          upkeepActionWindow: undefined,
        },
      }).canTapReserve,
    ).toEqual([]);
  });

  it('serializes Reserve Energy choice before transformation and Strategy', () => {
    const c = body(3);
    const base = stateWith([c, null], CURRENT_GAME_CONFIG, 'upkeep');
    const deck = Array.from({ length: 4 }, () => mockCard({ owner: 0 }));
    const resourceDeck = Array.from({ length: 4 }, (_, i) => ({
      instanceId: `resource-${String(i)}`,
      resourceType: 'energy' as const,
      exhausted: false,
    }));
    const initial: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          mainDeck: deck,
          resourceDeck,
        },
        {
          ...base.players[1],
          mainDeck: deck.map((card, index) => ({
            ...card,
            instanceId: `opponent-card-${String(index)}`,
            owner: 1 as const,
          })),
          resourceDeck: resourceDeck.map((resource, index) => ({
            ...resource,
            instanceId: `opponent-resource-${String(index)}`,
          })),
        },
      ],
    };
    const actor = createActor(gameMachine, { input: { gameState: initial } });
    actor.start();

    let snapshot = actor.getSnapshot();
    expect(snapshot.matches({ playing: 'reserveEnergyChoice' })).toBe(true);
    expect(snapshot.context.gameState.turnState.upkeepActionWindow).toBe(
      'reserve_energy',
    );
    expect(computeAvailableActions(snapshot.context.gameState).canTapReserve).toEqual([
      c.instanceId,
    ]);

    actor.send({
      type: 'PLAYER_ACTION',
      action: { type: 'tap_reserve', cardInstanceId: c.instanceId },
    });
    snapshot = actor.getSnapshot();
    expect(snapshot.context.gameState.players[0].temporaryResources).toEqual([
      { resourceType: 'energy', amount: 1 },
    ]);
    expect(
      findCard(snapshot.context.gameState.players[0].zones, c.instanceId)?.card
        .currentHp,
    ).toBe(2);

    actor.send({ type: 'END_PHASE' });
    snapshot = actor.getSnapshot();
    expect(snapshot.matches({ playing: 'startOfTurnTransform' })).toBe(true);
    expect(snapshot.context.gameState.turnState.upkeepActionWindow).toBe(
      'transform',
    );

    actor.send({ type: 'END_PHASE' });
    snapshot = actor.getSnapshot();
    expect(snapshot.matches({ playing: 'strategy' })).toBe(true);
    expect(snapshot.context.gameState.turnState.upkeepActionWindow).toBeUndefined();
  });

  it('tap_reserve grants +1 matching temp resource, exhausts, and disables abilities until refresh', () => {
    const c = body(2);
    const s0 = stateWith([c, null], { reserveTapChoice: true });
    const { state: s1, events } = executePlayerAction(s0, {
      type: 'tap_reserve',
      cardInstanceId: c.instanceId,
    });
    expect(s1.players[0].temporaryResources).toEqual([{ resourceType: 'energy', amount: 1 }]);
    expect(events).toContainEqual({
      type: 'RESOURCE_GAINED',
      playerId: 0,
      resourceType: 'energy',
      amount: 1,
    });
    const tapped = findCard(s1.players[0].zones, c.instanceId)?.card;
    expect(tapped?.exhausted).toBe(true);
    expect(tapped?.reserveEnergyExhausted).toBe(true);
    // Not offered again while exhausted; re-enabled by the refresh step.
    expect(computeAvailableActions(s1).canTapReserve).toEqual([]);
    const refreshed = findCard(refreshCards(s1).players[0].zones, c.instanceId)?.card;
    expect(refreshed?.reserveEnergyExhausted).toBe(false);
    expect(refreshed?.exhausted).toBe(false);
  });

  it('rejects tapping an ineligible or missing card (no state change)', () => {
    const c = body(2, { exhausted: true });
    const s0 = stateWith([c, null], { reserveTapChoice: true });
    const { state: s1 } = executePlayerAction(s0, {
      type: 'tap_reserve',
      cardInstanceId: c.instanceId,
    });
    expect(s1.players[0].temporaryResources).toEqual([]);
    const { state: s2 } = executePlayerAction(s0, { type: 'tap_reserve', cardInstanceId: 'nope' });
    expect(s2.players[0].temporaryResources).toEqual([]);
  });
});

describe('§13m — reserveTapStrain', () => {
  beforeEach(resetInstanceCounter);

  it('a chosen tap deals 1 direct damage', () => {
    const c = body(3);
    const s0 = stateWith([c, null], { reserveTapChoice: true, reserveTapStrain: true });
    const { state: s1 } = executePlayerAction(s0, {
      type: 'tap_reserve',
      cardInstanceId: c.instanceId,
    });
    expect(findCard(s1.players[0].zones, c.instanceId)?.card.currentHp).toBe(2);
    expect(s1.players[0].temporaryResources).toEqual([{ resourceType: 'energy', amount: 1 }]);
  });

  it('a 1-HP character is too weak to tap (not offered, not auto-tapped)', () => {
    const weak = body(1);
    expect(isReserveTapEligible(weak, { reserveTapStrain: true })).toBe(false);
    const acts = computeAvailableActions(
      stateWith([weak, null], { reserveTapChoice: true, reserveTapStrain: true }),
    );
    expect(acts.canTapReserve).toEqual([]);
    const auto = generateReserveEnergy(
      stateWith([weak, null], { reserveTapStrain: true }, 'upkeep'),
    );
    expect(auto.state.players[0].temporaryResources).toEqual([]);
    expect(findCard(auto.state.players[0].zones, weak.instanceId)?.card.currentHp).toBe(1);
  });

  it('strain bypasses ARM (wear, not an attack)', () => {
    const armored = body(4, { currentArm: 2, baseArm: 2 });
    const s0 = stateWith([armored, null], { reserveTapChoice: true, reserveTapStrain: true });
    const { state: s1 } = executePlayerAction(s0, {
      type: 'tap_reserve',
      cardInstanceId: armored.instanceId,
    });
    const after = findCard(s1.players[0].zones, armored.instanceId)?.card;
    expect(after?.currentHp).toBe(3);
    expect(after?.currentArm).toBe(2);
  });

  it('the automatic path also strains when only the strain flag is on', () => {
    const c = body(3);
    const result = generateReserveEnergy(
      stateWith([c, null], { reserveTapStrain: true }, 'upkeep'),
    );
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'energy', amount: 1 },
    ]);
    expect(findCard(result.state.players[0].zones, c.instanceId)?.card.currentHp).toBe(2);
  });

  it('both flags absent: legacy free automatic tap, no damage', () => {
    const c = body(2);
    const result = generateReserveEnergy(stateWith([c, null], undefined, 'upkeep'));
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'energy', amount: 1 },
    ]);
    expect(findCard(result.state.players[0].zones, c.instanceId)?.card.currentHp).toBe(2);
  });
});

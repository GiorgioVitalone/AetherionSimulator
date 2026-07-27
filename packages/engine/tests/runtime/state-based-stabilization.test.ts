import { describe, expect, it } from 'vitest';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { ActiveReplacement, CardInstance } from '../../src/types/game-state.js';
import { applyStateBasedDeaths } from '../../src/effects/interpreter.js';
import { findCardInState, updateCardInState } from '../../src/effects/state-helpers.js';
import {
  recomputeAuras,
  recomputeAurasWithEvents,
} from '../../src/runtime/aura-recompute.js';
import { stabilizeStateBased } from '../../src/runtime/state-based-stabilizer.js';
import { tickStatusEffects } from '../../src/runtime/status-tick.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

const currentConfig = {
  terminationMode: 'turn_cap' as const,
  stateBasedActions: true,
  simultaneousAllEffects: true,
};

function lethal(instanceId: string, owner: 0 | 1): CardInstance {
  return mockCard({ instanceId, owner, currentHp: 0, baseHp: 2 });
}

describe('current-rules state-based stabilization', () => {
  it('snapshots a simultaneous death group and emits deterministic complete LKI', () => {
    const a = lethal('a', 0);
    const b = lethal('b', 0);
    const makeState = (cards: readonly CardInstance[]) =>
      mockGameState({
        activePlayerIndex: 0,
        config: currentConfig,
        players: [
          mockPlayerState(0, { zones: zonesWithCards({ frontline: cards }) }),
          mockPlayerState(1),
        ],
      });

    const forward = applyStateBasedDeaths(makeState([b, a]));
    const reverse = applyStateBasedDeaths(makeState([a, b]));
    const destroyedIds = (events: typeof forward.events) =>
      events
        .filter((event) => event.type === 'CARD_DESTROYED')
        .map((event) => ({
          id: event.cardInstanceId,
          lki: event.lastKnownCard?.instanceId,
        }));

    expect(destroyedIds(forward.events)).toEqual([
      { id: 'a', lki: 'a' },
      { id: 'b', lki: 'b' },
    ]);
    expect(destroyedIds(reverse.events)).toEqual(destroyedIds(forward.events));
    expect(forward.newState.players[0].zones.frontline.every((card) => card === null)).toBe(true);
  });

  it('repeats aura recompute and state-based deaths until aura-source loss is stable', () => {
    const hpAura: AbilityDSL = {
      type: 'aura',
      effects: [
        {
          type: 'modify_stats',
          target: { type: 'all_characters', side: 'allied' },
          modifier: { hp: 2 },
          duration: { type: 'while_in_play' },
        },
      ],
    };
    const source = mockCard({
      instanceId: 'source',
      owner: 0,
      baseHp: 2,
      currentHp: 2,
      abilities: [hpAura],
    });
    const ally = mockCard({
      instanceId: 'ally',
      owner: 0,
      baseHp: 1,
      currentHp: 1,
    });
    const state = mockGameState({
      config: currentConfig,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [source, ally] }),
        }),
        mockPlayerState(1),
      ],
    });
    let withAura = recomputeAuras(state);
    withAura = updateCardInState(withAura, 'source', (card) => ({ ...card, currentHp: 0 }));
    withAura = updateCardInState(withAura, 'ally', (card) => ({ ...card, currentHp: 1 }));

    const result = recomputeAurasWithEvents(withAura);
    expect(findCardInState(result.state, 'source')).toBeNull();
    expect(findCardInState(result.state, 'ally')).toBeNull();
    expect(
      result.events
        .filter((event) => event.type === 'CARD_DESTROYED')
        .map((event) => event.cardInstanceId),
    ).toEqual(['source', 'ally']);
  });

  it('dispatches state-based destruction events instead of dropping them at the aura boundary', () => {
    const hpAura: AbilityDSL = {
      type: 'aura',
      effects: [{
        type: 'modify_stats',
        target: { type: 'all_characters', side: 'allied' },
        modifier: { hp: 2 },
        duration: { type: 'while_in_play' },
      }],
    };
    const source = mockCard({
      instanceId: 'source',
      owner: 0,
      baseHp: 2,
      currentHp: 0,
      abilities: [hpAura],
      registeredTriggers: [{
        id: 'source:last-breath',
        sourceInstanceId: 'source',
        ownerPlayerId: 0,
        trigger: { type: 'on_destroy' },
        effects: [{
          type: 'gain_resource',
          resourceType: 'mana',
          amount: 1,
          temporary: true,
        }],
        abilityIndex: 1,
      }],
    });
    const ally = mockCard({
      instanceId: 'ally',
      owner: 0,
      baseHp: 1,
      currentHp: 1,
    });
    let prepared = recomputeAuras(mockGameState({
      config: { ...currentConfig, authoritativeTransitions: true },
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({
            frontline: [{ ...source, currentHp: 2 }, ally],
          }),
        }),
        mockPlayerState(1),
      ],
    }));
    prepared = updateCardInState(prepared, 'source', (card) => ({
      ...card,
      currentHp: 0,
    }));
    prepared = updateCardInState(prepared, 'ally', (card) => ({
      ...card,
      currentHp: 1,
    }));
    const result = stabilizeStateBased(prepared);

    expect(
      result.events
        .filter((event) => event.type === 'CARD_DESTROYED')
        .map((event) => event.cardInstanceId),
    ).toEqual(['source', 'ally']);
    expect(result.events.some((event) => event.type === 'RESOURCE_GAINED')).toBe(true);
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'mana', amount: 1 },
    ]);
    expect(result.events.every((event) => event.eventId !== undefined)).toBe(true);
  });

  it('evaluates dynamic auras from one common snapshot, independent of source order', () => {
    const armAura: AbilityDSL = {
      type: 'aura',
      effects: [
        {
          type: 'modify_stats',
          target: { type: 'all_characters', side: 'allied' },
          modifier: { arm: 2 },
          duration: { type: 'while_in_play' },
        },
      ],
    };
    const atkFromArmAura: AbilityDSL = {
      type: 'aura',
      effects: [
        {
          type: 'modify_stats',
          target: { type: 'all_characters', side: 'allied' },
          modifier: {},
          dynamicModifier: {
            type: 'equals_stat',
            stat: 'atk',
            sourceRef: 'arm',
          },
          duration: { type: 'while_in_play' },
        },
      ],
    };
    const armSource = mockCard({ instanceId: 'arm-source', owner: 0, abilities: [armAura] });
    const atkSource = mockCard({
      instanceId: 'atk-source',
      owner: 0,
      abilities: [atkFromArmAura],
    });
    const target = mockCard({
      instanceId: 'target',
      owner: 0,
      baseAtk: 1,
      currentAtk: 1,
      baseArm: 1,
      currentArm: 1,
    });
    const compute = (cards: readonly CardInstance[]) =>
      recomputeAuras(
        mockGameState({
          config: currentConfig,
          players: [
            mockPlayerState(0, { zones: zonesWithCards({ frontline: cards }) }),
            mockPlayerState(1),
          ],
        }),
      );

    const first = findCardInState(compute([armSource, atkSource, target]), 'target');
    const second = findCardInState(compute([atkSource, armSource, target]), 'target');
    expect(first).toMatchObject({ currentArm: 3, currentAtk: 2 });
    expect(second).toMatchObject({ currentArm: 3, currentAtk: 2 });
  });

  it('routes Persistent lethality through the shared destruction replacement', () => {
    const replacement: ActiveReplacement = {
      id: 'persistent-save',
      sourceInstanceId: 'persistent',
      replaces: { type: 'on_would_be_destroyed' },
      instead: [{ type: 'bounce', target: { type: 'self' } }],
      oncePerTurn: true,
      usedThisTurn: false,
    };
    const card = mockCard({
      instanceId: 'persistent',
      owner: 0,
      baseHp: 2,
      currentHp: 2,
      statusEffects: [{ statusType: 'persistent', value: 3, remainingTurns: null }],
      activeReplacements: [replacement],
    });
    const state = mockGameState({
      config: currentConfig,
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [card] }) }),
        mockPlayerState(1),
      ],
    });

    const result = tickStatusEffects(state, 0);
    expect(findCardInState(result.state, card.instanceId)).toBeNull();
    expect(result.state.players[0].hand.map((entry) => entry.instanceId)).toContain(
      card.instanceId,
    );
    expect(result.events.some((event) => event.type === 'CARD_DESTROYED')).toBe(false);
    expect(result.events.some((event) => event.type === 'CARD_BOUNCED')).toBe(true);
  });

  it('routes combat lethality through the same destruction replacement', () => {
    const replacement: ActiveReplacement = {
      id: 'combat-save',
      sourceInstanceId: 'defender',
      replaces: { type: 'on_would_be_destroyed' },
      instead: [{ type: 'bounce', target: { type: 'self' } }],
      oncePerTurn: true,
      usedThisTurn: false,
    };
    const attacker = mockCard({
      instanceId: 'attacker',
      owner: 0,
      currentAtk: 5,
      currentHp: 5,
    });
    const defender = mockCard({
      instanceId: 'defender',
      owner: 1,
      baseHp: 2,
      currentHp: 2,
      currentAtk: 0,
      activeReplacements: [replacement],
    });
    const state = mockGameState({
      config: currentConfig,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [attacker] }),
        }),
        mockPlayerState(1, {
          zones: zonesWithCards({ frontline: [defender] }),
        }),
      ],
    });

    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);
    expect(findCardInState(result.newState, defender.instanceId)).toBeNull();
    expect(result.newState.players[1].hand.map((card) => card.instanceId)).toContain(
      defender.instanceId,
    );
    expect(result.events.some((event) => event.type === 'CARD_DESTROYED')).toBe(false);
    expect(result.events.some((event) => event.type === 'CARD_BOUNCED')).toBe(true);
  });
});

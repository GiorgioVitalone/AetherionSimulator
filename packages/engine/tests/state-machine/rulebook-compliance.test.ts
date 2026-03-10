import { beforeEach, describe, expect, it } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { moveCard } from '../../src/zones/zone-manager.js';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { cardHasActiveTrait } from '../../src/state/runtime-card-helpers.js';
import type { CardInstance, ResourceCard } from '../../src/types/game-state.js';
import type { StatGrantDSL } from '../../src/types/ability.js';
import {
  emptyZones,
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

function makeBank(resources: readonly ('mana' | 'energy')[]): readonly ResourceCard[] {
  return resources.map((resourceType, index) => ({
    instanceId: `res_${String(index)}`,
    resourceType,
    exhausted: false,
  }));
}

function makeEquipment(
  modifier: StatGrantDSL['modifier'],
  overrides?: Partial<CardInstance>,
): CardInstance {
  const statGrant: StatGrantDSL = {
    type: 'stat_grant',
    modifier,
  };
  return mockCard({
    cardType: 'E',
    abilities: [statGrant],
    cost: { mana: 1, energy: 0, flexible: 0 },
    ...overrides,
  });
}

describe('Rulebook compliance regressions', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('allows voluntary equipment removal during strategy and discards the equipment', () => {
    const equipment = makeEquipment({ atk: 1, hp: 2 });
    const host = mockCard({
      owner: 0,
      baseAtk: 3,
      currentAtk: 3,
      baseHp: 5,
      currentHp: 4,
      equipment,
    });

    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [host, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canRemoveEquipment).toEqual([{
      cardInstanceId: host.instanceId,
      equipmentInstanceId: equipment.instanceId,
    }]);

    const result = executePlayerAction(state, {
      type: 'remove_equipment',
      cardInstanceId: host.instanceId,
    });

    const updatedHost = result.state.players[0]!.zones.frontline[0]!;
    expect(updatedHost.equipment).toBeNull();
    expect(updatedHost.baseAtk).toBe(2);
    expect(updatedHost.baseHp).toBe(3);
    expect(updatedHost.currentHp).toBe(2);
    expect(result.state.players[0]!.discardPile.map(card => card.instanceId)).toContain(equipment.instanceId);
  });

  it('transfers equipment by paying its cost and replaces target equipment', () => {
    const transferredEquipment = makeEquipment({ atk: 1 }, { owner: 0 });
    const replacedEquipment = makeEquipment({ hp: 2 }, { owner: 0, name: 'Old Gear' });
    const source = mockCard({
      owner: 0,
      baseAtk: 3,
      currentAtk: 3,
      equipment: transferredEquipment,
    });
    const target = mockCard({
      owner: 0,
      baseHp: 5,
      currentHp: 5,
      equipment: replacedEquipment,
    });

    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [source, target, null] }),
          resourceBank: makeBank(['mana']),
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    const transferOption = actions.canTransferEquipment.find(
      option => option.cardInstanceId === source.instanceId,
    );
    expect(transferOption).toBeDefined();
    expect(transferOption?.validTargets).toEqual([target.instanceId]);

    const result = executePlayerAction(state, {
      type: 'transfer_equipment',
      cardInstanceId: source.instanceId,
      targetInstanceId: target.instanceId,
    });

    const updatedSource = result.state.players[0]!.zones.frontline[0]!;
    const updatedTarget = result.state.players[0]!.zones.frontline[1]!;
    expect(updatedSource.equipment).toBeNull();
    expect(updatedSource.baseAtk).toBe(2);
    expect(updatedTarget.equipment?.instanceId).toBe(transferredEquipment.instanceId);
    expect(updatedTarget.equipment?.transferredThisTurn).toBe(true);
    expect(updatedTarget.baseAtk).toBe(3);
    expect(updatedTarget.baseHp).toBe(3);
    expect(result.state.players[0]!.discardPile.map(card => card.instanceId)).toContain(replacedEquipment.instanceId);
    expect(result.state.players[0]!.resourceBank[0]!.exhausted).toBe(true);
  });

  it('draws for recycle when a card is discarded from hand for energy', () => {
    const recycleCard = mockCard({
      owner: 0,
      traits: ['recycle'],
      tags: ['Recycle 1'],
      resourceTypes: ['energy'],
    });
    const drawCard = mockCard({ owner: 0, name: 'Replacement' });

    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [recycleCard],
          mainDeck: [drawCard],
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'discard_for_energy',
      cardInstanceId: recycleCard.instanceId,
    });

    expect(result.state.players[0]!.hand.map(card => card.instanceId)).toEqual([drawCard.instanceId]);
    expect(result.state.players[0]!.discardPile.map(card => card.instanceId)).toEqual([recycleCard.instanceId]);
    expect(result.state.players[0]!.temporaryResources).toEqual([{ resourceType: 'energy', amount: 1 }]);
    expect(result.events.some(event => event.type === 'CARD_DRAWN' && event.playerId === 0)).toBe(true);
  });

  it('breaks stealth when declaring an attack or using an activated ability', () => {
    const attacker = mockCard({
      owner: 0,
      traits: ['stealth'],
      summoningSick: false,
      exhausted: false,
    });
    const abilityUser = mockCard({
      owner: 0,
      traits: ['stealth'],
      summoningSick: false,
      exhausted: false,
      abilities: [{
        type: 'triggered',
        trigger: {
          type: 'activated',
          cost: { mana: 0, energy: 0, flexible: 0 },
        },
        effects: [],
      }],
    });

    const attackState = mockGameState({
      phase: 'action',
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [attacker, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    const attackResult = executePlayerAction(attackState, {
      type: 'declare_attack',
      attackerInstanceId: attacker.instanceId,
      targetId: 'hero',
    });
    const updatedAttacker = attackResult.state.players[0]!.zones.frontline[0]!;
    expect(updatedAttacker.stealthBroken).toBe(true);
    expect(cardHasActiveTrait(updatedAttacker, 'stealth')).toBe(false);

    const abilityState = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [abilityUser, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    const abilityResult = executePlayerAction(abilityState, {
      type: 'activate_ability',
      cardInstanceId: abilityUser.instanceId,
      abilityIndex: 0,
    });
    const updatedAbilityUser = abilityResult.state.players[0]!.zones.frontline[0]!;
    expect(updatedAbilityUser.stealthBroken).toBe(true);
    expect(cardHasActiveTrait(updatedAbilityUser, 'stealth')).toBe(false);
  });

  it('allows swift and rush extra movement without ignoring exhaustion rules', () => {
    const swiftCard = mockCard({
      owner: 0,
      traits: ['swift'],
      exhausted: false,
      summoningSick: false,
    });

    let zones = deployFrontline(swiftCard);
    zones = moveCard(zones, swiftCard.instanceId, 'reserve', 0, 1);
    const movedSwift = zones.reserve[0]!;
    expect(movedSwift.exhausted).toBe(false);
    expect(movedSwift.movesThisTurn).toBe(1);

    zones = moveCard(zones, swiftCard.instanceId, 'frontline', 1, 1);
    const movedAgain = zones.frontline[1]!;
    expect(movedAgain.exhausted).toBe(true);
    expect(movedAgain.movesThisTurn).toBe(2);

    const rushCard = mockCard({
      owner: 0,
      traits: ['rush'],
      tags: ['Rush 2'],
      exhausted: false,
      summoningSick: false,
      deployedTurn: 3,
      movesThisTurn: 2,
    });
    const rushState = mockGameState({
      phase: 'strategy',
      turnNumber: 3,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [rushCard, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(rushState).canMove).toHaveLength(1);

    const expiredRushState = {
      ...rushState,
      turnNumber: 4,
    };
    expect(computeAvailableActions(expiredRushState).canMove).toHaveLength(0);
  });
});

function deployFrontline(card: CardInstance) {
  return zonesWithCards({ frontline: [card, null, null] });
}

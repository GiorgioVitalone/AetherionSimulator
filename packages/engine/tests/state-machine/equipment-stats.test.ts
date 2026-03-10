import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import type { GameState } from '../../src/types/game-state.js';
import type { StatGrantDSL } from '../../src/types/ability.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

function makeEquipCard(hpBonus: number, atkBonus: number, armBonus: number) {
  const statGrant: StatGrantDSL = {
    type: 'stat_grant',
    modifier: { hp: hpBonus, atk: atkBonus, arm: armBonus },
  };
  return mockCard({
    cardType: 'E',
    abilities: [statGrant],
    cost: { mana: 0, energy: 0, flexible: 0 },
  });
}

describe('equipment stat application', () => {
  it('should increase both baseHp and currentHp when equipping +2 HP', () => {
    const character = mockCard({
      owner: 0,
      baseHp: 3,
      currentHp: 3,
      baseAtk: 2,
      currentAtk: 2,
      baseArm: 0,
      currentArm: 0,
    });
    const equip = makeEquipCard(2, 0, 0);

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [equip],
          zones: zonesWithCards({ frontline: [character, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: equip.instanceId,
      targetInstanceId: character.instanceId,
    });

    const equipped = result.state.players[0]!.zones.frontline[0]!;
    expect(equipped.baseHp).toBe(5);
    expect(equipped.currentHp).toBe(5);
  });

  it('should allow healing up to new baseHp after equipment', () => {
    const character = mockCard({
      owner: 0,
      baseHp: 3,
      currentHp: 2, // damaged
      baseAtk: 2,
      currentAtk: 2,
      baseArm: 0,
      currentArm: 0,
    });
    const equip = makeEquipCard(2, 0, 0);

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [equip],
          zones: zonesWithCards({ frontline: [character, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: equip.instanceId,
      targetInstanceId: character.instanceId,
    });

    const equipped = result.state.players[0]!.zones.frontline[0]!;
    // baseHp: 3 + 2 = 5, currentHp: 2 + 2 = 4, heal should cap at 5
    expect(equipped.baseHp).toBe(5);
    expect(equipped.currentHp).toBe(4);
    // Healing to full would cap at baseHp=5, not the original 3
    expect(equipped.currentHp).toBeLessThanOrEqual(equipped.baseHp);
  });

  it('should increase all base and current stats with equipment', () => {
    const character = mockCard({
      owner: 0,
      baseHp: 3,
      currentHp: 3,
      baseAtk: 2,
      currentAtk: 2,
      baseArm: 1,
      currentArm: 1,
    });
    const equip = makeEquipCard(1, 2, 3);

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [equip],
          zones: zonesWithCards({ frontline: [character, null, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: equip.instanceId,
      targetInstanceId: character.instanceId,
    });

    const equipped = result.state.players[0]!.zones.frontline[0]!;
    expect(equipped.baseAtk).toBe(4);
    expect(equipped.currentAtk).toBe(4);
    expect(equipped.baseHp).toBe(4);
    expect(equipped.currentHp).toBe(4);
    expect(equipped.baseArm).toBe(4);
    expect(equipped.currentArm).toBe(4);
  });
});

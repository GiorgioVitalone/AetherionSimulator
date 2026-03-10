import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import type { GameState } from '../../src/types/game-state.js';
import {
  mockGameState,
  mockPlayerState,
  mockCard,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

describe('X-cost deployment', () => {
  it('should deploy X-cost character with X/X stats', () => {
    const xCostCard = mockCard({
      owner: 0,
      cardType: 'C',
      baseHp: 0,
      currentHp: 0,
      baseAtk: 0,
      currentAtk: 0,
      cost: { mana: 0, energy: 0, flexible: 0, xEnergy: true },
    });

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [xCostCard],
          resourceBank: [
            { instanceId: 'r1', resourceType: 'energy', exhausted: false },
            { instanceId: 'r2', resourceType: 'energy', exhausted: false },
            { instanceId: 'r3', resourceType: 'energy', exhausted: false },
          ],
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: xCostCard.instanceId,
      zone: 'frontline',
      slotIndex: 0,
      xValue: 3,
    });

    const deployed = result.state.players[0]!.zones.frontline[0]!;
    expect(deployed.baseHp).toBe(3);
    expect(deployed.currentHp).toBe(3);
    expect(deployed.baseAtk).toBe(3);
    expect(deployed.currentAtk).toBe(3);
    expect(deployed.xValue).toBe(3);
  });

  it('should pay X resources when deploying X-cost card', () => {
    const xCostCard = mockCard({
      owner: 0,
      cardType: 'C',
      baseHp: 0,
      currentHp: 0,
      baseAtk: 0,
      currentAtk: 0,
      cost: { mana: 0, energy: 0, flexible: 0, xEnergy: true },
    });

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [xCostCard],
          resourceBank: [
            { instanceId: 'r1', resourceType: 'energy', exhausted: false },
            { instanceId: 'r2', resourceType: 'energy', exhausted: false },
            { instanceId: 'r3', resourceType: 'energy', exhausted: false },
            { instanceId: 'r4', resourceType: 'energy', exhausted: false },
            { instanceId: 'r5', resourceType: 'energy', exhausted: false },
          ],
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: xCostCard.instanceId,
      zone: 'frontline',
      slotIndex: 0,
      xValue: 3,
    });

    // 3 resources should be exhausted
    const exhausted = result.state.players[0]!.resourceBank.filter(r => r.exhausted);
    expect(exhausted).toHaveLength(3);
  });

  it('should include isXCost and maxX in DeployOption', () => {
    const xCostCard = mockCard({
      owner: 0,
      cardType: 'C',
      baseHp: 0,
      currentHp: 0,
      cost: { mana: 0, energy: 0, flexible: 0, xEnergy: true },
    });

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [xCostCard],
          resourceBank: [
            { instanceId: 'r1', resourceType: 'energy', exhausted: false },
            { instanceId: 'r2', resourceType: 'energy', exhausted: false },
            { instanceId: 'r3', resourceType: 'energy', exhausted: false },
          ],
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canDeploy).toHaveLength(1);
    expect(actions.canDeploy[0]!.isXCost).toBe(true);
    expect(actions.canDeploy[0]!.maxX).toBe(3);
  });

  it('should deploy with X=0 producing a 0/0', () => {
    const xCostCard = mockCard({
      owner: 0,
      cardType: 'C',
      baseHp: 0,
      currentHp: 0,
      baseAtk: 0,
      currentAtk: 0,
      cost: { mana: 0, energy: 0, flexible: 0, xEnergy: true },
    });

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [xCostCard],
          resourceBank: [],
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: xCostCard.instanceId,
      zone: 'frontline',
      slotIndex: 0,
      xValue: 0,
    });

    const deployed = result.state.players[0]!.zones.frontline[0]!;
    expect(deployed.baseHp).toBe(0);
    expect(deployed.baseAtk).toBe(0);
  });

  it('should mark non-X-cost cards with isXCost=false', () => {
    const normalCard = mockCard({
      owner: 0,
      cardType: 'C',
      cost: { mana: 2, energy: 0, flexible: 0 },
    });

    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [normalCard],
          resourceBank: [
            { instanceId: 'r1', resourceType: 'mana', exhausted: false },
            { instanceId: 'r2', resourceType: 'mana', exhausted: false },
          ],
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canDeploy).toHaveLength(1);
    expect(actions.canDeploy[0]!.isXCost).toBe(false);
    expect(actions.canDeploy[0]!.maxX).toBe(0);
  });
});

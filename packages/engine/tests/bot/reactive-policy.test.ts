/**
 * Reactive bot policy (chooseReactiveAction) — deterministic hold/counter logic.
 *
 * The bot counters a high-value enemy spell on the stack (removal/burst) with the
 * cheapest held Counter, holds against low-value chaff, and passes when it has no
 * legal Counter. Pure function of GameState (no RNG).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { chooseReactiveAction } from '../../src/bot/heuristic.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard, StackItem, PendingPriority } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

function manaBank(n: number, prefix = 'm'): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `${prefix}${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

function counterCard(id: string, cost: number): ReturnType<typeof mockCard> {
  const ability: AbilityDSL = {
    type: 'triggered',
    trigger: { type: 'on_counter' },
    effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
  };
  return mockCard({ instanceId: id, cardType: 'S', owner: 1, cost: { mana: cost, energy: 0, flexible: 0 }, abilities: [ability] });
}

// An enemy (player 0) spell on the stack with the given burn amount to the hero.
function enemyBurnOnStack(amount: number, sourceId: string): StackItem {
  return {
    id: `spell_${sourceId}`,
    type: 'spell',
    sourceInstanceId: sourceId,
    controllerId: 0,
    effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: amount }, target: { type: 'hero', side: 'enemy' } }],
    targets: [],
  };
}

const ALL_ACTIONS = {
  terminationMode: 'turn_cap',
  responseWindowsOnAllActions: true,
} as const;

const window1: PendingPriority = {
  type: 'priority',
  toRespondPlayerId: 1,
  window: 'cast',
  baseStackItemId: 'spell_X',
  passes: 0,
};

describe('chooseReactiveAction', () => {
  beforeEach(() => resetInstanceCounter());

  it('counters a high-value enemy burn with the cheapest held counter', () => {
    // The burn card must be findable for scoring — put it in player 0's discard.
    const burnCard = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 5 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const cheap = counterCard('CHEAP', 1);
    const pricey = counterCard('PRICEY', 3);
    const p0 = mockPlayerState(0, { discardPile: [burnCard] });
    const p1 = mockPlayerState(1, { hand: [pricey, cheap], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(5, 'BURN')],
      pendingPriority: window1,
    });
    const action = chooseReactiveAction(state);
    expect(action).not.toBeNull();
    expect(action).toMatchObject({ type: 'cast_spell', cardInstanceId: 'CHEAP', selectedTargetIds: ['spell_BURN'] });
  });

  it('holds (passes) against a low-value enemy spell', () => {
    const chaff = mockCard({ instanceId: 'CHAFF', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 1 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const cheap = counterCard('CHEAP', 1);
    const p0 = mockPlayerState(0, { discardPile: [chaff] });
    const p1 = mockPlayerState(1, { hand: [cheap], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(1, 'CHAFF')],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('passes when it holds no counter', () => {
    const burnCard = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 5 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const p0 = mockPlayerState(0, { discardPile: [burnCard] });
    const p1 = mockPlayerState(1, { hand: [], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(5, 'BURN')],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('returns null when no window is open', () => {
    const state = mockGameState({ phase: 'strategy', stack: [] });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('is deterministic (identical decision across calls)', () => {
    const burnCard = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 5 }, target: { type: 'hero', side: 'enemy' } }] }] });
    const p0 = mockPlayerState(0, { discardPile: [burnCard] });
    const p1 = mockPlayerState(1, { hand: [counterCard('CHEAP', 1)], resourceBank: manaBank(4, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [enemyBurnOnStack(5, 'BURN')],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toEqual(chooseReactiveAction(state));
  });

  it('current rules counters a lethal attack declaration', () => {
    const attacker = mockCard({
      instanceId: 'ATK',
      cardType: 'C',
      owner: 0,
      currentAtk: 8,
    });
    const p0 = mockPlayerState(0, {
      zones: {
        ...mockPlayerState(0).zones,
        frontline: [attacker, null, null],
      },
    });
    const p1 = mockPlayerState(1, {
      hand: [counterCard('CHEAP', 1)],
      resourceBank: manaBank(2, 'e'),
      hero: { ...mockPlayerState(1).hero, currentLp: 7 },
    });
    const attack: StackItem = {
      id: 'attack_ATK',
      type: 'attack',
      sourceInstanceId: 'ATK',
      controllerId: 0,
      effects: [],
      targets: ['hero'],
    };
    const state = mockGameState({
      phase: 'action',
      players: [p0, p1],
      stack: [attack],
      config: ALL_ACTIONS,
      pendingPriority: { ...window1, window: 'attack', baseStackItemId: attack.id },
    });
    expect(chooseReactiveAction(state)).toMatchObject({
      type: 'cast_spell',
      cardInstanceId: 'CHEAP',
      selectedTargetIds: ['attack_ATK'],
    });
  });

  it('current rules counters a threatening activated ability', () => {
    const p1 = mockPlayerState(1, {
      hand: [counterCard('CHEAP', 1)],
      resourceBank: manaBank(2, 'e'),
    });
    const ability: StackItem = {
      id: 'ability_SRC_0',
      type: 'ability',
      sourceInstanceId: 'SRC',
      controllerId: 0,
      effects: [{
        type: 'deal_damage',
        amount: { type: 'fixed', value: 5 },
        target: { type: 'hero', side: 'enemy' },
      }],
      targets: [],
    };
    const state = mockGameState({
      players: [mockPlayerState(0), p1],
      stack: [ability],
      config: ALL_ACTIONS,
      pendingPriority: { ...window1, window: 'ability', baseStackItemId: ability.id },
    });
    expect(chooseReactiveAction(state)).toMatchObject({
      selectedTargetIds: ['ability_SRC_0'],
    });
  });

  it('current rules counters a large equipment declaration', () => {
    const equipment = mockCard({
      instanceId: 'GEAR',
      cardType: 'E',
      owner: 0,
      baseAtk: 6,
      currentAtk: 6,
      abilities: [{
        type: 'aura',
        effects: [{
          type: 'modify_stats',
          target: { type: 'self' },
          modifier: { atk: 6 },
          duration: 'permanent',
        }],
      }],
    });
    const p1 = mockPlayerState(1, {
      hand: [counterCard('CHEAP', 1)],
      resourceBank: manaBank(2, 'e'),
    });
    const equip: StackItem = {
      id: 'equip_GEAR',
      type: 'equip',
      sourceInstanceId: 'GEAR',
      controllerId: 0,
      effects: [{
        type: 'modify_stats',
        target: { type: 'self' },
        modifier: { atk: 6 },
        duration: 'permanent',
      }],
      targets: ['HOLDER'],
      declaredCard: equipment,
    };
    const state = mockGameState({
      players: [mockPlayerState(0), p1],
      stack: [equip],
      config: ALL_ACTIONS,
      pendingPriority: { ...window1, window: 'equip', baseStackItemId: equip.id },
    });
    expect(chooseReactiveAction(state)).toMatchObject({
      selectedTargetIds: ['equip_GEAR'],
    });
  });

  it('current rules passes on a harmless move declaration', () => {
    const mover = mockCard({
      instanceId: 'MOV',
      cardType: 'C',
      owner: 0,
      currentAtk: 1,
    });
    const p0 = mockPlayerState(0, {
      zones: {
        ...mockPlayerState(0).zones,
        reserve: [mover, null, null],
      },
    });
    const p1 = mockPlayerState(1, {
      hand: [counterCard('CHEAP', 1)],
      resourceBank: manaBank(2, 'e'),
    });
    const move: StackItem = {
      id: 'move_MOV_frontline',
      type: 'move',
      sourceInstanceId: 'MOV',
      controllerId: 0,
      effects: [],
      targets: ['frontline'],
    };
    const state = mockGameState({
      phase: 'action',
      players: [p0, p1],
      stack: [move],
      config: ALL_ACTIONS,
      pendingPriority: { ...window1, window: 'move', baseStackItemId: move.id },
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('current rules ranks all enemy item kinds and targets the highest threat', () => {
    const attacker = mockCard({
      instanceId: 'ATK',
      cardType: 'C',
      owner: 0,
      currentAtk: 6,
    });
    const p0 = mockPlayerState(0, {
      zones: {
        ...mockPlayerState(0).zones,
        frontline: [attacker, null, null],
      },
    });
    const p1 = mockPlayerState(1, {
      hand: [counterCard('CHEAP', 1)],
      resourceBank: manaBank(2, 'e'),
    });
    const harmlessMove: StackItem = {
      id: 'move_ATK_frontline',
      type: 'move',
      sourceInstanceId: 'ATK',
      controllerId: 0,
      effects: [],
      targets: ['frontline'],
    };
    const dangerousAttack: StackItem = {
      id: 'attack_ATK',
      type: 'attack',
      sourceInstanceId: 'ATK',
      controllerId: 0,
      effects: [],
      targets: ['hero'],
    };
    const state = mockGameState({
      phase: 'action',
      players: [p0, p1],
      stack: [dangerousAttack, harmlessMove],
      config: ALL_ACTIONS,
      pendingPriority: {
        ...window1,
        window: 'move',
        baseStackItemId: harmlessMove.id,
      },
    });
    expect(chooseReactiveAction(state)).toMatchObject({
      selectedTargetIds: ['attack_ATK'],
    });
  });

  it('evaluates the newest item when a board counter cannot target an older threat', () => {
    const attacker = mockCard({
      instanceId: 'ATK',
      cardType: 'C',
      owner: 0,
      currentAtk: 8,
    });
    const boardCounter = mockCard({
      instanceId: 'BOARD_COUNTER',
      cardType: 'C',
      owner: 1,
      abilities: [{
        type: 'triggered',
        trigger: {
          type: 'on_counter',
          cost: { mana: 0, energy: 0, flexible: 0 },
        },
        effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
      }],
    });
    const p0 = mockPlayerState(0, {
      zones: {
        ...mockPlayerState(0).zones,
        frontline: [attacker, null, null],
      },
    });
    const p1 = mockPlayerState(1, {
      zones: {
        ...mockPlayerState(1).zones,
        frontline: [boardCounter, null, null],
      },
    });
    const attack: StackItem = {
      id: 'attack_ATK',
      type: 'attack',
      sourceInstanceId: 'ATK',
      controllerId: 0,
      effects: [],
      targets: ['hero'],
    };
    const harmlessMove: StackItem = {
      id: 'move_ATK_frontline',
      type: 'move',
      sourceInstanceId: 'ATK',
      controllerId: 0,
      effects: [],
      targets: ['frontline'],
    };
    const state = mockGameState({
      phase: 'action',
      players: [p0, p1],
      stack: [attack, harmlessMove],
      config: {
        ...ALL_ACTIONS,
        boardReactions: true,
      },
      pendingPriority: {
        ...window1,
        window: 'move',
        baseStackItemId: harmlessMove.id,
      },
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });
});

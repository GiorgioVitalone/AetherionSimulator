import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction, refreshCards, decrementHeroCooldowns } from '../../src/state-machine/actions.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import type { GameState } from '../../src/types/game-state.js';
import type { TriggeredAbilityDSL } from '../../src/types/ability.js';
import {
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
  ZERO_COST,
} from '../helpers/card-factory.js';

let state: GameState;

beforeEach(() => {
  resetInstanceCounter();
});

function makeActivatedAbility(overrides?: Partial<{
  cost: { mana: number; energy: number; flexible: number };
  cooldown: number;
  oncePerGame: boolean;
  effects: readonly any[];
}>): TriggeredAbilityDSL {
  return {
    type: 'triggered',
    trigger: {
      type: 'activated',
      cost: overrides?.cost ?? ZERO_COST,
      cooldown: overrides?.cooldown,
      oncePerGame: overrides?.oncePerGame,
    },
    effects: overrides?.effects ?? [{
      type: 'deploy_token',
      token: { name: 'Undead Thrall', atk: 2, hp: 1 },
      count: 1,
    }],
  };
}

describe('executeActivateHeroAbility', () => {
  it('should return effectWorkItem with ability effects', () => {
    const ability = makeActivatedAbility();
    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({ abilities: [ability] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'activate_hero_ability',
      abilityIndex: 0,
    });

    expect(result.effectWorkItem).toBeDefined();
    expect(result.effectWorkItem!.effects).toHaveLength(1);
    expect(result.effectWorkItem!.effects[0]!.type).toBe('deploy_token');
  });

  it('should set cooldown after activation', () => {
    const ability = makeActivatedAbility({ cooldown: 3 });
    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({ abilities: [ability] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'activate_hero_ability',
      abilityIndex: 0,
    });

    const hero = result.state.players[0]!.hero;
    expect(hero.cooldowns.get(0)).toBe(3);
  });

  it('should not activate when on cooldown', () => {
    const ability = makeActivatedAbility({ cooldown: 3 });
    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({
            abilities: [ability],
            cooldowns: new Map([[0, 2]]),
          }),
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canActivateHeroAbility).toHaveLength(0);
  });

  it('should not activate when insufficient resources', () => {
    const ability = makeActivatedAbility({ cost: { mana: 5, energy: 0, flexible: 0 } });
    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({ abilities: [ability] }),
          resourceBank: [], // No resources
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canActivateHeroAbility).toHaveLength(0);
  });

  it('should not show hero abilities during action phase', () => {
    const ability = makeActivatedAbility();
    state = mockGameState({
      phase: 'action',
      players: [
        mockPlayerState(0, {
          hero: mockHero({ abilities: [ability] }),
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canActivateHeroAbility).toHaveLength(0);
  });

  it('should not activate on the turn hero transforms', () => {
    const ability = makeActivatedAbility();
    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({
            abilities: [ability],
            transformedThisTurn: true,
          }),
        }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    expect(actions.canActivateHeroAbility).toHaveLength(0);
  });

  it('should emit HERO_ABILITY_ACTIVATED event', () => {
    const ability = makeActivatedAbility();
    state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({ abilities: [ability] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executePlayerAction(state, {
      type: 'activate_hero_ability',
      abilityIndex: 0,
    });

    expect(result.events).toContainEqual({
      type: 'HERO_ABILITY_ACTIVATED',
      playerId: 0,
      abilityIndex: 0,
    });
  });
});

describe('decrementHeroCooldowns', () => {
  it('should decrement cooldowns and remove when reaching 0', () => {
    state = mockGameState({
      players: [
        mockPlayerState(0, {
          hero: mockHero({
            cooldowns: new Map([[0, 2], [1, 1]]),
          }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = decrementHeroCooldowns(state);
    const hero = result.players[0]!.hero;

    // Ability 0: 2 -> 1 (still on cooldown)
    expect(hero.cooldowns.get(0)).toBe(1);
    // Ability 1: 1 -> 0 (removed)
    expect(hero.cooldowns.has(1)).toBe(false);
  });

  it('should handle empty cooldowns map', () => {
    state = mockGameState();
    const result = decrementHeroCooldowns(state);
    expect(result.players[0]!.hero.cooldowns.size).toBe(0);
  });
});

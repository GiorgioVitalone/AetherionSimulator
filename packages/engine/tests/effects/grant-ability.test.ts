/**
 * grant_ability tests — verify the interpreter stores a granted triggered
 * ability on the target (abilities + registeredTriggers) so it participates in
 * the dispatch runtime, e.g. an equipped character that gains a Last Breath.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/index.js';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  getAllRegisteredTriggers,
  registerCardTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import { removeCardFromState } from '../../src/effects/state-helpers.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState, GameEvent } from '../../src/types/game-state.js';
import type { Effect, GrantedAbilityRef } from '../../src/types/effects.js';

const ctx = (over: Record<string, unknown> = {}) => ({
  sourceInstanceId: 'EQUIP',
  controllerId: 0 as const,
  triggerDepth: 0,
  ...over,
});

const onDestroyDealTwo: GrantedAbilityRef = {
  trigger: { type: 'on_destroy' },
  effects: [
    { type: 'deal_damage', amount: { type: 'fixed', value: 2 }, target: { type: 'hero', side: 'enemy' } },
  ],
};

function buildState(): GameState {
  const bearer = mockCard({ instanceId: 'BEARER', owner: 0, name: 'Knight' });
  return mockGameState({
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ frontline: [bearer, null, null] }) }),
      mockPlayerState(1),
    ],
  });
}

describe('grant_ability', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('stores the granted ability and its registered trigger on the target', () => {
    const grant = { type: 'grant_ability', ability: onDestroyDealTwo, target: { type: 'self' }, duration: { type: 'while_in_play' } } as unknown as Effect;
    const r = executeEffect(buildState(), grant, ctx({ selectedTargets: ['BEARER'] }));
    const bearer = r.newState.players[0]!.zones.frontline[0]!;
    expect(bearer.abilities).toHaveLength(1);
    expect(bearer.abilities[0]!.type).toBe('triggered');
    expect(bearer.registeredTriggers).toHaveLength(1);
    expect(bearer.registeredTriggers[0]!.trigger.type).toBe('on_destroy');
  });

  it('equipping a Last Breath actually deals 2 to the enemy hero when the bearer dies', () => {
    const grant = { type: 'grant_ability', ability: onDestroyDealTwo, target: { type: 'self' }, duration: { type: 'while_in_play' } } as unknown as Effect;
    const granted = executeEffect(buildState(), grant, ctx({ selectedTargets: ['BEARER'] })).newState;

    // Snapshot the trigger pool, then destroy the bearer before dispatch (Last Breath timing).
    const pool = getAllRegisteredTriggers(granted);
    const afterRemoval = removeCardFromState(granted, 'BEARER');
    const destroyEvent: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'BEARER', cause: 'effect', playerId: 0 };

    const result = dispatchTriggers(afterRemoval, [destroyEvent], 0, pool);

    expect(result.newState.players[1]!.hero.currentLp).toBe(23);
    expect(result.events.some(e => e.type === 'HERO_DAMAGED')).toBe(true);
  });

  it('fires the granted ability EXACTLY once even after registerCardTriggers re-runs', () => {
    const grant = { type: 'grant_ability', ability: onDestroyDealTwo, target: { type: 'self' }, duration: { type: 'while_in_play' } } as unknown as Effect;
    const granted = executeEffect(buildState(), grant, ctx({ selectedTargets: ['BEARER'] })).newState;

    // Re-run registration on the bearer (the latent double-registration path).
    const reRegistered = registerCardTriggers(granted, 'BEARER');
    const bearer = reRegistered.players[0]!.zones.frontline[0]!;
    expect(bearer.registeredTriggers).toHaveLength(1);

    const pool = getAllRegisteredTriggers(reRegistered);
    const afterRemoval = removeCardFromState(reRegistered, 'BEARER');
    const destroyEvent: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'BEARER', cause: 'effect', playerId: 0 };

    const result = dispatchTriggers(afterRemoval, [destroyEvent], 0, pool);

    // 2 damage, NOT 4 — the granted ability must fire exactly once.
    expect(result.newState.players[1]!.hero.currentLp).toBe(23);
    expect(result.events.filter(e => e.type === 'HERO_DAMAGED')).toHaveLength(1);
  });

  it('is deterministic — identical grants produce identical state', () => {
    const grant = { type: 'grant_ability', ability: onDestroyDealTwo, target: { type: 'self' }, duration: { type: 'while_in_play' } } as unknown as Effect;
    const run = (): string => {
      resetInstanceCounter();
      resetRegistrationCounter();
      const r = executeEffect(buildState(), grant, ctx({ selectedTargets: ['BEARER'] }));
      return JSON.stringify(r.newState);
    };
    expect(run()).toBe(run());
  });
});

/**
 * Once-per-game and DSL-top-level once-per-turn gating.
 *
 * Closes two audit holes in computeActivateOptions:
 *  - oncePerGame authored on a trigger (transformed-Hero Ultimates ids 3/41/103)
 *    was ignored (gating only read oncePerTurn) — it must lock out for the whole
 *    game after one activation, even across the turn cycle.
 *  - oncePerTurn authored at the DSL top level (TriggeredAbilityDSL.oncePerTurn,
 *    e.g. Sapphire Lens of Foresight id 100) was not read — gating only honored the
 *    trigger-level Activated.oncePerTurn.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeAvailableActions,
  heroInstanceId,
} from '../../src/actions/available-actions.js';
import {
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameEvent } from '../../src/types/game-state.js';

const ZERO = { mana: 0, energy: 0, flexible: 0 } as const;

/** 0-cost activated ability with oncePerGame on the trigger (Ultimate shape). */
function oncePerGameAbility(): AbilityDSL {
  return { type: 'triggered', trigger: { type: 'activated', cost: ZERO, oncePerGame: true }, effects: [] };
}

/** 0-cost activated ability with oncePerTurn at the DSL top level (Sapphire Lens). */
function dslOncePerTurnAbility(): AbilityDSL {
  return { type: 'triggered', oncePerTurn: true, trigger: { type: 'activated', cost: ZERO }, effects: [] };
}

function turnStart(playerId: 0 | 1, turnNumber: number): GameEvent {
  return { type: 'TURN_START', playerId, turnNumber };
}

function activation(id: string, abilityIndex: number): GameEvent {
  return { type: 'ABILITY_ACTIVATED', cardInstanceId: id, abilityIndex };
}

function idx0Available(ability: AbilityDSL, log: GameEvent[]): boolean {
  const hero = mockHero({ abilities: [ability] });
  const state = mockGameState({
    phase: 'strategy',
    log,
    players: [mockPlayerState(0, { hero }), mockPlayerState(1)],
  });
  const heroId = heroInstanceId(state.players[0]!);
  return computeAvailableActions(state).canActivateAbility.some(
    o => o.cardInstanceId === heroId && o.abilityIndex === 0,
  );
}

describe('oncePerGame gating', () => {
  beforeEach(() => resetInstanceCounter());
  const heroId = 'hero_100';

  it('is available before it has ever been activated', () => {
    expect(idx0Available(oncePerGameAbility(), [turnStart(0, 1)])).toBe(true);
  });

  it('is unavailable for the rest of the game after a single activation', () => {
    const log = [turnStart(0, 1), activation(heroId, 0)];
    expect(idx0Available(oncePerGameAbility(), log)).toBe(false);
  });

  it('stays unavailable across the turn cycle (later own turns do NOT refresh it)', () => {
    const log: GameEvent[] = [
      turnStart(0, 1),
      activation(heroId, 0),
      turnStart(1, 2),
      turnStart(0, 3), // a fresh own turn — still locked out
    ];
    expect(idx0Available(oncePerGameAbility(), log)).toBe(false);
  });
});

describe('DSL-top-level oncePerTurn gating', () => {
  beforeEach(() => resetInstanceCounter());
  const heroId = 'hero_100';

  it('is available when not yet used this turn', () => {
    expect(idx0Available(dslOncePerTurnAbility(), [turnStart(0, 1)])).toBe(true);
  });

  it('is unavailable for the rest of the turn after firing', () => {
    const log = [turnStart(0, 1), activation(heroId, 0)];
    expect(idx0Available(dslOncePerTurnAbility(), log)).toBe(false);
  });

  it('refreshes on a new turn (once-per-TURN, not once-per-game)', () => {
    const log: GameEvent[] = [
      turnStart(0, 1),
      activation(heroId, 0),
      turnStart(1, 2),
      turnStart(0, 3), // new own turn — available again
    ];
    expect(idx0Available(dslOncePerTurnAbility(), log)).toBe(true);
  });
});

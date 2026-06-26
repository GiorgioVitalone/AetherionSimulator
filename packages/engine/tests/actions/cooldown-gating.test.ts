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

/** A 0-cost activated Hero ability with the given cooldown (mirrors Kaelthar idx0). */
function activatedAbility(cooldown: number): AbilityDSL {
  return {
    type: 'triggered',
    trigger: {
      type: 'activated',
      cost: { mana: 0, energy: 0, flexible: 0 },
      cooldown,
    },
    effects: [],
  };
}

/** Build the active player's (index 0) own TURN_START log entries up to `ownTurns`
 * of their own turns, interleaving the opponent's turns. Turn numbers alternate. */
function turnStarts(ownTurns: number): GameEvent[] {
  const events: GameEvent[] = [];
  // Player 0 takes odd turn numbers (1, 3, 5, …); player 1 the even ones.
  let turnNumber = 1;
  for (let i = 0; i < ownTurns; i++) {
    events.push({ type: 'TURN_START', playerId: 0, turnNumber });
    events.push({ type: 'TURN_START', playerId: 1, turnNumber: turnNumber + 1 });
    turnNumber += 2;
  }
  return events;
}

function activation(heroId: string, abilityIndex: number): GameEvent {
  return { type: 'ABILITY_ACTIVATED', cardInstanceId: heroId, abilityIndex };
}

/** Compute, for a hero with the given ability, whether idx0 is activatable given a log. */
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

describe('Cooldown gating', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('Kaelthar idx0 (cooldown 3)', () => {
    const heroId = `hero_100`; // mockHero cardDefId default

    it('is available on turn T (never activated yet)', () => {
      const log = turnStarts(1); // own turn 0 has started
      expect(idx0Available(activatedAbility(3), log)).toBe(true);
    });

    it('is unavailable for the rest of turn T after firing', () => {
      const log = [...turnStarts(1), activation(heroId, 0)];
      expect(idx0Available(activatedAbility(3), log)).toBe(false);
    });

    it('stays unavailable on the next two of the player own turns (T+1, T+2)', () => {
      // Activate during own turn 0, then advance to own turn 1 and own turn 2.
      const base = [...turnStarts(1), activation(heroId, 0)];
      const atOwnTurn1 = [...base, ...turnStarts(1)]; // 1 own TURN_START after activation
      const atOwnTurn2 = [...base, ...turnStarts(2)]; // 2 own TURN_STARTs after activation
      expect(idx0Available(activatedAbility(3), atOwnTurn1)).toBe(false);
      expect(idx0Available(activatedAbility(3), atOwnTurn2)).toBe(false);
    });

    it('becomes available again on T+3 (every 3rd turn, not every turn)', () => {
      const base = [...turnStarts(1), activation(heroId, 0)];
      const atOwnTurn3 = [...base, ...turnStarts(3)]; // 3 own TURN_STARTs after activation
      expect(idx0Available(activatedAbility(3), atOwnTurn3)).toBe(true);
    });
  });

  describe('generic cooldown', () => {
    const heroId = `hero_100`;

    it('cooldown 0 imposes no restriction (usable every turn)', () => {
      const log = [...turnStarts(1), activation(heroId, 0), ...turnStarts(1)];
      expect(idx0Available(activatedAbility(0), log)).toBe(true);
    });

    it('cooldown 1 blocks the next own turn and frees the one after', () => {
      const base = [...turnStarts(1), activation(heroId, 0)];
      const atOwnTurn1 = [...base, ...turnStarts(1)]; // elapsed 1, not < 1 -> available
      expect(idx0Available(activatedAbility(1), atOwnTurn1)).toBe(true);
    });

    it('cooldown 2 frees only after 2 of the player own turns elapse', () => {
      const base = [...turnStarts(1), activation(heroId, 0)];
      expect(idx0Available(activatedAbility(2), [...base, ...turnStarts(1)])).toBe(false);
      expect(idx0Available(activatedAbility(2), [...base, ...turnStarts(2)])).toBe(true);
    });

    it('counts only the active player own turns, not the opponent turns', () => {
      // After activation, only opponent TURN_STARTs are logged: still on cooldown.
      const log: GameEvent[] = [
        ...turnStarts(1),
        activation(heroId, 0),
        { type: 'TURN_START', playerId: 1, turnNumber: 2 },
      ];
      expect(idx0Available(activatedAbility(3), log)).toBe(false);
    });
  });
});

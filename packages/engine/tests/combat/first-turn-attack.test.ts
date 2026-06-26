/**
 * Wave 5 — A21: The first player cannot declare attacks on their first turn
 * (Rulebook 7). Gated both in computeAvailableActions (no attack offered) and
 * defensively in resolveCombat (throws if attempted).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function actionState(firstPlayerFirstTurn: boolean) {
  const attacker = mockCard({ exhausted: false, summoningSick: false, currentAtk: 3 });
  const defender = mockCard({ owner: 1, currentHp: 5 });
  const state = mockGameState({
    phase: 'action',
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn },
    players: [
      mockPlayerState(0, { zones: zonesWithCards({ frontline: [attacker] }) }),
      mockPlayerState(1, { zones: zonesWithCards({ frontline: [defender] }) }),
    ],
  });
  return { state, attacker, defender };
}

describe('A21 — no first-turn attack for the first player', () => {
  beforeEach(resetInstanceCounter);

  it('offers NO attacks while firstPlayerFirstTurn is set', () => {
    const { state } = actionState(true);
    expect(computeAvailableActions(state).canAttack).toEqual([]);
  });

  it('offers attacks once firstPlayerFirstTurn is cleared', () => {
    const { state } = actionState(false);
    expect(computeAvailableActions(state).canAttack.length).toBeGreaterThan(0);
  });

  it('resolveCombat throws if a first-turn attack is forced', () => {
    const { state, attacker, defender } = actionState(true);
    expect(() => resolveCombat(state, attacker.instanceId, defender.instanceId)).toThrow(
      /first turn/i,
    );
  });

  it('resolveCombat proceeds when firstPlayerFirstTurn is cleared', () => {
    const { state, attacker, defender } = actionState(false);
    expect(() => resolveCombat(state, attacker.instanceId, defender.instanceId)).not.toThrow();
  });
});

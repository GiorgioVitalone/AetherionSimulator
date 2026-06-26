/**
 * scheduled tests — enqueue an effect to fire at a future phase boundary.
 *
 * A `scheduled` effect appends a ScheduledEntry to GameState.scheduledEffects.
 * The turn machine fires matching entries at the boundary:
 *   - end_of_turn at the end phase,
 *   - next_turn_start / next_upkeep at upkeep.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { executeEffect } from '../../src/effects/interpreter.js';
import { runScheduledEffects } from '../../src/state-machine/actions.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { deployToZone, findCard } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type {
  EffectContext,
  GameState,
  ResourceCard,
} from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

const dealSelf = (value: number): Effect => ({
  type: 'deal_damage',
  amount: { type: 'fixed', value },
  target: { type: 'self' },
});

const schedule = (timing: Extract<Effect, { type: 'scheduled' }>['timing'], effects: readonly Effect[]): Effect => ({
  type: 'scheduled',
  timing,
  effects,
});

function bank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `r_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

describe('scheduled effect', () => {
  beforeEach(() => resetInstanceCounter());

  it('enqueues an entry on the scheduled queue', () => {
    const source = mockCard({ owner: 0 });
    const state = mockGameState();
    const result = executeEffect(
      state,
      schedule({ type: 'end_of_turn' }, [dealSelf(1)]),
      ctx(source.instanceId, 0),
    );
    const queue = result.newState.scheduledEffects ?? [];
    expect(queue).toHaveLength(1);
    expect(queue[0]!.timing).toEqual({ type: 'end_of_turn' });
    expect(queue[0]!.controllerId).toBe(0);
  });

  it("fires an 'end_of_turn deal 1' and drops it from the queue", () => {
    const character = mockCard({ name: 'Marked', currentHp: 3, baseHp: 3, owner: 0 });
    const zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    const base = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    // Schedule "deal 1 to self" on the character, timed for end of turn.
    const scheduled = executeEffect(
      base,
      schedule({ type: 'end_of_turn' }, [dealSelf(1)]),
      ctx(character.instanceId, 0),
    ).newState;
    expect((scheduled.scheduledEffects ?? [])).toHaveLength(1);

    const fired = runScheduledEffects(scheduled, 'end_of_turn');
    const after = findCard(fired.state.players[0].zones, character.instanceId);
    expect(after?.card.currentHp).toBe(2); // took 1 damage
    expect(fired.state.scheduledEffects ?? []).toHaveLength(0); // dequeued
  });

  it('does not fire entries whose timing does not match', () => {
    const character = mockCard({ currentHp: 3, baseHp: 3, owner: 0 });
    const zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    const base = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const scheduled = executeEffect(
      base,
      schedule({ type: 'next_upkeep' }, [dealSelf(1)]),
      ctx(character.instanceId, 0),
    ).newState;

    const fired = runScheduledEffects(scheduled, 'end_of_turn');
    const after = findCard(fired.state.players[0].zones, character.instanceId);
    expect(after?.card.currentHp).toBe(3); // unchanged
    expect(fired.state.scheduledEffects ?? []).toHaveLength(1); // still queued
  });

  it('fires an end_of_turn schedule when the machine reaches the end phase', () => {
    const character = mockCard({ name: 'Ticker', currentHp: 5, baseHp: 5, owner: 0 });
    let zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    const resDeck = Array.from({ length: 5 }, (_, i) => ({
      instanceId: `rd_${String(i)}`,
      resourceType: 'mana' as const,
      exhausted: false,
    }));
    const deck = Array.from({ length: 10 }, () => mockCard({ owner: 0 }));
    let state: GameState = mockGameState({
      phase: 'upkeep',
      players: [
        mockPlayerState(0, {
          zones,
          mainDeck: deck,
          resourceDeck: resDeck,
          resourceBank: bank(2),
        }),
        mockPlayerState(1, { mainDeck: [...deck] }),
      ],
    });
    state = executeEffect(
      state,
      schedule({ type: 'end_of_turn' }, [dealSelf(2)]),
      ctx(character.instanceId, 0),
    ).newState;

    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    actor.send({ type: 'END_PHASE' }); // strategy → action
    actor.send({ type: 'END_PHASE' }); // action → endPhase (fires) → passTurn → next turn

    const final = actor.getSnapshot().context.gameState;
    const after = findCard(final.players[0].zones, character.instanceId);
    expect(after?.card.currentHp).toBe(3); // 5 - 2
    expect(final.scheduledEffects ?? []).toHaveLength(0);
  });
});

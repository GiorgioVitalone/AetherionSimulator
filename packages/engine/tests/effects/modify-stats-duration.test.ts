import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { executeEffect } from '../../src/effects/interpreter.js';
import { expireModifiers } from '../../src/runtime/modifier-expiry.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { Duration } from '../../src/types/durations.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { EffectContext, GameState, ResourceCard } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

function buff(duration: Duration): Effect {
  return {
    type: 'modify_stats',
    modifier: { arm: 1 },
    target: { type: 'self' },
    duration,
  };
}

/** A 0-cost activated ability that gives the source +1 ARM for `duration`. */
function selfBuffAbility(duration: Duration): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 } },
    effects: [buff(duration)],
  };
}

function makeBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

// A live game seeded with one player-0 frontline card carrying a self-buff
// activated ability, so the buff is applied mid-strategy (after upkeep) exactly
// as it would be in real play.
const BUFF_CARD_ID = 'BUFFER';
function playableWithSelfBuff(duration: Duration): GameState {
  const buffer = mockCard({
    instanceId: BUFF_CARD_ID,
    currentArm: 0,
    owner: 0,
    exhausted: false,
    abilities: [selfBuffAbility(duration)],
  });
  const p0Zones = deployToZone(emptyZones(), buffer, 'frontline');
  const deck = Array.from({ length: 20 }, (_, i) => mockCard({ name: `D${String(i)}`, owner: 0 }));
  const deck2 = Array.from({ length: 20 }, (_, i) => mockCard({ name: `E${String(i)}`, owner: 1 }));
  const resDeck = makeBank(10);
  return mockGameState({
    phase: 'upkeep',
    pendingChoice: null,
    players: [
      mockPlayerState(0, { zones: p0Zones, mainDeck: deck, resourceDeck: [...resDeck], resourceBank: makeBank(3) }),
      mockPlayerState(1, { mainDeck: deck2, resourceDeck: [...resDeck], resourceBank: makeBank(1) }),
    ],
  });
}

const activateBuff = {
  type: 'activate_ability' as const,
  cardInstanceId: BUFF_CARD_ID,
  abilityIndex: 0,
};

function bufferArm(state: GameState): number {
  return state.players[0]!.zones.frontline.find(c => c?.instanceId === BUFF_CARD_ID)!.currentArm;
}

describe('modify_stats duration', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('interpreter records timed modifiers', () => {
    it('records an until_next_upkeep modifier and applies stats', () => {
      const card = mockCard({ currentArm: 0, owner: 0 });
      const zones = deployToZone(emptyZones(), card, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

      const result = executeEffect(state, buff({ type: 'until_next_upkeep' }), ctx(card.instanceId, 0));
      const buffed = result.newState.players[0]!.zones.frontline[0]!;
      expect(buffed.currentArm).toBe(1);
      expect(buffed.modifiers).toHaveLength(1);
      expect(buffed.modifiers[0]!.duration.type).toBe('until_next_upkeep');
    });

    it('does NOT record a modifier for permanent buffs', () => {
      const card = mockCard({ currentArm: 0, owner: 0 });
      const zones = deployToZone(emptyZones(), card, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

      const result = executeEffect(state, buff({ type: 'permanent' }), ctx(card.instanceId, 0));
      const buffed = result.newState.players[0]!.zones.frontline[0]!;
      expect(buffed.currentArm).toBe(1);
      expect(buffed.modifiers).toHaveLength(0);
    });
  });

  describe('expireModifiers helper', () => {
    it('removes the modifier and undoes its stat contribution at boundary', () => {
      const card = mockCard({ currentArm: 0, owner: 0 });
      const zones = deployToZone(emptyZones(), card, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

      const buffed = executeEffect(state, buff({ type: 'until_end_of_turn' }), ctx(card.instanceId, 0)).newState;
      expect(buffed.players[0]!.zones.frontline[0]!.currentArm).toBe(1);

      const expired = expireModifiers(buffed, 0, 'until_end_of_turn');
      const after = expired.players[0]!.zones.frontline[0]!;
      expect(after.currentArm).toBe(0);
      expect(after.modifiers).toHaveLength(0);
    });

    it('leaves a different boundary untouched', () => {
      const card = mockCard({ currentArm: 0, owner: 0 });
      const zones = deployToZone(emptyZones(), card, 'frontline');
      const state = mockGameState({ players: [mockPlayerState(0, { zones }), mockPlayerState(1)] });

      const buffed = executeEffect(state, buff({ type: 'until_next_upkeep' }), ctx(card.instanceId, 0)).newState;
      const expired = expireModifiers(buffed, 0, 'until_end_of_turn');
      const after = expired.players[0]!.zones.frontline[0]!;
      expect(after.currentArm).toBe(1);
      expect(after.modifiers).toHaveLength(1);
    });
  });

  describe('boundaries through the state machine', () => {
    it('until_end_of_turn buff is gone at end of turn', () => {
      const actor = createActor(gameMachine, {
        input: { gameState: playableWithSelfBuff({ type: 'until_end_of_turn' }) },
      });
      actor.start(); // → player 0 strategy (after upkeep)

      actor.send({ type: 'PLAYER_ACTION', action: activateBuff });
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(1);

      actor.send({ type: 'END_PHASE' }); // strategy → action
      actor.send({ type: 'END_PHASE' }); // action → endPhase (expire) → next turn
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(0);
    });

    it('until_next_upkeep buff survives the turn end but is gone at the next upkeep', () => {
      const actor = createActor(gameMachine, {
        input: { gameState: playableWithSelfBuff({ type: 'until_next_upkeep' }) },
      });
      actor.start(); // player 0 strategy

      actor.send({ type: 'PLAYER_ACTION', action: activateBuff });
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(1);

      // End player 0's turn — buff must STILL be present through the opponent's turn.
      actor.send({ type: 'END_PHASE' });
      actor.send({ type: 'END_PHASE' }); // now player 1's turn
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(1);

      // End player 1's turn → player 0's next upkeep fires expiry.
      actor.send({ type: 'END_PHASE' });
      actor.send({ type: 'END_PHASE' });
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(0);
    });

    it('permanent buff persists across turn boundaries', () => {
      const actor = createActor(gameMachine, {
        input: { gameState: playableWithSelfBuff({ type: 'permanent' }) },
      });
      actor.start();

      actor.send({ type: 'PLAYER_ACTION', action: activateBuff });
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(1);

      actor.send({ type: 'END_PHASE' });
      actor.send({ type: 'END_PHASE' }); // player 1 turn
      actor.send({ type: 'END_PHASE' });
      actor.send({ type: 'END_PHASE' }); // back to player 0, after upkeep expiry
      expect(bufferArm(actor.getSnapshot().context.gameState)).toBe(1);
    });
  });
});

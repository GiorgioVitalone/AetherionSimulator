/**
 * Reactive priority window (Rulebook Section 14) — minimal-faithful slice.
 *
 * A spell cast pushes a `spell` StackItem and opens a response window for the
 * non-active player when they hold a legal Counter/Flash. The responder may cast
 * a Counter (which negates the targeted spell so its effects never resolve) or
 * pass; two passes resolve the chain LIFO. When no responder can react the cast
 * resolves inline (byte-identical to the old resolve-on-cast behavior).
 *
 * Canonical acceptance: the l.546 worked example shape — an enemy burn spell is
 * cast, the opponent Counters it, and the burn never lands.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { gameMachine } from '../../src/state-machine/index.js';
import {
  executePlayerAction,
  executeReactiveResponse,
  executePriorityPass,
} from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

function manaBank(n: number, prefix = 'm'): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `${prefix}${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

// A burn spell: deal 4 to the enemy Hero.
function burnSpell(): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'on_cast' },
    effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 4 }, target: { type: 'hero', side: 'enemy' } }],
  };
}

// A Counterspell: on_counter, counters a targeted spell on the stack.
function counterSpell(): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'on_counter' },
    effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
  };
}

// A Flash trick: on_flash, heal our Hero by 3 (no enemy spell required).
function flashHeal(): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'on_flash' },
    effects: [{ type: 'heal', amount: { type: 'fixed', value: 3 }, target: { type: 'hero', side: 'allied' } }],
  };
}

describe('reactive priority window', () => {
  beforeEach(() => resetInstanceCounter());

  it('resolves a cast inline when the opponent holds no reactive spell (byte-identical)', () => {
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hero: { ...mockPlayerState(1).hero, currentLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    const r = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'BURN' });
    // No window opened; the burn resolved immediately.
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.stack).toHaveLength(0);
    expect(r.state.players[1].hero.currentLp).toBe(21);
  });

  it('opens a window and a Counter negates the spell so its damage never lands', () => {
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const cs = mockCard({ instanceId: 'CS', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [counterSpell()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [cs], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    // Cast opens a window (opponent holds a Counter).
    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'BURN' });
    expect(cast.state.pendingPriority?.toRespondPlayerId).toBe(1);
    expect(cast.state.stack).toHaveLength(1);
    expect(cast.state.players[1].hero.currentLp).toBe(25); // not resolved yet

    // Opponent Counters the burn (targets the burn's stack item).
    const react = executeReactiveResponse(cast.state, {
      type: 'cast_spell',
      cardInstanceId: 'CS',
      selectedTargetIds: ['spell_BURN'],
    });
    // Active player gets priority back, then passes.
    expect(react.state.pendingPriority?.toRespondPlayerId).toBe(0);
    const pass1 = executePriorityPass(react.state);
    const pass2 = executePriorityPass(pass1.state);

    // Window closed, chain resolved: the burn was countered → no damage.
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.stack).toHaveLength(0);
    expect(pass2.state.players[1].hero.currentLp).toBe(25);
  });

  it('two passes resolve the spell when the opponent declines to counter', () => {
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const cs = mockCard({ instanceId: 'CS', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [counterSpell()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [cs], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'BURN' });
    const pass1 = executePriorityPass(cast.state); // responder passes
    const pass2 = executePriorityPass(pass1.state); // active passes → resolve
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.players[1].hero.currentLp).toBe(21);
  });

  it('a Flash trick casts during the opponent cast window', () => {
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const flash = mockCard({ instanceId: 'FL', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [flashHeal()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [flash], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 20, maxLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'BURN' });
    expect(cast.state.pendingPriority?.toRespondPlayerId).toBe(1);
    const react = executeReactiveResponse(cast.state, { type: 'cast_spell', cardInstanceId: 'FL' });
    const pass1 = executePriorityPass(react.state);
    const pass2 = executePriorityPass(pass1.state);
    // Flash heal (+3) resolved LIFO first, then the burn (-4): 20 + 3 - 4 = 19.
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.players[1].hero.currentLp).toBe(19);
  });

  it('drives the full chain through the XState machine (cast → counter → pass → resolve)', () => {
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const cs = mockCard({ instanceId: 'CS', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [counterSpell()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [cs], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 25 } });
    const gs = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      turnState: { discardedForEnergy: false, firstPlayerFirstTurn: true },
    });

    const actor = createActor(gameMachine, { input: { gameState: { ...gs, phase: 'upkeep' } } });
    actor.start();
    // Force into strategy with our crafted state by sending the cast directly.
    actor.send({ type: 'PLAYER_ACTION', action: { type: 'cast_spell', cardInstanceId: 'BURN' } });
    let snap = actor.getSnapshot();
    // We should now be in the priority window.
    expect(snap.context.gameState.pendingPriority?.toRespondPlayerId).toBe(1);

    actor.send({ type: 'REACTIVE_ACTION', action: { type: 'cast_spell', cardInstanceId: 'CS', selectedTargetIds: ['spell_BURN'] } });
    actor.send({ type: 'PRIORITY_PASS' });
    actor.send({ type: 'PRIORITY_PASS' });
    snap = actor.getSnapshot();
    expect(snap.context.gameState.pendingPriority == null).toBe(true);
    expect(snap.context.gameState.players[1].hero.currentLp).toBe(25);
    expect(snap.value).toMatchObject({ playing: 'strategy' });
  });
});

/**
 * Counter-chain LIFO correctness (Rulebook Section 14, "Worked Example — Counter
 * Chain"). The existing priority-window.test.ts covers single-link cast→counter
 * and a one-link Flash. This file locks the multi-link chain behavior the Rulebook
 * spells out and the reactive defaults that the priority pass relies on:
 *
 *  - the full 3-link worked example (Inferno ← Counterspell ← Mana Leak) for both
 *    branches of Mana Leak's `unless pay 2`;
 *  - LIFO resolution order across two friendly+enemy links;
 *  - a Counter on the chain defaulting to the newest enemy link when cast with no
 *    explicit target;
 *  - draining a window whose new priority-holder has no legal reactive response.
 *
 * These exercise the production functions the sim driver and XState machine call
 * (executePlayerAction / executeReactiveResponse / executePriorityPass), so they
 * pin the resolution outcome, not just the helper in isolation.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  executePlayerAction,
  executeReactiveResponse,
  executePriorityPass,
} from '../../src/state-machine/actions.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import { transition } from '../../src/transitions/transition.js';
import { computeReactiveActions } from '../../src/actions/reactive-actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState, ResourceCard } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

function manaBank(n: number, prefix = 'm'): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `${prefix}${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

const burnSpell = (): AbilityDSL => ({
  type: 'triggered',
  trigger: { type: 'on_cast' },
  effects: [{ type: 'deal_damage', amount: { type: 'fixed', value: 4 }, target: { type: 'hero', side: 'enemy' } }],
});

const counterSpell = (): AbilityDSL => ({
  type: 'triggered',
  trigger: { type: 'on_counter' },
  effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
});

// Mana Leak: Flash that counters a targeted spell unless its controller pays 2.
const manaLeak = (): AbilityDSL => ({
  type: 'triggered',
  trigger: { type: 'on_flash' },
  effects: [{ type: 'counter_spell', target: { type: 'target_spell' }, unlessPay: { mana: 2, energy: 0, flexible: 0 } }],
});

const flashHeal = (): AbilityDSL => ({
  type: 'triggered',
  trigger: { type: 'on_flash' },
  effects: [{ type: 'heal', amount: { type: 'fixed', value: 3 }, target: { type: 'hero', side: 'allied' } }],
});

/** Build the worked-example board. `defenderBank` mana lets us toggle whether the
 * Counterspell's controller (P1) can pay Mana Leak's `unless pay 2` at resolution:
 * P1 always spends 1 mana casting Counterspell, so a 3-mana bank leaves exactly 2. */
function workedExample(defenderBank: number, currentRules = false): GameState {
  const inferno = mockCard({ instanceId: 'INF', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
  const ml = mockCard({ instanceId: 'ML', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [manaLeak()] });
  const cs = mockCard({ instanceId: 'CS', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [counterSpell()] });
  const p0 = mockPlayerState(0, { hand: [inferno, ml], resourceBank: manaBank(4) });
  const p1 = mockPlayerState(1, {
    hand: [cs],
    resourceBank: manaBank(defenderBank, 'e'),
    hero: { ...mockPlayerState(1).hero, currentLp: 25 },
  });
  return mockGameState({
    phase: 'strategy',
    players: [p0, p1],
    ...(currentRules ? { config: CURRENT_GAME_CONFIG } : {}),
  });
}

describe('counter-chain LIFO (Rulebook 14 worked example)', () => {
  beforeEach(() => resetInstanceCounter());

  it('Inferno ← Counterspell ← Mana Leak; defender cannot pay 2 → Counterspell negated → Inferno lands', () => {
    // P1 bank = 1 mana: enough to cast Counterspell, nothing left for `pay 2`.
    const state = workedExample(1);
    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'INF' });
    expect(cast.state.stack.map(s => s.id)).toEqual(['spell_INF']);

    const link2 = executeReactiveResponse(cast.state, {
      type: 'cast_spell',
      cardInstanceId: 'CS',
      selectedTargetIds: ['spell_INF'],
    });
    const link3 = executeReactiveResponse(link2.state, {
      type: 'cast_spell',
      cardInstanceId: 'ML',
      selectedTargetIds: ['spell_CS'],
    });
    expect(link3.state.stack.map(s => s.id)).toEqual(['spell_INF', 'spell_CS', 'spell_ML']);

    const pass1 = executePriorityPass(link3.state); // active passes
    const pass2 = executePriorityPass(pass1.state); // responder passes → resolve LIFO
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.stack).toHaveLength(0);
    // Mana Leak counters Counterspell (P1 cannot pay 2) → Inferno resolves: 25 − 4.
    expect(pass2.state.players[1].hero.currentLp).toBe(21);
  });

  it('same chain; defender CAN pay 2 → Mana Leak fizzles → Counterspell negates Inferno (no damage)', () => {
    // P1 bank = 3 mana: 1 to cast Counterspell, 2 left to satisfy Mana Leak's clause.
    const state = workedExample(3);
    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'INF' });
    const link2 = executeReactiveResponse(cast.state, { type: 'cast_spell', cardInstanceId: 'CS', selectedTargetIds: ['spell_INF'] });
    const link3 = executeReactiveResponse(link2.state, { type: 'cast_spell', cardInstanceId: 'ML', selectedTargetIds: ['spell_CS'] });
    const pass2 = executePriorityPass(executePriorityPass(link3.state).state);
    expect(pass2.state.pendingPriority == null).toBe(true);
    // Mana Leak resolves first but Counterspell's controller pays 2 → Counterspell
    // survives and resolves next, negating Inferno: P1 takes no damage.
    expect(pass2.state.players[1].hero.currentLp).toBe(25);
    expect(pass2.state.players[1].resourceBank.filter((resource) => resource.exhausted)).toHaveLength(1);
  });

  it('current rules explicitly ask whether to pay the Counter tax before resuming LIFO', () => {
    const state = workedExample(3, true);
    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'INF' });
    const link2 = executeReactiveResponse(cast.state, {
      type: 'cast_spell',
      cardInstanceId: 'CS',
      selectedTargetIds: ['spell_INF'],
    });
    const link3 = executeReactiveResponse(link2.state, {
      type: 'cast_spell',
      cardInstanceId: 'ML',
      selectedTargetIds: ['spell_CS'],
    });
    expect(link3.state.stack.at(-1)?.targets).toEqual(['spell_CS']);
    const paused = executePriorityPass(executePriorityPass(link3.state).state);
    expect(paused.state.pendingChoice?.type).toBe('pay_counter_tax');
    expect(paused.state.stack.map((item) => item.id)).toEqual([
      'spell_INF',
      'spell_CS',
    ]);

    const choice = paused.state.pendingChoice!;
    const paid = transition(paused.state, {
      type: 'choice_response',
      interactionId: choice.interactionId!,
      playerId: choice.playerId,
      response: { selectedOptionIds: ['pay'] },
    });
    expect(paid.status).toBe('resolved');
    expect(paid.state.stack).toEqual([]);
    expect(paid.state.players[1].hero.currentLp).toBe(25);
    expect(paid.state.players[1].resourceBank.every((resource) => resource.exhausted)).toBe(true);
  });

  it('resolves links last-in-first-out: a Flash heal added last applies before the base burn', () => {
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const heal = mockCard({ instanceId: 'HEAL', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [flashHeal()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [heal], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 22, maxLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'BURN' });
    const flash = executeReactiveResponse(cast.state, { type: 'cast_spell', cardInstanceId: 'HEAL' });
    const done = executePriorityPass(executePriorityPass(flash.state).state);
    // LIFO: heal (+3) resolves first (22→25, capped at maxLp), then burn (−4) → 21.
    expect(done.state.players[1].hero.currentLp).toBe(21);
  });

  it('a Counter cast with no explicit target defaults to the newest enemy link', () => {
    // Two enemy spells already queued; the responder Counters the most recent one.
    const burnA = mockCard({ instanceId: 'A', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const burnB = mockCard({ instanceId: 'B', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const cs = mockCard({ instanceId: 'CS', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [counterSpell()] });
    const p0 = mockPlayerState(0, { hand: [burnA, burnB], resourceBank: manaBank(4) });
    const p1 = mockPlayerState(1, { hand: [cs], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    // Cast A, let it resolve (P1 declines), then cast B and Counter B with no target.
    const castA = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'A' });
    const aResolved = executePriorityPass(executePriorityPass(castA.state).state);
    expect(aResolved.state.players[1].hero.currentLp).toBe(21); // A landed

    const castB = executePlayerAction(aResolved.state, { type: 'cast_spell', cardInstanceId: 'B' });
    // The Counter is cast with no explicit target: its effect resolves later (LIFO),
    // so at cast time both links sit on the stack, B (the newest enemy spell) below.
    const counter = executeReactiveResponse(castB.state, { type: 'cast_spell', cardInstanceId: 'CS' });
    expect(counter.state.stack.map(s => s.id)).toEqual(['spell_B', 'spell_CS']);
    const done = executePriorityPass(executePriorityPass(counter.state).state);
    // CS resolves first and defaults to the newest enemy link (B), countering it →
    // no further damage; P1 stays at 21 (only A's burn landed).
    expect(done.state.stack).toHaveLength(0);
    expect(done.state.players[1].hero.currentLp).toBe(21);
  });

  it('drains a window whose new priority-holder has no legal reactive response', () => {
    // After P1 Counters, priority returns to P0 who holds nothing reactive. The
    // window must still close via passes and resolve correctly (no soft-lock).
    const burn = mockCard({ instanceId: 'BURN', cardType: 'S', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [burnSpell()] });
    const cs = mockCard({ instanceId: 'CS', cardType: 'S', owner: 1, cost: { mana: 1, energy: 0, flexible: 0 }, abilities: [counterSpell()] });
    const p0 = mockPlayerState(0, { hand: [burn], resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [cs], resourceBank: manaBank(2, 'e'), hero: { ...mockPlayerState(1).hero, currentLp: 25 } });
    const state = mockGameState({ phase: 'strategy', players: [p0, p1] });

    const cast = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'BURN' });
    const counter = executeReactiveResponse(cast.state, { type: 'cast_spell', cardInstanceId: 'CS', selectedTargetIds: ['spell_BURN'] });
    // P0 now holds priority but has no Counter/Flash left.
    expect(counter.state.pendingPriority?.toRespondPlayerId).toBe(0);
    expect(computeReactiveActions(counter.state, 0)).toHaveLength(0);

    const done = executePriorityPass(executePriorityPass(counter.state).state);
    expect(done.state.pendingPriority == null).toBe(true);
    expect(done.state.players[1].hero.currentLp).toBe(25); // burn countered
  });
});

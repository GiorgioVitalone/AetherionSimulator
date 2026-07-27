/**
 * Response windows on ALL actions (Rulebook Section 14) — Tier 4,
 * config.responseWindowsOnAllActions (default OFF).
 *
 * OFF: declare_attack / activate_ability / attach_equipment / move resolve
 * inline exactly as before (byte-identical — pinned hashes stay green).
 *
 * ON: each of the four pushes a StackItem and opens a response window for the
 * non-active player when they hold a legal Counter/Flash; the base action's
 * effects do NOT run until the window closes (two passes). A reaction can only
 * negate the base action when its printed target permits it; `target_spell`
 * does not widen to non-spell actions. ability/equip items carry plain
 * effects; attack/move items carry a declaration that resolveStack re-invokes
 * through resolveCombat / moveCard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { gameMachine } from '../../src/state-machine/index.js';
import {
  executePlayerAction,
  executePriorityPass,
} from '../../src/state-machine/actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState, ResourceCard } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

const ON: GameState['config'] = { terminationMode: 'turn_cap', responseWindowsOnAllActions: true };

function manaBank(n: number, prefix = 'm'): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `${prefix}${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

// A Counterspell: on_counter, counters a targeted item on the stack.
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

function counterCard(id: string, owner: 0 | 1) {
  return mockCard({
    instanceId: id,
    cardType: 'S',
    owner,
    cost: { mana: 1, energy: 0, flexible: 0 },
    abilities: [counterSpell()],
  });
}

function flashCard(id: string, owner: 0 | 1) {
  return mockCard({
    instanceId: id,
    cardType: 'S',
    owner,
    cost: { mana: 1, energy: 0, flexible: 0 },
    abilities: [flashHeal()],
  });
}

// A 2-ATK attacker on the active player's Frontline (enemy board empty ⇒ the
// Empty Board Rule makes the enemy Hero a legal target).
function attackState(config: GameState['config'], opponentHand: ReturnType<typeof mockCard>[]) {
  const attacker = mockCard({ instanceId: 'ATK', cardType: 'C', owner: 0, currentAtk: 2 });
  const p0 = mockPlayerState(0, {
    zones: deployToZone(mockPlayerState(0).zones, attacker, 'frontline', 0),
  });
  const p1 = mockPlayerState(1, {
    hand: opponentHand,
    resourceBank: manaBank(2, 'e'),
    hero: { ...mockPlayerState(1).hero, currentLp: 25 },
  });
  return mockGameState({ phase: 'action', players: [p0, p1], config });
}

describe('responseWindowsOnAllActions: declare_attack', () => {
  beforeEach(() => resetInstanceCounter());

  it('OFF: resolves inline even when the opponent holds a Counter (byte-identical legacy path)', () => {
    const state = attackState({ terminationMode: 'turn_cap' }, [counterCard('CS', 1)]);
    const r = executePlayerAction(state, {
      type: 'declare_attack',
      attackerInstanceId: 'ATK',
      targetId: 'hero',
    });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.stack).toHaveLength(0);
    expect(r.state.players[1]!.hero.currentLp).toBe(23); // combat already happened
    expect(r.events.some((e) => e.type === 'CHARACTER_ATTACKED')).toBe(true);
  });

  it('ON: opens an attack window; the combat does NOT run until the window closes (pass ×2)', () => {
    const state = attackState(ON, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, {
      type: 'declare_attack',
      attackerInstanceId: 'ATK',
      targetId: 'hero',
    });
    // Window open for the opponent; the attack is a declaration on the stack.
    expect(r.state.pendingPriority?.toRespondPlayerId).toBe(1);
    expect(r.state.pendingPriority?.window).toBe('attack');
    expect(r.state.stack).toHaveLength(1);
    expect(r.state.stack[0]!.type).toBe('attack');
    // Nothing resolved yet: no damage, attacker not yet exhausted.
    expect(r.state.players[1]!.hero.currentLp).toBe(25);
    expect(r.state.players[0]!.zones.frontline[0]?.exhausted).toBe(false);
    expect(r.events.some((e) => e.type === 'CHARACTER_ATTACKED')).toBe(false);

    const pass1 = executePriorityPass(r.state);
    const pass2 = executePriorityPass(pass1.state);
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.stack).toHaveLength(0);
    // Combat resolved on window close.
    expect(pass2.state.players[1]!.hero.currentLp).toBe(23);
    expect(pass2.state.players[0]!.zones.frontline[0]?.exhausted).toBe(true);
    expect(pass2.events.some((e) => e.type === 'CHARACTER_ATTACKED')).toBe(true);
  });

  it('ON: a target-spell Counter is not offered against an attack', () => {
    const state = attackState(ON, [counterCard('CS', 1)]);
    const r = executePlayerAction(state, {
      type: 'declare_attack',
      attackerInstanceId: 'ATK',
      targetId: 'hero',
    });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.stack).toHaveLength(0);
    expect(r.state.players[1]!.hero.currentLp).toBe(23);
    expect(r.state.players[0]!.zones.frontline[0]?.exhausted).toBe(true);
  });

  it('ON: resolves inline when the opponent holds no reaction (same as cast no-op path)', () => {
    const state = attackState(ON, []);
    const r = executePlayerAction(state, {
      type: 'declare_attack',
      attackerInstanceId: 'ATK',
      targetId: 'hero',
    });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.stack).toHaveLength(0);
    expect(r.state.players[1]!.hero.currentLp).toBe(23);
    expect(r.state.players[0]!.zones.frontline[0]?.exhausted).toBe(true);
  });
});

describe('responseWindowsOnAllActions: activate_ability', () => {
  beforeEach(() => resetInstanceCounter());

  // An activated ability (Trigger): deal 2 to the enemy Hero.
  function activatedAbility(): AbilityDSL {
    return {
      type: 'triggered',
      trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 } },
      effects: [
        { type: 'deal_damage', amount: { type: 'fixed', value: 2 }, target: { type: 'hero', side: 'enemy' } },
      ],
    };
  }

  function abilityState(config: GameState['config'], opponentHand: ReturnType<typeof mockCard>[]) {
    const source = mockCard({ instanceId: 'SRC', cardType: 'C', owner: 0, abilities: [activatedAbility()] });
    const p0 = mockPlayerState(0, {
      zones: deployToZone(mockPlayerState(0).zones, source, 'frontline', 0),
    });
    const p1 = mockPlayerState(1, {
      hand: opponentHand,
      resourceBank: manaBank(2, 'e'),
      hero: { ...mockPlayerState(1).hero, currentLp: 25 },
    });
    return mockGameState({ phase: 'strategy', players: [p0, p1], config });
  }

  it('OFF: resolves inline even when the opponent holds a Flash', () => {
    const state = abilityState({ terminationMode: 'turn_cap' }, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, { type: 'activate_ability', cardInstanceId: 'SRC', abilityIndex: 0 });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.players[1]!.hero.currentLp).toBe(23);
  });

  it('ON: opens an ability window; payment/exhaustion happen now, effects defer to window close', () => {
    const state = abilityState(ON, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, { type: 'activate_ability', cardInstanceId: 'SRC', abilityIndex: 0 });
    expect(r.state.pendingPriority?.toRespondPlayerId).toBe(1);
    expect(r.state.pendingPriority?.window).toBe('ability');
    expect(r.state.stack[0]!.type).toBe('ability');
    // Declaration-side effects applied; the ability's damage has NOT run.
    expect(r.state.players[0]!.zones.frontline[0]?.exhausted).toBe(true);
    expect(r.state.players[1]!.hero.currentLp).toBe(25);
    expect(r.events.some((e) => e.type === 'ABILITY_ACTIVATED')).toBe(true);

    const pass1 = executePriorityPass(r.state);
    const pass2 = executePriorityPass(pass1.state);
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.players[1]!.hero.currentLp).toBe(23);
  });

  it('ON: resolves inline when the opponent holds no reaction', () => {
    const state = abilityState(ON, []);
    const r = executePlayerAction(state, { type: 'activate_ability', cardInstanceId: 'SRC', abilityIndex: 0 });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.players[1]!.hero.currentLp).toBe(23);
  });
});

describe('responseWindowsOnAllActions: attach_equipment', () => {
  beforeEach(() => resetInstanceCounter());

  // An equipment whose deploy-time effect deals 2 to the enemy Hero.
  function equipDeployEffect(): AbilityDSL {
    return {
      type: 'triggered',
      trigger: { type: 'on_deploy' },
      effects: [
        { type: 'deal_damage', amount: { type: 'fixed', value: 2 }, target: { type: 'hero', side: 'enemy' } },
      ],
    };
  }

  function equipState(config: GameState['config'], opponentHand: ReturnType<typeof mockCard>[]) {
    const equip = mockCard({
      instanceId: 'EQ',
      cardType: 'E',
      owner: 0,
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [equipDeployEffect()],
    });
    const holder = mockCard({ instanceId: 'HOLD', cardType: 'C', owner: 0 });
    const p0 = mockPlayerState(0, {
      hand: [equip],
      resourceBank: manaBank(2),
      zones: deployToZone(mockPlayerState(0).zones, holder, 'frontline', 0),
    });
    const p1 = mockPlayerState(1, {
      hand: opponentHand,
      resourceBank: manaBank(2, 'e'),
      hero: { ...mockPlayerState(1).hero, currentLp: 25 },
    });
    return mockGameState({ phase: 'strategy', players: [p0, p1], config });
  }

  it('OFF: resolves inline even when the opponent holds a Flash', () => {
    const state = equipState({ terminationMode: 'turn_cap' }, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: 'EQ',
      targetInstanceId: 'HOLD',
    });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.players[1]!.hero.currentLp).toBe(23);
  });

  it('ON: opens an equip window; the attach happens now but the deploy effect defers to window close', () => {
    const state = equipState(ON, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: 'EQ',
      targetInstanceId: 'HOLD',
    });
    expect(r.state.pendingPriority?.toRespondPlayerId).toBe(1);
    expect(r.state.pendingPriority?.window).toBe('equip');
    expect(r.state.stack[0]!.type).toBe('equip');
    // Attached + paid now; the equipment's deploy effect has NOT run.
    expect(r.state.players[0]!.zones.frontline[0]?.equipment?.instanceId).toBe('EQ');
    expect(r.state.players[1]!.hero.currentLp).toBe(25);
    expect(r.events.some((e) => e.type === 'EQUIPMENT_ATTACHED')).toBe(true);

    const pass1 = executePriorityPass(r.state);
    const pass2 = executePriorityPass(pass1.state);
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.players[1]!.hero.currentLp).toBe(23);
  });

  it('ON: resolves inline when the opponent holds no reaction', () => {
    const state = equipState(ON, []);
    const r = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: 'EQ',
      targetInstanceId: 'HOLD',
    });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.players[1]!.hero.currentLp).toBe(23);
  });
});

describe('responseWindowsOnAllActions: move', () => {
  beforeEach(() => resetInstanceCounter());

  function moveState(config: GameState['config'], opponentHand: ReturnType<typeof mockCard>[]) {
    const mover = mockCard({ instanceId: 'MOV', cardType: 'C', owner: 0 });
    const p0 = mockPlayerState(0, {
      zones: deployToZone(mockPlayerState(0).zones, mover, 'reserve', 0),
    });
    const p1 = mockPlayerState(1, {
      hand: opponentHand,
      resourceBank: manaBank(2, 'e'),
    });
    return mockGameState({ phase: 'strategy', players: [p0, p1], config });
  }

  it('OFF: resolves inline even when the opponent holds a Flash', () => {
    const state = moveState({ terminationMode: 'turn_cap' }, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, { type: 'move', cardInstanceId: 'MOV', toZone: 'frontline' });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.players[0]!.zones.frontline.some((c) => c?.instanceId === 'MOV')).toBe(true);
  });

  it('ON: opens a move window; the mover has NOT moved until the window closes', () => {
    const state = moveState(ON, [flashCard('FL', 1)]);
    const r = executePlayerAction(state, { type: 'move', cardInstanceId: 'MOV', toZone: 'frontline' });
    expect(r.state.pendingPriority?.toRespondPlayerId).toBe(1);
    expect(r.state.pendingPriority?.window).toBe('move');
    expect(r.state.stack[0]!.type).toBe('move');
    expect(r.state.players[0]!.zones.reserve.some((c) => c?.instanceId === 'MOV')).toBe(true);
    expect(r.events.some((e) => e.type === 'CARD_MOVED')).toBe(false);

    const pass1 = executePriorityPass(r.state);
    const pass2 = executePriorityPass(pass1.state);
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.players[0]!.zones.frontline.some((c) => c?.instanceId === 'MOV')).toBe(true);
    expect(pass2.events.some((e) => e.type === 'CARD_MOVED')).toBe(true);
  });

  it('ON: resolves inline when the opponent holds no reaction', () => {
    const state = moveState(ON, []);
    const r = executePlayerAction(state, { type: 'move', cardInstanceId: 'MOV', toZone: 'frontline' });
    expect(r.state.pendingPriority == null).toBe(true);
    expect(r.state.players[0]!.zones.frontline.some((c) => c?.instanceId === 'MOV')).toBe(true);
  });
});

describe('responseWindowsOnAllActions: XState machine wiring (action phase)', () => {
  beforeEach(() => resetInstanceCounter());

  it('an Action-Phase attack window routes action → priorityWindow → action', () => {
    const attacker = mockCard({ instanceId: 'ATK', cardType: 'C', owner: 0, currentAtk: 2 });
    const deckCard = mockCard({ instanceId: 'DECK', cardType: 'C', owner: 0 });
    const p0 = mockPlayerState(0, {
      mainDeck: [deckCard],
      zones: deployToZone(mockPlayerState(0).zones, attacker, 'frontline', 0),
    });
    const p1 = mockPlayerState(1, {
      hand: [flashCard('FL', 1)],
      resourceBank: manaBank(2, 'e'),
      hero: { ...mockPlayerState(1).hero, currentLp: 25 },
    });
    const gs = mockGameState({
      phase: 'upkeep',
      players: [p0, p1],
      config: ON,
      turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
    });

    const actor = createActor(gameMachine, { input: { gameState: gs } });
    actor.start();
    // upkeep → drawMain → reserveEnergy → strategy; step into the Action Phase.
    expect(actor.getSnapshot().value).toMatchObject({ playing: 'strategy' });
    actor.send({ type: 'END_PHASE' });
    expect(actor.getSnapshot().value).toMatchObject({ playing: 'action' });

    actor.send({ type: 'PLAYER_ACTION', action: { type: 'declare_attack', attackerInstanceId: 'ATK', targetId: 'hero' } });
    let snap = actor.getSnapshot();
    expect(snap.value).toMatchObject({ playing: 'priorityWindow' });
    expect(snap.context.gameState.pendingPriority?.toRespondPlayerId).toBe(1);
    expect(snap.context.gameState.players[1]!.hero.currentLp).toBe(25); // not resolved yet

    actor.send({ type: 'PRIORITY_PASS' });
    actor.send({ type: 'PRIORITY_PASS' });
    snap = actor.getSnapshot();
    // Window closed, combat resolved, and the machine returned to the Action Phase.
    expect(snap.value).toMatchObject({ playing: 'action' });
    expect(snap.context.gameState.pendingPriority == null).toBe(true);
    expect(snap.context.gameState.players[1]!.hero.currentLp).toBe(23);
  });
});

/**
 * Rule-accuracy flag tests (ruleset-v2 candidates, each default OFF ⇒
 * byte-identical to the locked ruleset-v1 baseline):
 *   - endPhaseOrderFix — End-Phase runs Remove Temp Resources → Hand Size
 *     Limit → Resolve End-of-Turn Effects (book order), instead of the
 *     legacy End-of-Turn-Effects-first order.
 *   - startOfTurnTriggerAfterReserve — start-of-turn scheduled triggers fire
 *     AFTER Reserve Energy Generation instead of before.
 *   - transformAtStartOfTurn — replaces Strategy-phase transformation with the
 *     exclusive start-of-turn window after Reserve Energy Generation.
 *   - heroAbilitiesOncePerTurn — blanket once-per-turn lockout on Hero
 *     activated abilities only.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { executeEffect } from '../../src/effects/interpreter.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, GameState, ResourceCard } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

const schedule = (
  timing: Extract<Effect, { type: 'scheduled' }>['timing'],
  effects: readonly Effect[],
): Effect => ({ type: 'scheduled', timing, effects });

const gainTemp = (amount: number): Effect => ({
  type: 'gain_resource',
  resourceType: 'energy',
  amount,
  temporary: true,
});

const gainPermanent = (amount: number): Effect => ({
  type: 'gain_resource',
  resourceType: 'energy',
  amount,
  temporary: false,
});

function bank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `r_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

// ── endPhaseOrderFix ───────────────────────────────────────────────────────
describe('endPhaseOrderFix knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWithEndOfTurnGrant(config?: GameState['config']): GameState {
    const character = mockCard({ name: 'Ticker', currentHp: 5, baseHp: 5, owner: 0 });
    const zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    const resDeck = Array.from({ length: 5 }, (_, i) => ({
      instanceId: `rd_${String(i)}`,
      resourceType: 'mana' as const,
      exhausted: false,
    }));
    const deck = Array.from({ length: 10 }, () => mockCard({ owner: 0 }));
    let state: GameState = mockGameState({
      phase: 'upkeep',
      players: [
        mockPlayerState(0, { zones, mainDeck: deck, resourceDeck: resDeck, resourceBank: bank(2) }),
        mockPlayerState(1, { mainDeck: [...deck] }),
      ],
      config,
    });
    state = executeEffect(
      state,
      schedule({ type: 'end_of_turn' }, [gainTemp(3)]),
      ctx(character.instanceId, 0),
    ).newState;
    return state;
  }

  it('OFF (default/absent): the end-of-turn temp resource grant is immediately wiped by Remove Temp Resources (legacy order)', () => {
    const state = stateWithEndOfTurnGrant();
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    actor.send({ type: 'END_PHASE' }); // strategy -> action
    actor.send({ type: 'END_PHASE' }); // action -> endPhase -> passTurn -> upkeep
    const final = actor.getSnapshot().context.gameState;
    expect(final.players[0]!.temporaryResources).toHaveLength(0);
  });

  it('ON: the end-of-turn temp resource grant survives Remove Temp Resources (book order)', () => {
    const state = stateWithEndOfTurnGrant({ terminationMode: 'turn_cap', endPhaseOrderFix: true });
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    actor.send({ type: 'END_PHASE' });
    actor.send({ type: 'END_PHASE' });
    const final = actor.getSnapshot().context.gameState;
    expect(final.players[0]!.temporaryResources).toHaveLength(1);
    expect(final.players[0]!.temporaryResources[0]).toMatchObject({
      resourceType: 'energy',
      amount: 3,
    });
  });
});

// ── startOfTurnTriggerAfterReserve ──────────────────────────────────────────
describe('startOfTurnTriggerAfterReserve knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWithReserveAndScheduledStart(config?: GameState['config']): GameState {
    const reserveChar = mockCard({ name: 'Sentry', owner: 0 });
    const zones = deployToZone(mockPlayerState(0).zones, reserveChar, 'reserve', 0);
    const resDeck = Array.from({ length: 5 }, (_, i) => ({
      instanceId: `rd_${String(i)}`,
      resourceType: 'mana' as const,
      exhausted: false,
    }));
    const deck = Array.from({ length: 10 }, () => mockCard({ owner: 0 }));
    let state: GameState = mockGameState({
      phase: 'upkeep',
      players: [
        mockPlayerState(0, { zones, mainDeck: deck, resourceDeck: resDeck }),
        mockPlayerState(1, { mainDeck: [...deck] }),
      ],
      config,
    });
    // Schedule a next_turn_start grant so it lands in the log alongside the
    // Reserve-Energy-generated RESOURCE_GAINED event.
    state = executeEffect(
      state,
      schedule({ type: 'next_turn_start' }, [gainPermanent(7)]),
      ctx(reserveChar.instanceId, 0),
    ).newState;
    return state;
  }

  function resourceGainedIndices(state: GameState): number[] {
    return state.log.map((e, i) => (e.type === 'RESOURCE_GAINED' ? i : -1)).filter((i) => i !== -1);
  }

  it('OFF (default/absent): scheduled next_turn_start grant fires BEFORE Reserve Energy Generation', () => {
    const state = stateWithReserveAndScheduledStart();
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    const final = actor.getSnapshot().context.gameState;
    const [scheduledIdx, reserveIdx] = resourceGainedIndices(final);
    expect(scheduledIdx).toBeLessThan(reserveIdx!);
  });

  it('ON: scheduled next_turn_start grant fires AFTER Reserve Energy Generation', () => {
    const state = stateWithReserveAndScheduledStart({
      terminationMode: 'turn_cap',
      startOfTurnTriggerAfterReserve: true,
    });
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    const final = actor.getSnapshot().context.gameState;
    const [reserveIdx, scheduledIdx] = resourceGainedIndices(final);
    expect(reserveIdx).toBeLessThan(scheduledIdx!);
  });
});

// ── transformAtStartOfTurn ───────────────────────────────────────────────────
describe('transformAtStartOfTurn knob', () => {
  beforeEach(() => resetInstanceCounter());

  function makeUpkeepState(config?: GameState['config']): GameState {
    const deck = Array.from({ length: 10 }, () => mockCard({ owner: 0 }));
    const resDeck = Array.from({ length: 5 }, (_, i) => ({
      instanceId: `rd_${String(i)}`,
      resourceType: 'mana' as const,
      exhausted: false,
    }));
    return mockGameState({
      phase: 'upkeep',
      players: [
        mockPlayerState(0, {
          mainDeck: deck,
          resourceDeck: resDeck,
          hero: mockHero({
            currentLp: 8, // <= 10 ⇒ printed transform condition satisfied
            transformData: { cardDefId: 200, name: 'Transformed Hero', lpDelta: 5, abilities: [] },
          }),
        }),
        mockPlayerState(1, { mainDeck: [...deck] }),
      ],
      config,
    });
  }

  it('OFF (default/absent): computeAvailableActions never offers canTransform during upkeep', () => {
    const state = makeUpkeepState();
    const acts = computeAvailableActions(state);
    expect(acts.canTransform).toBe(false);
  });

  it('ON: computeAvailableActions offers canTransform during upkeep', () => {
    const base = makeUpkeepState({
      terminationMode: 'turn_cap',
      transformAtStartOfTurn: true,
    });
    const state: GameState = {
      ...base,
      turnState: { ...base.turnState, upkeepActionWindow: 'transform' },
    };
    const acts = computeAvailableActions(state);
    expect(acts.canTransform).toBe(true);
    expect(acts.canEndPhase).toBe(true);
    expect(
      computeAvailableActions({ ...state, phase: 'strategy' }).canTransform,
    ).toBe(false);
  });

  it('OFF (default/absent): the machine skips straight to Strategy after Reserve Energy', () => {
    const state = makeUpkeepState();
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    expect(actor.getSnapshot().context.gameState.phase).toBe('strategy');
  });

  it('ON: the machine pauses at the start-of-turn transform window (phase still upkeep, hero untransformed)', () => {
    const state = makeUpkeepState({ terminationMode: 'turn_cap', transformAtStartOfTurn: true });
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    const gs = actor.getSnapshot().context.gameState;
    expect(gs.phase).toBe('upkeep');
    expect(gs.players[0]!.hero.transformed).toBe(false);
  });

  it('ON: declaring transform in the window, then ending it, transforms the hero and proceeds to Strategy', () => {
    const state = makeUpkeepState({ terminationMode: 'turn_cap', transformAtStartOfTurn: true });
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    actor.send({ type: 'PLAYER_ACTION', action: { type: 'declare_transform' } });
    let gs = actor.getSnapshot().context.gameState;
    expect(gs.players[0]!.hero.transformed).toBe(true);
    expect(gs.phase).toBe('upkeep');
    actor.send({ type: 'END_PHASE' });
    gs = actor.getSnapshot().context.gameState;
    expect(gs.phase).toBe('strategy');
  });
});

// ── heroAbilitiesOncePerTurn ─────────────────────────────────────────────────
describe('heroAbilitiesOncePerTurn knob', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWithActivatedHero(config?: GameState['config']): GameState {
    return mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hero: mockHero({
            abilities: [
              {
                type: 'triggered',
                trigger: {
                  type: 'activated',
                  cost: { mana: 0, energy: 0, flexible: 0 },
                },
                effects: [],
              },
            ],
          }),
        }),
        mockPlayerState(1),
      ],
      log: [
        { type: 'TURN_START', playerId: 0, turnNumber: 1 },
        {
          type: 'ABILITY_ACTIVATED',
          cardInstanceId: 'hero_100',
          abilityIndex: 0,
        },
      ],
      config,
    });
  }

  it('OFF (default/absent): the Hero ability is still activatable (repeatable) after a prior use this turn', () => {
    const state = stateWithActivatedHero();
    const acts = computeAvailableActions(state);
    expect(acts.canActivateAbility.some((a) => a.cardInstanceId === 'hero_100')).toBe(true);
  });

  it('ON: the Hero ability is locked out after a prior use this turn', () => {
    const state = stateWithActivatedHero({
      terminationMode: 'turn_cap',
      heroAbilitiesOncePerTurn: true,
    });
    const acts = computeAvailableActions(state);
    expect(acts.canActivateAbility.some((a) => a.cardInstanceId === 'hero_100')).toBe(false);
  });

  it('ON: the Hero ability is available again after a new TURN_START', () => {
    const base = stateWithActivatedHero({
      terminationMode: 'turn_cap',
      heroAbilitiesOncePerTurn: true,
    });
    const state: GameState = {
      ...base,
      log: [...base.log, { type: 'TURN_START', playerId: 0, turnNumber: 2 }],
    };
    const acts = computeAvailableActions(state);
    expect(acts.canActivateAbility.some((a) => a.cardInstanceId === 'hero_100')).toBe(true);
  });

  it('ON: a non-Hero (character) activated ability is unaffected', () => {
    const character = mockCard({
      owner: 0,
      abilities: [
        {
          type: 'triggered',
          trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 } },
          effects: [],
        },
      ],
    });
    const zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
      log: [
        { type: 'TURN_START', playerId: 0, turnNumber: 1 },
        {
          type: 'ABILITY_ACTIVATED',
          cardInstanceId: character.instanceId,
          abilityIndex: 0,
        },
      ],
      config: { terminationMode: 'turn_cap', heroAbilitiesOncePerTurn: true },
    });
    const acts = computeAvailableActions(state);
    expect(acts.canActivateAbility.some((a) => a.cardInstanceId === character.instanceId)).toBe(
      true,
    );
  });
});

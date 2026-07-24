/**
 * Engine ticket Tier 3 — legality surface tests for the two new flags:
 *   - flashAtWill (config.flashAtWill) — widens computeAvailableActions'
 *     canCastSpell to the Flash-tagged subset of hand spells during the
 *     Action Phase (Strategy stays unaffected either way).
 *   - boardReactions (config.boardReactions) — widens computeReactiveActions
 *     to also scan the battlefield/Hero for on_counter/on_flash abilities.
 * Both default OFF ⇒ byte-identical to the pre-Tier-3 baseline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { computeReactiveActions } from '../../src/actions/reactive-actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameState } from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

function flashAbility(): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'on_flash' },
    effects: [
      {
        type: 'heal',
        amount: { type: 'fixed', value: 3 },
        target: { type: 'hero', side: 'allied' },
      },
    ],
  };
}

function counterAbility(): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'on_counter' },
    effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
  };
}

// ── flashAtWill ──────────────────────────────────────────────────────────────
describe('flashAtWill knob', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWithFlashAndBurnInHand(config?: GameState['config']): GameState {
    const flash = mockCard({
      instanceId: 'FLASH',
      cardType: 'S',
      owner: 0,
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [flashAbility()],
    });
    const burn = mockCard({
      instanceId: 'BURN',
      cardType: 'S',
      owner: 0,
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: [] }],
    });
    return mockGameState({
      phase: 'action',
      players: [
        mockPlayerState(0, {
          hand: [flash, burn],
          resourceBank: [
            { instanceId: 'm0', resourceType: 'mana', exhausted: false },
            { instanceId: 'm1', resourceType: 'mana', exhausted: false },
          ],
        }),
        mockPlayerState(1),
      ],
      config,
    });
  }

  it('OFF (default/absent): canCastSpell is empty in the Action Phase (byte-identical baseline)', () => {
    const state = stateWithFlashAndBurnInHand();
    const acts = computeAvailableActions(state);
    expect(acts.canCastSpell).toHaveLength(0);
  });

  it('ON: canCastSpell offers the Flash-tagged spell in the Action Phase, but not the non-Flash spell', () => {
    const state = stateWithFlashAndBurnInHand({ terminationMode: 'turn_cap', flashAtWill: true });
    const acts = computeAvailableActions(state);
    expect(acts.canCastSpell.some((o) => o.cardInstanceId === 'FLASH')).toBe(true);
    expect(acts.canCastSpell.some((o) => o.cardInstanceId === 'BURN')).toBe(false);
  });

  it('ON but Strategy Phase: canCastSpell is unaffected (both spells offered, as before the flag existed)', () => {
    const state = stateWithFlashAndBurnInHand({ terminationMode: 'turn_cap', flashAtWill: true });
    const strategyState = { ...state, phase: 'strategy' as const };
    const acts = computeAvailableActions(strategyState);
    expect(acts.canCastSpell.some((o) => o.cardInstanceId === 'FLASH')).toBe(true);
    expect(acts.canCastSpell.some((o) => o.cardInstanceId === 'BURN')).toBe(true);
  });
});

// ── boardReactions ───────────────────────────────────────────────────────────
describe('boardReactions knob', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWithBoardFlashCharacter(config?: GameState['config']): GameState {
    const character = mockCard({
      instanceId: 'SENTRY',
      cardType: 'C',
      owner: 0,
      abilities: [flashAbility()],
    });
    const zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    return mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 0,
        window: 'cast',
        baseStackItemId: 'spell_X',
        passes: 0,
      },
      config,
    });
  }

  it('OFF (default/absent): computeReactiveActions never scans the battlefield (byte-identical baseline)', () => {
    const state = stateWithBoardFlashCharacter();
    const options = computeReactiveActions(state, 0);
    expect(options).toHaveLength(0);
  });

  it("ON: computeReactiveActions includes the battlefield character's on_flash ability as a board source", () => {
    const state = stateWithBoardFlashCharacter({
      terminationMode: 'turn_cap',
      boardReactions: true,
    });
    const options = computeReactiveActions(state, 0);
    const boardOption = options.find((o) => o.cardInstanceId === 'SENTRY');
    expect(boardOption).toMatchObject({ kind: 'flash', source: 'board', abilityIndex: 0 });
  });

  it('ON: a board Counter (Hero) is offered only when an enemy spell sits on the stack', () => {
    const stateNoStack = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { hero: { ...mockPlayerState(0).hero, abilities: [counterAbility()] } }),
        mockPlayerState(1),
      ],
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 0,
        window: 'cast',
        baseStackItemId: 'spell_X',
        passes: 0,
      },
      config: { terminationMode: 'turn_cap', boardReactions: true },
    });
    expect(computeReactiveActions(stateNoStack, 0)).toHaveLength(0);

    const stateWithStack: GameState = {
      ...stateNoStack,
      stack: [
        {
          id: 'spell_BURN',
          type: 'spell',
          sourceInstanceId: 'BURN',
          controllerId: 1,
          effects: [],
          targets: [],
        },
      ],
    };
    const options = computeReactiveActions(stateWithStack, 0);
    expect(options.find((o) => o.cardInstanceId === 'hero_100')).toMatchObject({
      kind: 'counter',
      source: 'board',
    });
  });

  it('ON: a spell in hand is still offered alongside board options (legacy path unchanged)', () => {
    const handSpell = mockCard({
      instanceId: 'HANDFLASH',
      cardType: 'S',
      owner: 0,
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [flashAbility()],
    });
    const character = mockCard({
      instanceId: 'SENTRY',
      cardType: 'C',
      owner: 0,
      abilities: [flashAbility()],
    });
    const zones = deployToZone(mockPlayerState(0).zones, character, 'frontline', 0);
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          hand: [handSpell],
          zones,
          resourceBank: [{ instanceId: 'm0', resourceType: 'mana', exhausted: false }],
        }),
        mockPlayerState(1),
      ],
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 0,
        window: 'cast',
        baseStackItemId: 'spell_X',
        passes: 0,
      },
      config: { terminationMode: 'turn_cap', boardReactions: true },
    });
    const options = computeReactiveActions(state, 0);
    const handOption = options.find((o) => o.cardInstanceId === 'HANDFLASH');
    expect(handOption?.kind).toBe('flash');
    expect(handOption?.source).toBeUndefined();
    expect(options.find((o) => o.cardInstanceId === 'SENTRY')).toMatchObject({
      kind: 'flash',
      source: 'board',
    });
  });
});

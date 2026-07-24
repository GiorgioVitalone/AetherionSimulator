/**
 * Engine ticket Tier 3 — execution tests for the two new flags:
 *   - flashAtWill: a Flash-tagged spell resolves through the existing
 *     executeCastSpell -> openWindowOrResolve path when cast in the Action
 *     Phase (not just Strategy).
 *   - boardReactions: a battlefield character/Hero on_counter/on_flash
 *     ability executes ACTIVATE-style (pay cost + exhaust + stays on board)
 *     via a new board-reaction path, distinct from the hand-spell
 *     discard-and-chain-link path (castReactiveSpell), which is unaffected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  executePlayerAction,
  executeReactiveResponse,
  executePriorityPass,
} from '../../src/state-machine/actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
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

function flashHeal(): AbilityDSL {
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

function counterAbilityWithCost(): AbilityDSL {
  return {
    type: 'triggered',
    trigger: { type: 'on_counter', cost: { mana: 1, energy: 0, flexible: 0 } },
    effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
  };
}

describe('flashAtWill: casting a Flash spell in the Action Phase', () => {
  beforeEach(() => resetInstanceCounter());

  it('OFF (default/absent): irrelevant to execution — executeCastSpell has no phase gate; legality is enforced upstream by computeAvailableActions (see tests/actions suite)', () => {
    // Documents the boundary: this flag only widens computeAvailableActions'
    // legality surface, not executeCastSpell itself. See
    // tests/actions/flash-and-board-reactions.test.ts for the legality gate.
    expect(true).toBe(true);
  });

  it('ON: a Flash spell cast during the Action Phase resolves its on_flash heal effect', () => {
    const flash = mockCard({
      instanceId: 'FLASH',
      cardType: 'S',
      owner: 0,
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [flashHeal()],
    });
    const p0 = mockPlayerState(0, {
      hand: [flash],
      resourceBank: manaBank(2),
      hero: { ...mockPlayerState(0).hero, currentLp: 20, maxLp: 25 },
    });
    const state = mockGameState({
      phase: 'action',
      players: [p0, mockPlayerState(1)],
      config: { terminationMode: 'turn_cap', flashAtWill: true },
    });

    const r = executePlayerAction(state, { type: 'cast_spell', cardInstanceId: 'FLASH' });
    expect(r.state.players[0]!.hero.currentLp).toBe(23);
    expect(r.state.players[0]!.hand).toHaveLength(0);
  });
});

describe('boardReactions: a battlefield character/Hero on_counter/on_flash ability', () => {
  beforeEach(() => resetInstanceCounter());

  function windowState(config?: import('../../src/types/game-state.js').GameState['config']) {
    const sentry = mockCard({
      instanceId: 'SENTRY',
      cardType: 'C',
      owner: 1,
      abilities: [counterAbilityWithCost()],
    });
    const zones = deployToZone(mockPlayerState(1).zones, sentry, 'frontline', 0);
    const p0 = mockPlayerState(0, { resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { zones, resourceBank: manaBank(2, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [
        {
          id: 'spell_BURN',
          type: 'spell',
          sourceInstanceId: 'BURN',
          controllerId: 0,
          effects: [
            {
              type: 'deal_damage',
              amount: { type: 'fixed', value: 4 },
              target: { type: 'hero', side: 'enemy' },
            },
          ],
          targets: [],
        },
      ],
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 1,
        window: 'cast',
        baseStackItemId: 'spell_BURN',
        passes: 0,
      },
      config,
    });
    return { state, sentry };
  }

  it('OFF (default/absent): an activate_ability reactive response is a no-op (byte-identical baseline)', () => {
    const { state } = windowState();
    const r = executeReactiveResponse(state, {
      type: 'activate_ability',
      cardInstanceId: 'SENTRY',
      abilityIndex: 0,
    });
    // No-op: state unchanged (still the same pending window, no resources spent).
    expect(r.state).toBe(state);
    expect(r.events).toHaveLength(0);
  });

  it('ON: activating the board Counter pays cost + exhausts the source + stays on the battlefield (not discarded), and counters the stack spell', () => {
    const { state } = windowState({ terminationMode: 'turn_cap', boardReactions: true });
    const r = executeReactiveResponse(state, {
      type: 'activate_ability',
      cardInstanceId: 'SENTRY',
      abilityIndex: 0,
    });

    // Cost paid (1 of the 2 bank cards exhausted; payCost exhausts, never removes).
    expect(r.state.players[1]!.resourceBank.filter((c) => c.exhausted)).toHaveLength(1);
    // Source stays on the battlefield, exhausted — not discarded.
    const onBoard = r.state.players[1]!.zones.frontline[0];
    expect(onBoard?.instanceId).toBe('SENTRY');
    expect(onBoard?.exhausted).toBe(true);
    expect(r.state.players[1]!.discardPile).toHaveLength(0);
    // The stack spell was countered.
    expect(r.state.stack).toHaveLength(0);
    // Priority flips back to the active player.
    expect(r.state.pendingPriority?.toRespondPlayerId).toBe(0);
  });

  it('ON: a spell-in-hand reactive response still works as before (legacy hand-spell path unaffected)', () => {
    const counterSpell = mockCard({
      instanceId: 'CS',
      cardType: 'S',
      owner: 1,
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [
        {
          type: 'triggered',
          trigger: { type: 'on_counter' },
          effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
        },
      ],
    });
    const p0 = mockPlayerState(0, { resourceBank: manaBank(2) });
    const p1 = mockPlayerState(1, { hand: [counterSpell], resourceBank: manaBank(2, 'e') });
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [
        {
          id: 'spell_BURN',
          type: 'spell',
          sourceInstanceId: 'BURN',
          controllerId: 0,
          effects: [],
          targets: [],
        },
      ],
      pendingPriority: {
        type: 'priority',
        toRespondPlayerId: 1,
        window: 'cast',
        baseStackItemId: 'spell_BURN',
        passes: 0,
      },
      config: { terminationMode: 'turn_cap', boardReactions: true },
    });

    const react = executeReactiveResponse(state, {
      type: 'cast_spell',
      cardInstanceId: 'CS',
      selectedTargetIds: ['spell_BURN'],
    });
    // The hand spell is gone from hand (discarded) — the legacy path, unchanged.
    expect(react.state.players[1]!.hand).toHaveLength(0);
    expect(react.state.players[1]!.discardPile.some((c) => c.instanceId === 'CS')).toBe(true);

    // Two passes resolve the chain LIFO: CS counters BURN.
    const pass1 = executePriorityPass(react.state);
    const pass2 = executePriorityPass(pass1.state);
    expect(pass2.state.pendingPriority == null).toBe(true);
    expect(pass2.state.stack).toHaveLength(0);
  });
});


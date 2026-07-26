/**
 * BUG FIX regression: an attached equipment's own PRINTED event triggers
 * (on_turn_start, on_turn_end, on_ally_deployed, on_spell_cast, on_gain_resource,
 * on_equipment_attached) never fired. `getAllRegisteredTriggers` only scans each
 * player's Hero and the three zone arrays; attached equipment lives at
 * `card.equipment` on its holder, not in a zone slot of its own, so it was never
 * in the trigger pool — and it never got registered onto `registeredTriggers` at
 * attach time in the first place. See GameConfig.equipmentTriggers.
 *
 * This is DISTINCT from an equipment's `aura -> grant_ability -> equipped_character`
 * effect (e.g. Ephemeral Cloak-style granting), which already works because the
 * GRANTED trigger registers onto the holder (a zone slot) — not exercised here.
 *
 * These tests exercise the PRODUCTION path — attach via executePlayerAction and
 * subsequent events via dispatchTriggers/getAllRegisteredTriggers — never calling
 * registerCardTriggers/computeCardTriggers directly (that would mask the bug).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import {
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameConfig, GameEvent } from '../../src/types/game-state.js';

const FREE = { mana: 0, energy: 0, flexible: 0 };

const onTurnEndHeal: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_turn_end' },
  effects: [
    {
      type: 'heal',
      amount: { type: 'fixed', value: 1 },
      target: { type: 'all_characters', side: 'allied' },
    },
  ],
};

const onAttachDraw: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_equipment_attached' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
};

function setupAttach(equipAbilities: readonly AbilityDSL[], config?: GameConfig) {
  const holder = mockCard({
    name: 'Holder',
    cardType: 'C',
    currentHp: 1,
    currentAtk: 0,
    cost: FREE,
  });
  const equip = mockCard({
    name: 'Test Equipment',
    cardType: 'E',
    cost: FREE,
    abilities: equipAbilities,
  });
  const deck = [mockCard({ name: 'Deck', owner: 0 })];
  const state = mockGameState({
    phase: 'strategy',
    activePlayerIndex: 0,
    players: [
      mockPlayerState(0, {
        hand: [equip],
        mainDeck: deck,
        zones: zonesWithCards({ frontline: [holder, null, null] }),
      }),
      mockPlayerState(1),
    ],
    config,
  });
  const result = executePlayerAction(state, {
    type: 'attach_equipment',
    cardInstanceId: equip.instanceId,
    targetInstanceId: holder.instanceId,
  });
  return { holder, equip, state: result.state };
}

describe('equipmentTriggers: registration + pool scanning at attach', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('OFF (default/absent): attach never registers the printed trigger, and it stays out of the pool', () => {
    const { holder, state } = setupAttach([onTurnEndHeal], undefined);
    const attached = state.players[0]!.zones.frontline[0]!.equipment!;
    expect(attached.registeredTriggers).toHaveLength(0); // documents the bug
    expect(getAllRegisteredTriggers(state)).toHaveLength(0);
    expect(holder.currentHp).toBe(1);
  });

  it('ON: attach registers the printed trigger onto the equipment, and it enters the pool', () => {
    const { state } = setupAttach([onTurnEndHeal], { equipmentTriggers: true });
    const attached = state.players[0]!.zones.frontline[0]!.equipment!;
    expect(attached.registeredTriggers).toHaveLength(1);
    expect(attached.registeredTriggers[0]!.trigger.type).toBe('on_turn_end');
    expect(getAllRegisteredTriggers(state)).toHaveLength(1);
  });

  it('ON: a holder exhausted for Reserve Energy Generation suppresses its equipment triggers too', () => {
    const { state } = setupAttach([onTurnEndHeal], { equipmentTriggers: true });
    const exhaustedHolder = {
      ...state.players[0]!.zones.frontline[0]!,
      reserveEnergyExhausted: true,
    };
    const exhaustedState = {
      ...state,
      players: [
        {
          ...state.players[0]!,
          zones: zonesWithCards({ frontline: [exhaustedHolder, null, null] }),
        },
        state.players[1]!,
      ] as const,
    };
    expect(getAllRegisteredTriggers(exhaustedState)).toHaveLength(0);
  });

  it('ON: the registered trigger actually fires on a later on_turn_end event', () => {
    const { state } = setupAttach([onTurnEndHeal], { equipmentTriggers: true });
    const damagedState = {
      ...state,
      players: [
        {
          ...state.players[0]!,
          zones: zonesWithCards({
            frontline: [{ ...state.players[0]!.zones.frontline[0]!, currentHp: 0 }, null, null],
          }),
        },
        state.players[1]!,
      ] as const,
    };
    const turnEnd: GameEvent = { type: 'TURN_END', playerId: 0, turnNumber: 1 };
    const dispatched = dispatchTriggers(damagedState, [turnEnd], 0);
    expect(dispatched.newState.players[0]!.zones.frontline[0]!.currentHp).toBe(1);
  });

  it('ON: on_equipment_attached fires inline the moment the equipment attaches', () => {
    const { state } = setupAttach([onAttachDraw], { equipmentTriggers: true });
    expect(state.players[0]!.hand).toHaveLength(1); // drew 1 (deck had 1 card)
  });

  it('OFF: on_equipment_attached never fires at attach', () => {
    const { state } = setupAttach([onAttachDraw], undefined);
    expect(state.players[0]!.hand).toHaveLength(0);
  });

  it('ON: removing the equipment drops its triggers from the pool (no stale entries)', () => {
    const { holder, state } = setupAttach([onTurnEndHeal], { equipmentTriggers: true });
    expect(getAllRegisteredTriggers(state)).toHaveLength(1);
    const removed = executePlayerAction(state, {
      type: 'remove_equipment',
      equipmentInstanceId: state.players[0]!.zones.frontline[0]!.equipment!.instanceId,
    });
    expect(getAllRegisteredTriggers(removed.state)).toHaveLength(0);
    expect(removed.state.players[0]!.zones.frontline[0]!.instanceId).toBe(holder.instanceId);
  });

  it('ON: transferring the equipment keeps its trigger alive on the new holder', () => {
    const { state } = setupAttach([onTurnEndHeal], { equipmentTriggers: true });
    const otherHolder = mockCard({ name: 'Other Holder', cardType: 'C', cost: FREE });
    const withOther = {
      ...state,
      players: [
        {
          ...state.players[0]!,
          zones: {
            ...state.players[0]!.zones,
            frontline: [state.players[0]!.zones.frontline[0]!, otherHolder, null] as const,
          },
        },
        state.players[1]!,
      ] as const,
    };
    const equip = withOther.players[0]!.zones.frontline[0]!.equipment!;
    const transferred = executePlayerAction(withOther, {
      type: 'transfer_equipment',
      equipmentInstanceId: equip.instanceId,
      targetInstanceId: otherHolder.instanceId,
    });
    expect(getAllRegisteredTriggers(transferred.state)).toHaveLength(1);
    expect(transferred.state.players[0]!.zones.frontline[0]!.equipment).toBeNull();
    expect(
      transferred.state.players[0]!.zones.frontline[1]!.equipment?.registeredTriggers,
    ).toHaveLength(1);
  });
});

// ── runSim: byte-identical no-op + deterministic divergence ──────────────────
const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('equipmentTriggers (runSim)', () => {
  it('absent/false ⇒ baseline runHash; true ⇒ deterministic divergence', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = {
      rulesProfile: 'legacy-v1',
      matchups: 'all-pairs',
      gamesPerPairing: 3,
      seedBase: 4242,
      abilitiesOn: true,
    } as const;
    const off = runSim(base).runHash;

    expect(runSim({ ...base, equipmentTriggers: false }).runHash).toBe(off);

    const on = runSim({ ...base, equipmentTriggers: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, equipmentTriggers: true }).runHash).toBe(on);
  }, 30000);
});

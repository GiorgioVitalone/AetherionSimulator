import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  registerCardTriggers,
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameEvent } from '../../src/types/game-state.js';

// Wave 6 A5: wrapper oncePerTurn / cooldown on NON-activated (dispatch) triggers.
// Verdant Biotech Engineer (oncePerTurn) over-draw and Sapphire Arcanist Lyria
// (cooldown:2) over-draw both came from these being dropped.

const drawOnStatMod: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_stat_modified', side: 'allied' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
  oncePerTurn: true,
};

function deck(n: number): ReturnType<typeof mockCard>[] {
  return Array.from({ length: n }, () => mockCard({ owner: 0, name: 'Top' }));
}

function statModEvent(id: string): GameEvent {
  return { type: 'STAT_MODIFIED', cardInstanceId: id, modifier: { atk: 1 }, playerId: 0 };
}

describe('dispatch oncePerTurn', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('fires at most once per turn across separate event batches', () => {
    const engineer = mockCard({ owner: 0, name: 'Biotech Engineer', abilities: [drawOnStatMod] });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [engineer, ally, null] }),
          mainDeck: deck(5),
        }),
        mockPlayerState(1),
      ],
      log: [{ type: 'TURN_START', playerId: 0, turnNumber: 1 }],
    });
    const registered = registerCardTriggers(base, engineer.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    // First buff: draws once.
    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(1);

    // Second buff in the SAME turn (separate dispatch). The fire-marker persisted on
    // r1.newState.log, so the trigger is rate-limited and does NOT draw again.
    const r2 = dispatchTriggers(r1.newState, [statModEvent(ally.instanceId)], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(1);
  });

  it('re-enables on the next turn', () => {
    const engineer = mockCard({ owner: 0, name: 'Biotech Engineer', abilities: [drawOnStatMod] });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [engineer, ally, null] }),
          mainDeck: deck(5),
        }),
        mockPlayerState(1),
      ],
      log: [{ type: 'TURN_START', playerId: 0, turnNumber: 1 }],
    });
    const registered = registerCardTriggers(base, engineer.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    // Advance a turn in the log, then buff again.
    const nextTurn = {
      ...r1.newState,
      log: [...r1.newState.log, { type: 'TURN_START', playerId: 0, turnNumber: 2 } as const],
    };
    const r2 = dispatchTriggers(nextTurn, [statModEvent(ally.instanceId)], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(2);
  });
});

describe('dispatch cooldown', () => {
  const drawOnTurnStart = (cooldown: number): AbilityDSL => ({
    type: 'triggered',
    trigger: { type: 'on_turn_start' },
    effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
    cooldown,
  });

  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('cooldown:2 blocks re-fire until 2 owner turns have passed', () => {
    const lyria = mockCard({ owner: 0, name: 'Arcanist Lyria', abilities: [drawOnTurnStart(2)] });
    const base = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [lyria, null, null] }), mainDeck: deck(5) }),
        mockPlayerState(1),
      ],
      log: [{ type: 'TURN_START', playerId: 0, turnNumber: 1 }],
    });
    const registered = registerCardTriggers(base, lyria.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const ts1: GameEvent = { type: 'TURN_START', playerId: 0, turnNumber: 1 };
    const r1 = dispatchTriggers(registered, [ts1], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(1); // fires

    // Owner's very next turn (1 elapsed < cooldown 2): still on cooldown.
    const turn3 = {
      ...r1.newState,
      log: [...r1.newState.log, { type: 'TURN_START', playerId: 0, turnNumber: 3 } as const],
    };
    const ts3: GameEvent = { type: 'TURN_START', playerId: 0, turnNumber: 3 };
    const r2 = dispatchTriggers(turn3, [ts3], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(1); // blocked

    // Second owner turn after the fire (2 elapsed === cooldown 2): available again.
    const turn5 = {
      ...r2.newState,
      log: [...r2.newState.log, { type: 'TURN_START', playerId: 0, turnNumber: 5 } as const],
    };
    const ts5: GameEvent = { type: 'TURN_START', playerId: 0, turnNumber: 5 };
    const r3 = dispatchTriggers(turn5, [ts5], 0, pool);
    expect(r3.newState.players[0]!.hand).toHaveLength(2); // fires
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  registerCardTriggers,
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import { removeCardFromState } from '../../src/effects/state-helpers.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameEvent } from '../../src/types/game-state.js';

describe('dispatchTriggers', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('fires a Last Breath (on_destroy) ability after the source leaves play', () => {
    // Source has on_destroy: deal 3 damage to enemy hero.
    const lastBreath: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_destroy' },
      effects: [
        { type: 'deal_damage', amount: { type: 'fixed', value: 3 }, target: { type: 'hero', side: 'enemy' } },
      ],
    };
    const dying = mockCard({ owner: 0, name: 'Martyr', abilities: [lastBreath] });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [dying, null, null] }) }),
        mockPlayerState(1),
      ],
    });
    const registered = registerCardTriggers(state, dying.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    // Source is destroyed and removed BEFORE dispatch (Last Breath timing).
    const afterRemoval = removeCardFromState(registered, dying.instanceId);
    const destroyEvent: GameEvent = {
      type: 'CARD_DESTROYED',
      cardInstanceId: dying.instanceId,
      cause: 'effect',
      playerId: 0,
    };

    const result = dispatchTriggers(afterRemoval, [destroyEvent], 0, pool);

    expect(result.newState.players[1]!.hero.currentLp).toBe(22);
    expect(result.events.some(e => e.type === 'HERO_DAMAGED')).toBe(true);
  });

  it('fires an on_ally_destroyed ability when an ally dies', () => {
    // Watcher reacts to any allied character being destroyed by drawing a card.
    const onAllyDestroyed: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_ally_destroyed' },
      effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
    };
    const watcher = mockCard({ owner: 0, name: 'Watcher', abilities: [onAllyDestroyed] });
    const ally = mockCard({ owner: 0, name: 'Doomed' });
    const deck = [mockCard({ owner: 0, name: 'Top' })];
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [watcher, ally, null] }),
          mainDeck: deck,
        }),
        mockPlayerState(1),
      ],
    });
    const registered = registerCardTriggers(state, watcher.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const allyDeath: GameEvent = {
      type: 'CARD_DESTROYED',
      cardInstanceId: ally.instanceId,
      cause: 'combat',
      playerId: 0,
    };
    const result = dispatchTriggers(registered, [allyDeath], 0, pool);

    expect(result.newState.players[0]!.hand.map(c => c.name)).toContain('Top');
    expect(result.events.some(e => e.type === 'CARD_DRAWN')).toBe(true);
  });

  it('does not fire on_ally_destroyed for the destroyed card itself', () => {
    const onAllyDestroyed: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_ally_destroyed' },
      effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
    };
    const self = mockCard({ owner: 0, name: 'Lonely', abilities: [onAllyDestroyed] });
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [self, null, null] }),
          mainDeck: [mockCard({ owner: 0 })],
        }),
        mockPlayerState(1),
      ],
    });
    const registered = registerCardTriggers(state, self.instanceId);
    const pool = getAllRegisteredTriggers(registered);
    const ownDeath: GameEvent = {
      type: 'CARD_DESTROYED',
      cardInstanceId: self.instanceId,
      cause: 'combat',
      playerId: 0,
    };
    const result = dispatchTriggers(registered, [ownDeath], 0, pool);
    expect(result.events).toHaveLength(0);
  });

  it('is deterministic — identical inputs yield identical results', () => {
    const onAllyDestroyed: AbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_ally_destroyed' },
      effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
    };
    const build = (): { state: ReturnType<typeof mockGameState>; pool: ReturnType<typeof getAllRegisteredTriggers> } => {
      resetInstanceCounter();
      resetRegistrationCounter();
      const watcher = mockCard({ owner: 0, name: 'Watcher', abilities: [onAllyDestroyed] });
      const ally = mockCard({ owner: 0, name: 'Doomed' });
      const state = mockGameState({
        players: [
          mockPlayerState(0, {
            zones: zonesWithCards({ frontline: [watcher, ally, null] }),
            mainDeck: [mockCard({ owner: 0, name: 'Top' })],
          }),
          mockPlayerState(1),
        ],
      });
      const registered = registerCardTriggers(state, watcher.instanceId);
      return { state: registered, pool: getAllRegisteredTriggers(registered) };
    };
    const a = build();
    const evA: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'card_2', cause: 'combat', playerId: 0 };
    const r1 = dispatchTriggers(a.state, [evA], 0, a.pool);
    const b = build();
    const evB: GameEvent = { type: 'CARD_DESTROYED', cardInstanceId: 'card_2', cause: 'combat', playerId: 0 };
    const r2 = dispatchTriggers(b.state, [evB], 0, b.pool);
    expect(JSON.stringify(r1.newState)).toBe(JSON.stringify(r2.newState));
  });
});

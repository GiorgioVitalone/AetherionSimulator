import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerInitialTriggers,
  resolveTriggeredEvents,
  resumePendingResolution,
} from '../../src/events/index.js';
import { destroyCard } from '../../src/state/index.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import { deployToZone } from '../../src/zones/zone-manager.js';

describe('trigger resolution', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('fires on_deploy for a newly deployed character', () => {
    const deployedCard = mockCard({
      owner: 0,
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [{
          type: 'gain_resource',
          resourceType: 'mana',
          amount: 1,
        }],
      }],
    });

    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: deployToZone(emptyZones(), deployedCard, 'frontline', 0),
        }),
        mockPlayerState(1),
      ],
    });

    const result = resolveTriggeredEvents(state, [{
      type: 'CARD_DEPLOYED',
      cardInstanceId: deployedCard.instanceId,
      zone: 'frontline',
      playerId: 0,
    }]);

    expect(result.state.players[0]!.resourceBank).toHaveLength(1);
    expect(result.events.some(
      event => event.type === 'RESOURCE_GAINED' && event.playerId === 0,
    )).toBe(true);
    expect(result.state.players[0]!.zones.frontline[0]?.registeredTriggers).toHaveLength(1);
  });

  it('fires registered hero triggers on turn start', () => {
    const state = registerInitialTriggers(mockGameState({
      players: [
        mockPlayerState(0, {
          hero: {
            ...mockPlayerState(0).hero,
            abilities: [{
              type: 'triggered',
              trigger: { type: 'on_turn_start' },
              effects: [{
                type: 'gain_resource',
                resourceType: 'mana',
                amount: 1,
              }],
            }],
          },
        }),
        mockPlayerState(1),
      ],
    }));

    const result = resolveTriggeredEvents(state, [{
      type: 'TURN_START',
      playerId: 0,
      turnNumber: 1,
    }]);

    expect(result.state.players[0]!.hero.registeredTriggers).toHaveLength(1);
    expect(result.state.players[0]!.resourceBank).toHaveLength(1);
  });

  it('pauses and resumes trigger resolution for target selection', () => {
    const triggerSource = mockCard({
      owner: 0,
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_turn_start' },
        effects: [{
          type: 'deal_damage',
          amount: { type: 'fixed', value: 2 },
          target: { type: 'target_character', side: 'enemy' },
        }],
      }],
    });
    const target = mockCard({
      owner: 1,
      currentHp: 3,
      baseHp: 3,
    });

    const state = registerInitialTriggers(mockGameState({
      players: [
        mockPlayerState(0, {
          zones: deployToZone(emptyZones(), triggerSource, 'frontline', 0),
        }),
        mockPlayerState(1, {
          zones: deployToZone(emptyZones(), target, 'frontline', 0),
        }),
      ],
    }));

    const pending = resolveTriggeredEvents(state, [{
      type: 'TURN_START',
      playerId: 0,
      turnNumber: 1,
    }]);

    expect(pending.state.pendingChoice?.type).toBe('select_targets');
    expect(pending.state.pendingResolution).not.toBeNull();

    const resumed = resumePendingResolution(pending.state, {
      selectedOptionIds: [target.instanceId],
    });

    expect(resumed.state.pendingChoice).toBeNull();
    expect(resumed.state.pendingResolution).toBeNull();
    expect(resumed.state.players[1]!.zones.frontline[0]?.currentHp).toBe(1);
    expect(resumed.events.some(
      event => event.type === 'DAMAGE_DEALT' && event.targetId === target.instanceId,
    )).toBe(true);
  });

  it('fires a destroyed card\'s own on_destroy ability after it leaves play', () => {
    const martyr = mockCard({
      owner: 0,
      abilities: [{
        type: 'triggered',
        trigger: { type: 'on_destroy' },
        effects: [{
          type: 'gain_resource',
          resourceType: 'mana',
          amount: 1,
        }],
      }],
    });

    const state = registerInitialTriggers(mockGameState({
      players: [
        mockPlayerState(0, {
          zones: deployToZone(emptyZones(), martyr, 'frontline', 0),
        }),
        mockPlayerState(1),
      ],
    }));

    const destroyed = destroyCard(state, martyr.instanceId, 'effect');
    const resolved = resolveTriggeredEvents(destroyed.state, destroyed.events);

    expect(resolved.state.players[0]!.resourceBank).toHaveLength(1);
    expect(resolved.events.some(
      event => event.type === 'RESOURCE_GAINED' && event.playerId === 0,
    )).toBe(true);
  });

  it('moves volatile destroyed characters to exile instead of discard', () => {
    const volatileCard = mockCard({
      owner: 0,
      traits: ['volatile'],
    });

    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: deployToZone(emptyZones(), volatileCard, 'frontline', 0),
        }),
        mockPlayerState(1),
      ],
    });

    const destroyed = destroyCard(state, volatileCard.instanceId, 'combat');

    expect(destroyed.state.players[0]!.discardPile).toHaveLength(0);
    expect(destroyed.state.players[0]!.exileZone).toHaveLength(1);
    expect(destroyed.events.some(
      event => event.type === 'CARD_EXILED' && event.cardInstanceId === volatileCard.instanceId,
    )).toBe(true);
    expect(destroyed.events.some(
      event => event.type === 'CARD_LEFT_BATTLEFIELD' &&
        event.cardInstanceId === volatileCard.instanceId &&
        event.destination === 'exile',
    )).toBe(true);
  });
});

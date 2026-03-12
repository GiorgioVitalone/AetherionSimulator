import { beforeEach, describe, expect, it } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import { resolveStack } from '../../src/stack/stack-resolver.js';
import { normalizeGameState } from '../../src/state/index.js';
import { cardHasActiveTrait } from '../../src/state/runtime-card-helpers.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

describe('Aura runtime', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('defers aura-granted on_destroy triggers until the chain is empty', () => {
    const auraSource = mockCard({
      owner: 0,
      abilities: [{
        type: 'aura',
        effects: [{
          type: 'grant_ability',
          target: {
            type: 'all_characters',
            side: 'allied',
          },
          ability: {
            trigger: { type: 'on_destroy' },
            effects: [{
              type: 'gain_resource',
              resourceType: 'mana',
              amount: 1,
            }],
          },
          duration: { type: 'while_in_play' },
        }],
      }],
    });
    const victim = mockCard({ owner: 0, name: 'Victim' });
    const drawCard = mockCard({ owner: 0, name: 'Drawn' });

    const state = normalizeGameState(mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [auraSource, victim, null] }),
          mainDeck: [drawCard],
        }),
        mockPlayerState(1),
      ],
      stack: [
        {
          id: 'base_draw',
          type: 'spell',
          sourceInstanceId: 'base_draw',
          controllerId: 0,
          effects: [{
            type: 'draw_cards',
            count: { type: 'fixed', value: 1 },
            player: 'allied',
          }],
          targets: [],
        },
        {
          id: 'destroy_response',
          type: 'spell',
          sourceInstanceId: 'destroy_response',
          controllerId: 0,
          effects: [{
            type: 'destroy',
            target: { type: 'target_character', side: 'allied' },
          }],
          targets: [victim.instanceId],
        },
      ],
    })).state;
    const result = resolveStack(state);
    const eventTypes = result.events.map(event => event.type);
    expect(eventTypes.indexOf('CARD_DRAWN')).toBeGreaterThan(-1);
    expect(eventTypes.indexOf('RESOURCE_GAINED')).toBeGreaterThan(eventTypes.indexOf('CARD_DRAWN'));
    expect(result.state.players[0]!.resourceBank).toHaveLength(1);
  });

  it('removes aura spell effects when the aura leaves auraZone', () => {
    const auraSpell = mockCard({
      owner: 0,
      cardType: 'S',
      abilities: [{
        type: 'aura',
        effects: [{
          type: 'grant_trait',
          trait: 'swift',
          target: { type: 'all_characters', side: 'allied' },
          duration: { type: 'while_in_play' },
        }],
      }],
    });
    const ally = mockCard({ owner: 0, name: 'Beneficiary' });

    const initial = normalizeGameState(mockGameState({
      players: [
        mockPlayerState(0, {
          auraZone: [auraSpell],
          zones: zonesWithCards({ frontline: [ally, null, null] }),
        }),
        mockPlayerState(1),
      ],
    })).state;

    expect(cardHasActiveTrait(initial.players[0]!.zones.frontline[0]!, 'swift')).toBe(true);

    const bounced = executeEffect(initial, {
      type: 'bounce',
      target: { type: 'self' },
    }, {
      sourceInstanceId: auraSpell.instanceId,
      controllerId: 0,
      triggerDepth: 0,
    });
    const normalized = normalizeGameState(bounced.newState).state;

    expect(normalized.players[0]!.auraZone).toHaveLength(0);
    expect(normalized.players[0]!.hand.map(card => card.instanceId)).toContain(auraSpell.instanceId);
    expect(cardHasActiveTrait(normalized.players[0]!.zones.frontline[0]!, 'swift')).toBe(false);
  });
});

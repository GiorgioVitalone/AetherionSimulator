import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerCardTriggers,
  unregisterCardTriggers,
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';

describe('Trigger Registry', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('should register triggered abilities from a card', () => {
    const abilities: AbilityDSL[] = [
      {
        type: 'triggered',
        trigger: { type: 'on_deploy' },
        effects: [
          {
            type: 'deal_damage',
            amount: { type: 'fixed', value: 2 },
            target: { type: 'target_character', side: 'enemy' },
          },
        ],
      },
    ];

    const card = mockCard({ abilities, owner: 0 });
    let zones = deployToZone(emptyZones(), card, 'frontline');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones }),
        mockPlayerState(1),
      ],
    });

    const updated = registerCardTriggers(state, card.instanceId);
    const triggers = getAllRegisteredTriggers(updated);
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.trigger.type).toBe('on_deploy');
    expect(triggers[0]?.sourceInstanceId).toBe(card.instanceId);
    expect(triggers[0]?.ownerPlayerId).toBe(0);
  });

  it('should not register non-triggered abilities (aura, stat_grant)', () => {
    const abilities: AbilityDSL[] = [
      {
        type: 'aura',
        effects: [
          {
            type: 'modify_stats',
            modifier: { atk: 1 },
            target: { type: 'all_characters', side: 'allied' },
            duration: { type: 'while_in_play' },
          },
        ],
      },
      { type: 'stat_grant', modifier: { atk: 2 } },
    ];

    const card = mockCard({ abilities, owner: 0 });
    let zones = deployToZone(emptyZones(), card, 'frontline');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones }),
        mockPlayerState(1),
      ],
    });

    const updated = registerCardTriggers(state, card.instanceId);
    const triggers = getAllRegisteredTriggers(updated);
    expect(triggers).toHaveLength(0);
  });

  it('should unregister all triggers from a card', () => {
    const abilities: AbilityDSL[] = [
      {
        type: 'triggered',
        trigger: { type: 'on_destroy' },
        effects: [],
      },
      {
        type: 'triggered',
        trigger: { type: 'on_turn_start' },
        effects: [],
      },
    ];

    const card = mockCard({ abilities, owner: 0 });
    let zones = deployToZone(emptyZones(), card, 'frontline');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones }),
        mockPlayerState(1),
      ],
    });

    let updated = registerCardTriggers(state, card.instanceId);
    expect(getAllRegisteredTriggers(updated)).toHaveLength(2);

    updated = unregisterCardTriggers(updated, card.instanceId);
    expect(getAllRegisteredTriggers(updated)).toHaveLength(0);
  });

  it('should collect triggers from multiple cards across zones', () => {
    const triggerAbility: AbilityDSL[] = [
      {
        type: 'triggered',
        trigger: { type: 'on_attack' },
        effects: [],
      },
    ];

    const c1 = mockCard({ abilities: triggerAbility, owner: 0 });
    const c2 = mockCard({ abilities: triggerAbility, owner: 1 });

    let p0Zones = deployToZone(emptyZones(), c1, 'frontline');
    let p1Zones = deployToZone(emptyZones(), c2, 'reserve');

    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: p0Zones }),
        mockPlayerState(1, { zones: p1Zones }),
      ],
    });

    let updated = registerCardTriggers(state, c1.instanceId);
    updated = registerCardTriggers(updated, c2.instanceId);

    const triggers = getAllRegisteredTriggers(updated);
    expect(triggers).toHaveLength(2);
  });
});

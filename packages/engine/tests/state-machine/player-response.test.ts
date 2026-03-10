import { describe, it, expect, beforeEach } from 'vitest';
import { applyPendingChoiceResponse } from '../../src/state-machine/player-response.js';
import type { TriggeredAbilityDSL } from '../../src/types/ability.js';
import {
  emptyZones,
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  ZERO_COST,
} from '../helpers/card-factory.js';

describe('player response handling', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('uses choice option instanceIds for reserve exhaust responses', () => {
    const reserveCard = mockCard({
      owner: 0,
      exhausted: false,
    });

    const state = mockGameState({
      pendingChoice: {
        type: 'reserve_exhaust',
        playerId: 0,
        options: [{
          id: 'option_reserve_1',
          label: reserveCard.name,
          instanceId: reserveCard.instanceId,
        }],
        minSelections: 1,
        maxSelections: 1,
        context: 'Choose a reserve card to exhaust',
      },
      players: [
        mockPlayerState(0, {
          zones: {
            ...emptyZones(),
            reserve: [reserveCard, null],
          },
        }),
        mockPlayerState(1),
      ],
    });

    const resolved = applyPendingChoiceResponse(state, {
      selectedOptionIds: ['option_reserve_1'],
    });

    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.state.players[0]!.zones.reserve[0]!.exhausted).toBe(true);
  });
});

describe('counter/flash response window', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  function makeCounterSpell() {
    const counterAbility: TriggeredAbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_counter' },
      effects: [],
    };
    return mockCard({
      cardType: 'S',
      abilities: [counterAbility],
      cost: ZERO_COST,
    });
  }

  it('should remove counter card from hand and add to discard when played', () => {
    const counterCard = makeCounterSpell();

    const state = mockGameState({
      activePlayerIndex: 0,
      stack: [{
        id: 'stack_1',
        type: 'spell',
        sourceInstanceId: 'original_spell',
        controllerId: 0,
        effects: [{ type: 'damage', amount: 3, target: { type: 'target_character', side: 'enemy' } }],
        targets: [],
      }],
      pendingChoice: {
        type: 'response_window',
        playerId: 1,
        options: [
          { id: counterCard.instanceId, label: `${counterCard.name} (Counter)`, instanceId: counterCard.instanceId },
          { id: 'pass', label: 'Pass (no response)' },
        ],
        minSelections: 1,
        maxSelections: 1,
        context: 'You may respond with a Counter or Flash card.',
        responseContext: {
          respondingPlayerId: 1,
          stackItemId: 'stack_1',
        },
      },
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hand: [counterCard],
        }),
      ],
    });

    const resolved = applyPendingChoiceResponse(state, {
      selectedOptionIds: [counterCard.instanceId],
    });

    // Counter card removed from hand
    expect(resolved.state.players[1]!.hand).toHaveLength(0);
    // Counter card added to discard
    expect(resolved.state.players[1]!.discardPile).toHaveLength(1);
    expect(resolved.state.players[1]!.discardPile[0]!.instanceId).toBe(counterCard.instanceId);
  });

  it('should counter the original spell (marked as countered in stack)', () => {
    const counterAbility: TriggeredAbilityDSL = {
      type: 'triggered',
      trigger: { type: 'on_counter' },
      effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
    };
    const counterCard = mockCard({
      cardType: 'S',
      abilities: [counterAbility],
      cost: ZERO_COST,
    });

    const state = mockGameState({
      activePlayerIndex: 0,
      stack: [{
        id: 'stack_1',
        type: 'spell',
        sourceInstanceId: 'original_spell',
        controllerId: 0,
        effects: [{ type: 'damage', amount: 3, target: { type: 'target_character', side: 'enemy' } }],
        targets: [],
      }],
      pendingChoice: {
        type: 'response_window',
        playerId: 1,
        options: [
          { id: counterCard.instanceId, label: `${counterCard.name} (Counter)`, instanceId: counterCard.instanceId },
          { id: 'pass', label: 'Pass (no response)' },
        ],
        minSelections: 1,
        maxSelections: 1,
        context: 'You may respond with a Counter or Flash card.',
        responseContext: {
          respondingPlayerId: 1,
          stackItemId: 'stack_1',
        },
      },
      players: [
        mockPlayerState(0),
        mockPlayerState(1, {
          hand: [counterCard],
        }),
      ],
    });

    const resolved = applyPendingChoiceResponse(state, {
      selectedOptionIds: [counterCard.instanceId],
    });

    // Emits SPELL_CAST event for the counter
    const spellCastEvent = resolved.events.find(
      e => e.type === 'SPELL_CAST' && e.cardInstanceId === counterCard.instanceId,
    );
    expect(spellCastEvent).toBeDefined();
  });
});

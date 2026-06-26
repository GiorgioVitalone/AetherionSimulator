import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import {
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { ResourceCard } from '../../src/types/game-state.js';
import type { Condition } from '../../src/types/conditions.js';

// A healthy hero (LP > 10) with equal resource banks on both sides, so neither
// Rulebook standard gate (LP <= 10 / resource gap) is met. This isolates the new
// termination-mode and printed-trigger availability paths.
function healthyHeroOverrides(extra?: Partial<ReturnType<typeof mockHero>>) {
  return { hero: mockHero({ currentLp: 25, ...extra }) };
}

const oneResource: readonly ResourceCard[] = [
  { instanceId: 'rb_0', resourceType: 'mana', exhausted: false },
];

describe('Transform availability — termination knob + printed trigger', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('does NOT allow transform on empty Resource Deck under default (turn_cap) mode', () => {
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { ...healthyHeroOverrides(), resourceDeck: [] }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(false);
  });

  it('allows transform UNCONDITIONALLY when Resource Deck is empty in resource_deck_empty_transform mode', () => {
    const state = mockGameState({
      phase: 'strategy',
      config: { terminationMode: 'resource_deck_empty_transform' },
      players: [
        mockPlayerState(0, { ...healthyHeroOverrides(), resourceDeck: [] }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(true);
  });

  it('does NOT allow transform in resource_deck_empty_transform mode while Resource Deck still has cards', () => {
    const state = mockGameState({
      phase: 'strategy',
      config: { terminationMode: 'resource_deck_empty_transform' },
      players: [
        mockPlayerState(0, {
          ...healthyHeroOverrides(),
          resourceDeck: [{ instanceId: 'rd_0', resourceType: 'mana', exhausted: false }],
        }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(false);
  });

  it('respects already-used transform: empty Resource Deck does not re-enable a spent transform', () => {
    const state = mockGameState({
      phase: 'strategy',
      config: { terminationMode: 'resource_deck_empty_transform' },
      players: [
        mockPlayerState(0, {
          hero: mockHero({ currentLp: 25, transformed: true }),
          resourceDeck: [],
        }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(false);
  });

  it('allows transform when a PRINTED Transformation Trigger condition is satisfied', () => {
    const printedTrigger: Condition = {
      type: 'card_count',
      zone: 'resource_bank',
      comparison: 'greater_equal',
      value: 1,
    };
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          ...healthyHeroOverrides({ transformTrigger: printedTrigger }),
          resourceBank: oneResource,
        }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(true);
  });

  it('does NOT allow transform when the PRINTED Transformation Trigger condition is unmet', () => {
    const printedTrigger: Condition = {
      type: 'card_count',
      zone: 'resource_bank',
      comparison: 'greater_equal',
      value: 1,
    };
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, {
          ...healthyHeroOverrides({ transformTrigger: printedTrigger }),
          resourceBank: [],
        }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(false);
  });
});

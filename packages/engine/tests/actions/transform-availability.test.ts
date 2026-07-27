import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { drawResourceCard } from '../../src/state-machine/actions.js';
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
  return {
    hero: mockHero({
      currentLp: 25,
      transformData: {
        cardDefId: 999,
        name: 'Transformed Hero',
        lpDelta: 0,
        abilities: [],
      },
      ...extra,
    }),
  };
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

  it('allows transform when the Resource Deck was empty at Upkeep (before-draw flag set)', () => {
    const state = mockGameState({
      phase: 'strategy',
      config: { terminationMode: 'resource_deck_empty_transform' },
      turnState: {
        discardedForEnergy: false,
        firstPlayerFirstTurn: false,
        resourceDeckEmptyAtUpkeep: true,
      },
      players: [
        mockPlayerState(0, { ...healthyHeroOverrides(), resourceDeck: [] }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(true);
  });

  it('does NOT allow transform when the deck is empty but the at-Upkeep flag is unset (the turn the last card was drawn)', () => {
    // Deck is empty NOW, but resourceDeckEmptyAtUpkeep was never set (it had a card at
    // this turn's Upkeep). The before-draw rule must withhold transform this turn.
    const state = mockGameState({
      phase: 'strategy',
      config: { terminationMode: 'resource_deck_empty_transform' },
      players: [
        mockPlayerState(0, { ...healthyHeroOverrides(), resourceDeck: [] }),
        mockPlayerState(1),
      ],
    });
    expect(computeAvailableActions(state).canTransform).toBe(false);
  });

  it('before-draw timing: drawing the last card withholds transform that turn, then unlocks it the next', () => {
    // Turn N: deck has 1 card. drawResourceCard records the PRE-draw state (not empty)
    // and draws the card; transform stays unavailable this turn.
    const turnN = mockGameState({
      phase: 'upkeep',
      config: { terminationMode: 'resource_deck_empty_transform' },
      players: [
        mockPlayerState(0, {
          ...healthyHeroOverrides(),
          resourceDeck: [{ instanceId: 'rd_last', resourceType: 'mana', exhausted: false }],
        }),
        mockPlayerState(1),
      ],
    });
    const afterDrawN = drawResourceCard(turnN).state;
    expect(afterDrawN.turnState.resourceDeckEmptyAtUpkeep).toBe(false);
    expect(computeAvailableActions({ ...afterDrawN, phase: 'strategy' }).canTransform).toBe(false);

    // Next turn: the deck already STARTS empty at Upkeep → drawResourceCard draws 0 and
    // records empty; transform now unlocks.
    const afterDrawNext = drawResourceCard({ ...afterDrawN, phase: 'upkeep' }).state;
    expect(afterDrawNext.turnState.resourceDeckEmptyAtUpkeep).toBe(true);
    expect(computeAvailableActions({ ...afterDrawNext, phase: 'strategy' }).canTransform).toBe(
      true,
    );
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

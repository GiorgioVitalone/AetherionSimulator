/**
 * Fair-pilot reactive + mulligan policy — proves that under fairPilot the bot (1)
 * counters an enemy card-advantage engine the legacy removal/face gate ignores, and
 * (2) mulligans a resource-screwed / high-curve hand the legacy policy would keep.
 * With the flag absent, both fall back to the legacy behavior (no regression).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { chooseReactiveAction, shouldKeepHand } from '../../src/bot/heuristic.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type {
  ResourceCard,
  StackItem,
  PendingPriority,
  GameConfig,
} from '../../src/types/game-state.js';
import type { AbilityDSL } from '../../src/types/ability.js';

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `m${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}
function counterCard(id: string, cost: number) {
  const ability: AbilityDSL = {
    type: 'triggered',
    trigger: { type: 'on_counter' },
    effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
  };
  return mockCard({
    instanceId: id,
    cardType: 'S',
    owner: 1,
    cost: { mana: cost, energy: 0, flexible: 0 },
    abilities: [ability],
  });
}
const FAIR: GameConfig = { terminationMode: 'turn_cap', fairPilot: true };
const window1: PendingPriority = {
  type: 'priority',
  toRespondPlayerId: 1,
  window: 'cast',
  baseStackItemId: 'spell_DRAW',
  passes: 0,
};
const DRAW2: AbilityDSL['effects'] = [
  { type: 'draw_cards', player: 'allied', count: { type: 'fixed', value: 2 } },
];

describe('fair-pilot reactive policy', () => {
  beforeEach(() => resetInstanceCounter());

  function drawEngineOnStack() {
    const drawCard = mockCard({
      instanceId: 'DRAW',
      cardType: 'S',
      owner: 0,
      abilities: [{ type: 'triggered', trigger: { type: 'on_cast' }, effects: DRAW2 }],
    });
    const item: StackItem = {
      id: 'spell_DRAW',
      type: 'spell',
      sourceInstanceId: 'DRAW',
      controllerId: 0,
      effects: DRAW2,
      targets: [],
    };
    const p0 = mockPlayerState(0, { discardPile: [drawCard] });
    const p1 = mockPlayerState(1, { hand: [counterCard('CTR', 1)], resourceBank: manaBank(4) });
    return { p0, p1, item };
  }

  it('legacy gate IGNORES a pure card-draw engine (no removal/face)', () => {
    const { p0, p1, item } = drawEngineOnStack();
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [item],
      pendingPriority: window1,
    });
    expect(chooseReactiveAction(state)).toBeNull();
  });

  it('fair pilot COUNTERS the card-draw engine', () => {
    const { p0, p1, item } = drawEngineOnStack();
    const state = mockGameState({
      phase: 'strategy',
      players: [p0, p1],
      stack: [item],
      pendingPriority: window1,
      config: FAIR,
    });
    expect(chooseReactiveAction(state)).toMatchObject({
      type: 'cast_spell',
      cardInstanceId: 'CTR',
      selectedTargetIds: ['spell_DRAW'],
    });
  });
});

describe('fair-pilot mulligan', () => {
  beforeEach(() => resetInstanceCounter());

  it('keeps a high-curve hand under legacy, mulligans it under fair', () => {
    // Two action cards but both cost 5 — no early (cost<=2) play.
    const expensive = () => mockCard({ cardType: 'C', cost: { mana: 5, energy: 0, flexible: 0 } });
    const p0 = mockPlayerState(0, { hand: [expensive(), expensive()] });
    const legacy = mockGameState({ players: [p0, mockPlayerState(1)] });
    const fair = mockGameState({ players: [p0, mockPlayerState(1)], config: FAIR });
    expect(shouldKeepHand(legacy, 0)).toBe(true);
    expect(shouldKeepHand(fair, 0)).toBe(false);
  });

  it('keeps a hand with a cheap early play under fair', () => {
    const cheap = mockCard({ cardType: 'C', cost: { mana: 1, energy: 0, flexible: 0 } });
    const big = mockCard({ cardType: 'C', cost: { mana: 5, energy: 0, flexible: 0 } });
    const p0 = mockPlayerState(0, { hand: [cheap, big] });
    const fair = mockGameState({ players: [p0, mockPlayerState(1)], config: FAIR });
    expect(shouldKeepHand(fair, 0)).toBe(true);
  });
});

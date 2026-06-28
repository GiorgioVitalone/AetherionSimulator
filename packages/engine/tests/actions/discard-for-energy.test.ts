/**
 * Wave 5 — A18: Discard for Energy grants a temporary resource matching the
 * discarded card's resource type — "Mana if the card is Magic-aligned, Energy if
 * Tech-aligned" (Rulebook 11). Previously it always granted Energy.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { GameConfig } from '../../src/types/game-state.js';

function discard(card: ReturnType<typeof mockCard>, config?: GameConfig) {
  const state = mockGameState({
    phase: 'strategy',
    players: [mockPlayerState(0, { hand: [card] }), mockPlayerState(1)],
    ...(config ? { config } : {}),
  });
  return executePlayerAction(state, {
    type: 'discard_for_energy',
    cardInstanceId: card.instanceId,
  });
}

describe('A18 — Discard for Energy grants the card-matching resource', () => {
  beforeEach(resetInstanceCounter);

  it('grants Mana for a Mana-cost (Magic-aligned) card', () => {
    const magic = mockCard({ cost: { mana: 2, energy: 0, flexible: 0 }, alignment: ['Onyx'] });
    const result = discard(magic);
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'mana', amount: 1 },
    ]);
  });

  it('grants Energy for an Energy-cost (Tech-aligned) card', () => {
    const tech = mockCard({ cost: { mana: 0, energy: 2, flexible: 0 }, alignment: ['Verdant'] });
    const result = discard(tech);
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'energy', amount: 1 },
    ]);
  });

  it('falls back to alignment for an ambiguous (flexible-only) cost — Verdant→Energy', () => {
    const flex = mockCard({ cost: { mana: 0, energy: 0, flexible: 2 }, alignment: ['Verdant'] });
    const result = discard(flex);
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'energy', amount: 1 },
    ]);
  });

  it('falls back to alignment for an ambiguous cost — non-Verdant→Mana', () => {
    const flex = mockCard({ cost: { mana: 0, energy: 0, flexible: 2 }, alignment: ['Sapphire'] });
    const result = discard(flex);
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'mana', amount: 1 },
    ]);
  });
});

describe('exileDiscardForEnergy — the discarded card is removed from the game', () => {
  beforeEach(resetInstanceCounter);

  it('bins the card by default (it can later be reanimated)', () => {
    const card = mockCard({ cost: { mana: 1, energy: 0, flexible: 0 }, alignment: ['Onyx'] });
    const result = discard(card);
    expect(result.state.players[0].discardPile).toHaveLength(1);
    expect(result.state.players[0].discardPile[0]!.instanceId).toBe(card.instanceId);
  });

  it('exiles the card when the flag is on, leaving the discard pile empty', () => {
    const card = mockCard({ cost: { mana: 1, energy: 0, flexible: 0 }, alignment: ['Onyx'] });
    const result = discard(card, { terminationMode: 'turn_cap', exileDiscardForEnergy: true });
    expect(result.state.players[0].discardPile).toHaveLength(0);
    // Resource grant and hand removal are unchanged — only the destination differs.
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].temporaryResources).toEqual([
      { resourceType: 'mana', amount: 1 },
    ]);
  });
});

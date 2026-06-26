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

function discard(card: ReturnType<typeof mockCard>) {
  const state = mockGameState({
    phase: 'strategy',
    players: [mockPlayerState(0, { hand: [card] }), mockPlayerState(1)],
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
    expect(result.state.players[0].temporaryResources).toEqual([{ resourceType: 'mana', amount: 1 }]);
  });

  it('grants Energy for an Energy-cost (Tech-aligned) card', () => {
    const tech = mockCard({ cost: { mana: 0, energy: 2, flexible: 0 }, alignment: ['Verdant'] });
    const result = discard(tech);
    expect(result.state.players[0].temporaryResources).toEqual([{ resourceType: 'energy', amount: 1 }]);
  });

  it('falls back to alignment for an ambiguous (flexible-only) cost — Verdant→Energy', () => {
    const flex = mockCard({ cost: { mana: 0, energy: 0, flexible: 2 }, alignment: ['Verdant'] });
    const result = discard(flex);
    expect(result.state.players[0].temporaryResources).toEqual([{ resourceType: 'energy', amount: 1 }]);
  });

  it('falls back to alignment for an ambiguous cost — non-Verdant→Mana', () => {
    const flex = mockCard({ cost: { mana: 0, energy: 0, flexible: 2 }, alignment: ['Sapphire'] });
    const result = discard(flex);
    expect(result.state.players[0].temporaryResources).toEqual([{ resourceType: 'mana', amount: 1 }]);
  });
});

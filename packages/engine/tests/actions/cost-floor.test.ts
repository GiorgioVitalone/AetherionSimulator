/**
 * costFloor rule guard (§13a): stacked cost reductions can never take a card
 * below an effective TOTAL of 1 unless its printed cost is already 0. Exists
 * because an unfloored discount × a cheap self-copy spell produced a 0-cost
 * infinite loop (§12c: Arcane Echoes × Wizard's Robe — 7,990 casts in one game).
 * Absent/false ⇒ byte-identical legacy behavior (floor at zero).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { effectiveCost } from '../../src/actions/cost-checker.js';
import type { ActiveCostReduction, GameConfig } from '../../src/types/game-state.js';
import { mockCard, mockPlayerState, resetInstanceCounter } from '../helpers/card-factory.js';

const robeLike: ActiveCostReduction = {
  id: 'cost_reduction_test_0',
  reduction: 1,
  appliesTo: { tag: 'Arcane', cardType: 'S' },
  usedThisTurn: false,
};

function sapphireSpell(mana: number) {
  return mockCard({
    cardType: 'S',
    cost: { mana, energy: 0, flexible: 0 },
    tags: ['Arcane'],
  });
}

describe('costFloor rule guard', () => {
  beforeEach(() => resetInstanceCounter());

  it('should reduce a 1-cost spell to 0 without the flag (legacy)', () => {
    const player = mockPlayerState(0, { costReductions: [robeLike] });
    const c = effectiveCost(player, sapphireSpell(1));
    expect(c.mana + c.energy + c.flexible).toBe(0);
  });

  it('should floor the effective total at 1 with the flag on', () => {
    const player = mockPlayerState(0, { costReductions: [robeLike] });
    const config: GameConfig = { costFloor: true };
    const c = effectiveCost(player, sapphireSpell(1), config);
    expect(c.mana + c.energy + c.flexible).toBe(1);
  });

  it('should still apply discounts above the floor', () => {
    const player = mockPlayerState(0, { costReductions: [robeLike] });
    const c = effectiveCost(player, sapphireSpell(3), { costFloor: true });
    expect(c.mana + c.energy + c.flexible).toBe(2);
  });

  it('should cap STACKED discounts at printed-1, not per-reduction', () => {
    const player = mockPlayerState(0, { costReductions: [robeLike, { ...robeLike, id: 'r2' }] });
    const c = effectiveCost(player, sapphireSpell(2), { costFloor: true });
    expect(c.mana + c.energy + c.flexible).toBe(1);
  });

  it('should leave printed-0 cards at 0 (no phantom cost)', () => {
    const player = mockPlayerState(0, { costReductions: [robeLike] });
    const c = effectiveCost(player, sapphireSpell(0), { costFloor: true });
    expect(c.mana + c.energy + c.flexible).toBe(0);
  });

  it('should be a no-op when explicitly false', () => {
    const player = mockPlayerState(0, { costReductions: [robeLike] });
    const c = effectiveCost(player, sapphireSpell(1), { costFloor: false });
    expect(c.mana + c.energy + c.flexible).toBe(0);
  });
});

/**
 * Unit tests for the card-pool power helper (src/sim/card-pool-power.ts):
 * median + best-of-K over per-deck win rates.
 */
import { describe, it, expect } from 'vitest';
import { cardPoolPower, type DeckWinRate } from '../../src/sim/card-pool-power.js';

const r = (deckKey: string, winPct: number, games = 60): DeckWinRate => ({ deckKey, winPct, games });

describe('cardPoolPower', () => {
  it('returns zeros for an empty sample', () => {
    expect(cardPoolPower([])).toEqual({ decks: 0, median: 0, bestOfK: 0, worst: 0, bestDeckKey: null });
  });

  it('computes median (odd count), best-of-K, and worst', () => {
    const p = cardPoolPower([r('a', 0.4), r('b', 0.55), r('c', 0.5)]);
    expect(p.decks).toBe(3);
    expect(p.median).toBeCloseTo(0.5);
    expect(p.bestOfK).toBeCloseTo(0.55);
    expect(p.worst).toBeCloseTo(0.4);
    expect(p.bestDeckKey).toBe('b');
  });

  it('averages the two middle values for an even count', () => {
    const p = cardPoolPower([r('a', 0.3), r('b', 0.5), r('c', 0.6), r('d', 0.4)]);
    expect(p.median).toBeCloseTo(0.45); // (0.4 + 0.5) / 2
    expect(p.bestOfK).toBeCloseTo(0.6);
  });
});

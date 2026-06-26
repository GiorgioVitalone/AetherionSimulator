import { describe, it, expect } from 'vitest';
import {
  summarizeStats,
  type FactionCounts,
} from '../../src/sim/summarize-stats.js';

const BALANCED: FactionCounts = {
  Onyx: { w: 50, n: 100 },
  Radiant: { w: 50, n: 100 },
  Sapphire: { w: 50, n: 100 },
  Verdant: { w: 50, n: 100 },
};

const IMBALANCED: FactionCounts = {
  Onyx: { w: 65, n: 100 },
  Radiant: { w: 50, n: 100 },
  Sapphire: { w: 45, n: 100 },
  Verdant: { w: 40, n: 100 },
};

describe('summarizeStats', () => {
  it('is fully deterministic (byte-identical across calls)', () => {
    const a = summarizeStats(IMBALANCED, 'win');
    const b = summarizeStats(IMBALANCED, 'win');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('reports a balanced field as non-significant with adjusted spread 0', () => {
    const s = summarizeStats(BALANCED, 'win');
    expect(s.gTestP).toBe(1);
    // raw spread is 0; the null-bias correction floors it at 0.
    expect(s.adjustedSpread.rawSpreadPct).toBe(0);
    expect(s.adjustedSpread.adjustedSpreadPct).toBe(0);
    // bare max-min is upward biased: expected null spread > 0.
    expect(s.adjustedSpread.expectedNullSpreadPct).toBeGreaterThan(0);
  });

  it('flags imbalance: de-biased spread, worst offender, Wilson CIs', () => {
    const s = summarizeStats(IMBALANCED, 'win');
    expect(s.adjustedSpread.rawSpreadPct).toBe(25);
    // adjusted = raw - expectedNull, strictly between 0 and raw.
    expect(s.adjustedSpread.adjustedSpreadPct).toBeGreaterThan(0);
    expect(s.adjustedSpread.adjustedSpreadPct).toBeLessThan(
      s.adjustedSpread.rawSpreadPct,
    );
    // Onyx is the extreme faction.
    expect(s.worstOffenderZ?.faction).toBe('Onyx');
    expect(s.worstOffenderZ?.z).toBeGreaterThan(2);
    expect(s.worstOffenderZ?.pValue).toBeLessThan(0.05);
    // Per-faction Wilson interval contains the point estimate.
    const onyx = s.perFactionWilson.find((f) => f.faction === 'Onyx');
    expect(onyx?.winPct).toBe(65);
    expect(onyx?.loPct).toBeLessThan(65);
    expect(onyx?.hiPct).toBeGreaterThan(65);
  });

  it('sorts perFactionWilson by faction name', () => {
    const s = summarizeStats(IMBALANCED, 'win');
    const names = s.perFactionWilson.map((f) => f.faction);
    expect(names).toEqual([...names].sort());
  });

  it('handles an empty map without throwing', () => {
    const s = summarizeStats({});
    expect(s.gTestP).toBe(1);
    expect(s.perFactionWilson).toEqual([]);
    expect(s.worstOffenderZ).toBeNull();
    expect(s.mode).toBe('win');
  });

  it('echoes the mode label without affecting the math', () => {
    const a = summarizeStats(IMBALANCED, 'win');
    const b = summarizeStats(IMBALANCED, 'firstPlayer');
    expect(b.mode).toBe('firstPlayer');
    expect(a.gTestP).toBe(b.gTestP);
    expect(a.adjustedSpread).toEqual(b.adjustedSpread);
  });
});

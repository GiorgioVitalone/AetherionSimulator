import { describe, expect, it } from 'vitest';
import {
  runBenchmarks,
  verifyBenchmarks,
} from '../../benchmark-engine.mjs';

describe('current engine performance budgets', () => {
  it('stays within measured throughput/memory budgets without changing traces', () => {
    const report = runBenchmarks();
    expect(verifyBenchmarks(report)).toEqual([]);
    expect(report.semanticGates).toEqual({
      observerRunHashEquivalent: true,
      observerReplayHashesEquivalent: true,
      studyPairingCount: 210,
    });
  });
});

/**
 * balance-lock.mjs — gradeRatification / findRolloutPilot regression tests.
 *
 * Covers the r16 rollout rung (RXX_GPP in balance-verify.mjs), an OPTIONAL 4th
 * convergence-ladder rung graded by gradeRatification:
 *   - archives WITHOUT an r16 pilot must grade EXACTLY as before (r8->r12
 *     convergence only, 2-rung pooling) — backward compatibility.
 *   - archives WITH an r16 pilot pool across [r8, r12, r16] and grade an
 *     additional r12->r16 convergence line per faction.
 *   - findRolloutPilot('r16') resolves the new label.
 */
import { describe, expect, it } from 'vitest';
import { gradeRatification, findRolloutPilot } from '../../balance-lock.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

// Same Wilson 95% score interval as balance-lock.mjs/balance-verify.mjs — the
// archive's per-pilot marg entries carry a precomputed wilson tuple, so the
// fixture must supply one too.
function wilson(w: number, n: number, z = 1.96): [number, number, number] {
  if (n <= 0) return [0, 0, 0];
  const p = w / n,
    d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}

function makeMarg(w: number, n: number) {
  return Object.fromEntries(FACTIONS.map((f) => [f, { w, n, wilson: wilson(w, n) }]));
}

function makeMatchupDetail(wA: number, wB: number) {
  return {
    'Onyx|Radiant': { fA: 'Onyx', fB: 'Radiant', wA, wB },
  };
}

function makePilot(
  label: string,
  runHash: string,
  opts: {
    w: number;
    n: number;
    wA: number;
    wB: number;
    mirrorFp: number;
    games: number;
    decidedPct: number;
  },
) {
  return {
    kind: 'agg' as const,
    label,
    runHash,
    marg: makeMarg(opts.w, opts.n),
    matchupDetail: makeMatchupDetail(opts.wA, opts.wB),
    mirrorFp: opts.mirrorFp,
    games: opts.games,
    decidedPct: opts.decidedPct,
  };
}

const r8 = makePilot('rollout-high (r8 d3 c8)', 'hash-r8', {
  w: 50,
  n: 100,
  wA: 60,
  wB: 40,
  mirrorFp: 51,
  games: 1000,
  decidedPct: 90,
});
const r12 = makePilot('rollout-max (r12 d3 c8)', 'hash-r12', {
  w: 55,
  n: 100,
  wA: 55,
  wB: 45,
  mirrorFp: 52,
  games: 1200,
  decidedPct: 92,
});
const r16 = makePilot('rollout-ultra (r16 d3 c8)', 'hash-r16', {
  w: 52,
  n: 100,
  wA: 58,
  wB: 42,
  mirrorFp: 50,
  games: 1400,
  decidedPct: 95,
});

const THRESHOLDS = {
  factionWinPct: { flagBelow: 45, flagAbove: 55, failBelow: 0, failAbove: 100 },
  spreadPp: { flagAbove: 6, failAbove: 100 },
  worstCellDevPp: { flagAbove: 20, failAbove: 100 },
  mirrorFpEdgePp: { flagAbove: 3, failAbove: 100 },
  decidedPct: { flagBelow: 85, failBelow: 0 },
};

describe('balance-lock.mjs — gradeRatification r16 rung', () => {
  it('archive WITHOUT r16 grades r8->r12 convergence only (backward-compat)', () => {
    const archive = { pilots: [r8, r12] };
    const graded = gradeRatification(archive, THRESHOLDS);

    // 1 spread + 4 CI bands + 1 worst cell + 1 mirror FP + 1 decided% + 4 convergence(r8->r12) = 12
    expect(graded.grades).toHaveLength(12);
    expect(graded.grades.some((g) => g.criterion.includes('Convergence (r12→r16)'))).toBe(false);
    expect(graded.grades.some((g) => g.criterion.includes('Convergence (r8→r12)'))).toBe(true);
    expect(Object.keys(graded.rungRunHashes)).toEqual([r8.label, r12.label]);

    // Pooled marg is the plain r8+r12 sum, exactly as before.
    expect(graded.pooled.marg.Onyx.w).toBe(50 + 55);
    expect(graded.pooled.marg.Onyx.n).toBe(100 + 100);
  });

  it('archive WITH r16 pools all three rungs and grades r8->r12->r16 convergence', () => {
    const archive = { pilots: [r8, r12, r16] };
    const graded = gradeRatification(archive, THRESHOLDS);

    // 12 (as above) + 4 more convergence(r12->r16) = 16
    expect(graded.grades).toHaveLength(16);
    expect(graded.grades.some((g) => g.criterion.includes('Convergence (r8→r12)'))).toBe(true);
    expect(graded.grades.some((g) => g.criterion.includes('Convergence (r12→r16)'))).toBe(true);
    expect(Object.keys(graded.rungRunHashes)).toEqual([r8.label, r12.label, r16.label]);
    expect(graded.rungRunHashes[r16.label]).toBe('hash-r16');

    // Pooled marg sums all three rungs.
    expect(graded.pooled.marg.Onyx.w).toBe(50 + 55 + 52);
    expect(graded.pooled.marg.Onyx.n).toBe(100 + 100 + 100);

    // Pooled mirrorFp is games-weighted across all three.
    const expectedMirrorFp = (51 * 1000 + 52 * 1200 + 50 * 1400) / (1000 + 1200 + 1400);
    expect(graded.pooled.mirrorFp).toBeCloseTo(expectedMirrorFp, 10);

    // Decided% is the min across all three rungs.
    expect(graded.pooled.decidedPct).toBe(90);
  });

  it('order of pilots in the archive does not matter — r16 present anywhere is detected', () => {
    const archive = { pilots: [r16, r8, r12] };
    const graded = gradeRatification(archive, THRESHOLDS);
    expect(Object.keys(graded.rungRunHashes)).toHaveLength(3);
  });
});

describe('balance-lock.mjs — findRolloutPilot', () => {
  it("resolves the r16 label ('rollout-ultra (r16 d3 c8)')", () => {
    const archive = { pilots: [r8, r12, r16] };
    const pilot = findRolloutPilot(archive, 'r16');
    expect(pilot.label).toBe('rollout-ultra (r16 d3 c8)');
    expect(pilot.runHash).toBe('hash-r16');
  });

  it('throws when no pilot matches the tag (archive without r16)', () => {
    const archive = { pilots: [r8, r12] };
    expect(() => findRolloutPilot(archive, 'r16')).toThrow();
  });
});

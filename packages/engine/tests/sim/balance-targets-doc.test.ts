/**
 * Doc-drift guard: docs/balance-targets.md §2 must stay in sync with the
 * canonical `sim-data/balance-targets.json`. Changing a threshold in one
 * place and not the other should fail CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const targetsPath = join(here, '..', '..', 'sim-data', 'balance-targets.json');
const docPath = join(here, '..', '..', '..', '..', 'docs', 'balance-targets.md');

interface Thresholds {
  factionWinPct: { flagBelow: number; flagAbove: number; failBelow: number; failAbove: number };
  spreadPp: { flagAbove: number; failAbove: number };
  worstCellDevPp: { flagAbove: number; failAbove: number };
  mirrorFpEdgePp: { flagAbove: number; failAbove: number };
  decidedPct: { flagBelow: number; failBelow: number };
  minCellGames: number;
  pacing: {
    naturalKillPct: { watchBelow: number };
    tiebreakPct: { watchAbove: number };
    turnsP50: { watchBelow: number; watchAbove: number };
    leaderAt10WinPct: { watchAbove: number };
    comebackPct: { watchBelow: number };
  };
}

const targets = JSON.parse(readFileSync(targetsPath, 'utf8')) as { thresholds: Thresholds };
const T = targets.thresholds;
const doc = readFileSync(docPath, 'utf8');

// Pull out just §2's table so matches are scoped to the target table, not the
// prose provenance section or historical run logs elsewhere in the doc.
const section2 = doc.slice(doc.indexOf('## 2. The targets'), doc.indexOf('## 3. Three caveats'));

describe('docs/balance-targets.md §2 matches sim-data/balance-targets.json', () => {
  it('per-faction win % band matches the flag/fail bounds', () => {
    expect(section2).toMatch(
      new RegExp(`<${T.factionWinPct.flagBelow}% or >${T.factionWinPct.flagAbove}%`),
    );
    expect(section2).toMatch(
      new RegExp(`<${T.factionWinPct.failBelow}% or >${T.factionWinPct.failAbove}%`),
    );
  });

  it('parity spread matches flag/fail thresholds', () => {
    expect(section2).toMatch(new RegExp(`≤${T.spreadPp.flagAbove}\\s*pp`));
    expect(section2).toMatch(new RegExp(`>${T.spreadPp.flagAbove}\\s*pp`));
    expect(section2).toMatch(new RegExp(`${T.spreadPp.failAbove}\\s*pp`));
  });

  it('worst matchup cell matches the flag/fail win% boundaries', () => {
    const flagHi = 50 + T.worstCellDevPp.flagAbove;
    const flagLo = 100 - flagHi;
    const failHi = 50 + T.worstCellDevPp.failAbove;
    const failLo = 100 - failHi;
    expect(section2).toContain(`${flagHi}/${flagLo}`); // flag boundary, e.g. 70/30
    expect(section2).toContain(`${failHi}/${failLo}`); // fail boundary, e.g. 80/20
  });

  it('first-player edge matches flag/fail thresholds', () => {
    expect(section2).toMatch(new RegExp(`≤\\+${T.mirrorFpEdgePp.flagAbove}\\s*pp`));
    expect(section2).toMatch(new RegExp(`>${T.mirrorFpEdgePp.flagAbove}\\s*pp`));
    expect(section2).toMatch(new RegExp(`>${T.mirrorFpEdgePp.failAbove}\\s*pp`));
  });

  it('decided% matches flag/fail thresholds', () => {
    expect(section2).toContain(`${T.decidedPct.flagBelow}%`);
    expect(section2).toContain(`${T.decidedPct.failBelow}%`);
  });

  it('min cell games floor is documented somewhere in the doc', () => {
    expect(doc).toContain(`${T.minCellGames} games`);
  });

  it("watch-grade pacing turnsP50 band matches the doc's ungated watch table", () => {
    expect(section2).toContain(
      `<${T.pacing.turnsP50.watchBelow} or >${T.pacing.turnsP50.watchAbove}`,
    );
  });
});

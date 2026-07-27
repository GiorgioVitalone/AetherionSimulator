// balance-lock.mjs — ruleset-lock machinery: grades a ratification panel
// against the PRE-REGISTERED acceptance criteria and, on PASS, freezes the
// ruleset manifest at sim-data/ruleset-v1.json (+ two gameplay pins).
//
// Usage:  node balance-lock.mjs <ledger-id> [--dry-run]
//
// The ledger entry (balance-runs/ledger.jsonl) points at a full archive under
// balance-runs/runs/<id>.json (balance-verify.mjs output, folded by
// balance-ledger.mjs). This script pools the two rollout ("agg") pilots whose
// labels contain 'r8' and 'r12' — the graded verdict layer (docs/balance-
// targets.json provenance: pooled r8+r12 ~2400 games/faction, CI ±2.0pp) —
// and grades six pre-registered criteria. Any FAIL means ratification did not
// pass and the manifest is NOT written. --dry-run always grades-and-exits
// without writing, regardless of the verdict (useful to preview a panel that
// is expected to fail).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readLedger } from './balance-ledger.mjs';
import { runSim } from './sim-runner.mjs';

const ENGINE_DIR = fileURLToPath(new URL('.', import.meta.url));
const RUNS_DIR = `${ENGINE_DIR}balance-runs/runs/`;
const TARGETS = JSON.parse(readFileSync(new URL('./sim-data/balance-targets.json', import.meta.url), 'utf8')).thresholds;
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];

// Exactly the 9 ruleset flags the lock manifest is scoped to — every other
// archive.ruleset key (firstPlayer, fixHandSizeStall, termination,
// abilitiesOn, turnCap, seedBase, seatAlternation) is a harness/base-config
// knob, not a rule.
export const RULE_KEYS = [
  'armFirstInstanceOnly', 'terminationMode', 'costFloor', 'reserveTapChoice',
  'reserveTapStrain', 'exileDiscardForEnergy', 'resourceDeckSize', 'firstPlayerCompensation',
  'apnapAnyOrderFix',
];

// Wilson 95% score interval -> [lowPct, pPct, highPct]. Same formula as
// balance-verify.mjs / balance-card-gate.mjs.
function wilson(w, n, z = 1.96) {
  if (n <= 0) return [0, 0, 0];
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}
const overlap = ([lo1, , hi1], [lo2, , hi2]) => lo1 <= hi2 && lo2 <= hi1;
const pct = (x) => `${x.toFixed(1)}%`;

function loadLedgerEntry(ledgerId) {
  const entries = readLedger(Number.MAX_SAFE_INTEGER);
  const entry = entries.find((e) => e.id === ledgerId);
  if (!entry) {
    throw new Error(`balance-lock: no ledger entry with id "${ledgerId}" (checked balance-runs/ledger.jsonl)`);
  }
  const archivePath = `${RUNS_DIR}${ledgerId}.json`;
  if (!existsSync(archivePath)) {
    throw new Error(`balance-lock: ledger entry "${ledgerId}" found but its archive is missing: ${archivePath}`);
  }
  const archive = JSON.parse(readFileSync(archivePath, 'utf8'));
  return { entry, archive };
}

export function findRolloutPilot(archive, tag) {
  const pilot = (archive.pilots || []).find((p) => p.kind === 'agg' && p.label.includes(tag));
  if (!pilot) throw new Error(`balance-lock: archive has no kind:'agg' pilot with label containing "${tag}"`);
  return pilot;
}

/** Non-throwing lookup — used for the OPTIONAL r16 rung, which archives graded
 * before its introduction will not have. Returns undefined when absent. */
function findOptionalRolloutPilot(archive, tag) {
  return (archive.pilots || []).find((p) => p.kind === 'agg' && p.label.includes(tag));
}

/** Pool two agg pilots' matchupDetail into unordered-pair {wA, n} sums, non-mirror only. */
function poolMatchupDetail(pilots) {
  const pairs = {}; // key "fA|fB" -> { wA, n }
  for (const p of pilots) {
    for (const [key, cell] of Object.entries(p.matchupDetail || {})) {
      if (cell.fA === cell.fB) continue; // mirror — excluded from worst-cell grading
      const t = (pairs[key] ??= { wA: 0, n: 0 });
      t.wA += cell.wA;
      t.n += cell.wA + cell.wB;
    }
  }
  return pairs;
}

/**
 * Pool the r8 + r12 rollout pilots and grade the six pre-registered
 * acceptance criteria. Returns { grades, pass, pooled } — grades is the
 * printable table, pass is the overall boolean, pooled carries the numbers
 * the manifest needs (pooled marg, spread, etc).
 */
export function gradeRatification(archive, thresholds = TARGETS) {
  const r8 = findRolloutPilot(archive, 'r8');
  const r12 = findRolloutPilot(archive, 'r12');
  // r16 is OPTIONAL — a 4th convergence-ladder rung (RXX_GPP in balance-verify.mjs).
  // Archives graded before its introduction have no such pilot; grading must be
  // byte-identical to today when it's absent.
  const r16 = findOptionalRolloutPilot(archive, 'r16');
  const rungs = r16 ? [r8, r12, r16] : [r8, r12];

  // ── Pooled per-faction marginals + Wilson CI ──
  const pooledMarg = {};
  for (const f of FACTIONS) {
    const w = rungs.reduce((sum, r) => sum + r.marg[f].w, 0);
    const n = rungs.reduce((sum, r) => sum + r.marg[f].n, 0);
    pooledMarg[f] = { w, n, wilson: wilson(w, n) };
  }
  const mids = FACTIONS.map((f) => pooledMarg[f].wilson[1]);
  const pooledSpread = Math.max(...mids) - Math.min(...mids);

  // ── Pooled non-mirror matchup cells -> worst-cell deviation from 50% ──
  const pooledPairs = poolMatchupDetail(rungs);
  let worst = { dev: 0 };
  for (const [key, { wA, n }] of Object.entries(pooledPairs)) {
    if (n <= 0) continue;
    const wp = 100 * wA / n, dev = Math.abs(wp - 50);
    if (dev > worst.dev) worst = { dev, key, wp, n };
  }

  // ── Pooled mirrorFp (weighted by games) + min decided% ──
  const totalGames = rungs.reduce((sum, r) => sum + r.games, 0);
  const pooledMirrorFp = rungs.reduce((sum, r) => sum + r.mirrorFp * r.games, 0) / totalGames;
  const pooledDecided = Math.min(...rungs.map((r) => r.decidedPct));

  // ── grades ──
  const grades = [];
  let pass = true;
  const add = (criterion, measured, ok) => { grades.push({ criterion, measured, verdict: ok ? 'PASS' : 'FAIL' }); if (!ok) pass = false; };

  add('Pooled spread (max−min)', pct(pooledSpread), pooledSpread <= thresholds.spreadPp.failAbove);

  for (const f of FACTIONS) {
    const [lo, , hi] = pooledMarg[f].wilson;
    const inBand = !(hi < thresholds.factionWinPct.failBelow || lo > thresholds.factionWinPct.failAbove);
    add(`Pooled CI band: ${f}`, `${pct(lo)}–${pct(hi)}`, inBand);
  }

  add(
    'Worst pooled cell win%',
    worst.key ? `${worst.key} ${pct(worst.wp)} (dev ${pct(worst.dev)}, n=${worst.n})` : 'n/a',
    worst.dev <= thresholds.worstCellDevPp.flagAbove,
  );

  add('Mirror FP edge (pooled)', `${pct(pooledMirrorFp - 50)} over 50%`, Math.abs(pooledMirrorFp - 50) <= thresholds.mirrorFpEdgePp.flagAbove);

  add(`Decided% (min of ${r16 ? 'r8/r12/r16' : 'r8/r12'})`, pct(pooledDecided), pooledDecided >= thresholds.decidedPct.flagBelow);

  for (const f of FACTIONS) {
    const midR8 = r8.marg[f].wilson[1];
    const midR12 = r12.marg[f].wilson[1];
    const drift = Math.abs(midR12 - midR8);
    const ciOverlap = overlap(r8.marg[f].wilson, r12.marg[f].wilson);
    add(`Convergence (r8→r12): ${f}`, `drift ${pct(drift)}${ciOverlap ? ', CIs overlap' : ', CIs disjoint'}`, drift <= 3 || ciOverlap);
  }

  if (r16) {
    for (const f of FACTIONS) {
      const midR12 = r12.marg[f].wilson[1];
      const midR16 = r16.marg[f].wilson[1];
      const drift = Math.abs(midR16 - midR12);
      const ciOverlap = overlap(r12.marg[f].wilson, r16.marg[f].wilson);
      add(`Convergence (r12→r16): ${f}`, `drift ${pct(drift)}${ciOverlap ? ', CIs overlap' : ', CIs disjoint'}`, drift <= 3 || ciOverlap);
    }
  }

  return {
    grades,
    pass,
    pooled: { marg: pooledMarg, spread: pooledSpread, worst, mirrorFp: pooledMirrorFp, decidedPct: pooledDecided },
    rungRunHashes: r16
      ? { [r8.label]: r8.runHash ?? null, [r12.label]: r12.runHash ?? null, [r16.label]: r16.runHash ?? null }
      : { [r8.label]: r8.runHash ?? null, [r12.label]: r12.runHash ?? null },
  };
}

function printGradeTable(ledgerId, grades, pass) {
  console.log(`\n══ RATIFICATION GRADE — ${ledgerId} ══`);
  const w1 = Math.max(...grades.map((g) => g.criterion.length));
  const w2 = Math.max(...grades.map((g) => g.measured.length));
  for (const g of grades) {
    console.log(`  ${g.criterion.padEnd(w1)}  ${g.measured.padEnd(w2)}  ${g.verdict}`);
  }
  console.log(pass ? '\nRATIFICATION PASSED\n' : '\nRATIFICATION FAILED\n');
}

// ── Tiny deterministic config for the two lock pins ─────────────────────────
const TINY_BASE = {
  rulesProfile: 'custom-diagnostic',
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 31337,
  decks: { Onyx: 'Onyx', Radiant: 'Radiant' },
  matchups: [{ p0Deck: 'Onyx', p1Deck: 'Radiant' }],
  gamesPerPairing: 6,
};

async function computePin(rules) {
  const config = { ...TINY_BASE, ...rules };
  const result = await runSim(config);
  return { configDescription: 'TINY_BASE (Onyx vs Radiant, 6 games, seedBase 31337)' + (Object.keys(rules).length ? ' + ruleset-v1 rules' : ' (flags off)'), runHash: result.runHash };
}

async function writeManifest(ledgerId, entry, archive, graded) {
  const rules = Object.fromEntries(RULE_KEYS.filter((k) => k in archive.ruleset).map((k) => [k, archive.ruleset[k]]));

  const gameplayPin = await computePin(rules);
  const legacyPin = await computePin({});

  const manifest = {
    version: '1.0.0',
    rules,
    ratification: {
      ledgerId,
      date: entry.date,
      poolSha: archive.pool.sha256_16,
      rungRunHashes: graded.rungRunHashes,
      grades: graded.grades,
    },
    gameplayPin,
    legacyPin,
    amendment: 'see docs/balance-framework.md §1 — v1 never mutates; changes produce ruleset-v2.json',
  };

  const outPath = new URL('./sim-data/ruleset-v1.json', import.meta.url);
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${fileURLToPath(outPath)}`);
  console.log('\nNext steps:');
  console.log(`  1. Commit sim-data/ruleset-v1.json and the ratification archive (balance-runs/runs/${ledgerId}.json).`);
  console.log('  2. Run: pnpm vitest run tests/sim/ruleset-v1-lock.test.ts');
  return manifest;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const ledgerId = argv.find((a) => !a.startsWith('--'));
  if (!ledgerId) {
    console.error('Usage: node balance-lock.mjs <ledger-id> [--dry-run]');
    process.exit(1);
  }

  const { entry, archive } = loadLedgerEntry(ledgerId);
  const graded = gradeRatification(archive, TARGETS);
  printGradeTable(ledgerId, graded.grades, graded.pass);

  if (dryRun) {
    process.exit(0);
  }
  if (!graded.pass) {
    console.error('RATIFICATION FAILED — lock not written');
    process.exit(2);
  }
  await writeManifest(ledgerId, entry, archive, graded);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

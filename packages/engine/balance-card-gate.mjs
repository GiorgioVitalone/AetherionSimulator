// balance-card-gate.mjs — the programmatic gate a new/changed card pool must
// pass before adoption. Two stages, delegating to the existing tools rather
// than re-implementing them:
//
//   STAGE A (static, seconds) — diff candidate vs the reference baseline pool,
//   run balance-card-audit.mjs's per-card pricer (+ balance-hero-audit.mjs if
//   a hero/transform changed) on the CHANGED cards only. Over-budget or a
//   detected combo/engine loop (or, for heroes, a window violation) is a hard
//   stop — no simulation is worth running on a card that is already wrong on
//   paper.
//
//   STAGE B (simulation, minutes) — spawns balance-verify.mjs FOCUSed on the
//   candidate's faction and grades the result against sim-data/balance-
//   targets.json's `cardGate` block. --quick swaps this for a cheap
//   heuristic-only directional read and is ADVISORY ONLY (never a PASS).
//
// Baseline: by default the RATIFIED run — the ledger entry named by the locked
// ruleset manifest's ratification.ledgerId (sim-data/ruleset-v1.json). Pass
// --baseline <ledger-id> to compare against a specific historical run instead,
// or --baseline latest for the old "most recent qualifying full panel" heuristic.
//
// Usage:
//   node balance-card-gate.mjs <candidate-pool.json> --faction <Faction>
//     [--quick] [--rd <n>] [--baseline <ledger-id>|latest]
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendRun, latestBaseline, readLedger } from './balance-ledger.mjs';
import { auditPool } from './balance-card-audit.mjs';
import { indexFromRaw } from './balance-data.mjs';

const ENGINE_DIR = fileURLToPath(new URL('.', import.meta.url));
const RUNS_DIR = `${ENGINE_DIR}balance-runs/runs/`;
const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const targetsRaw = JSON.parse(readFileSync(new URL('./sim-data/balance-targets.json', import.meta.url), 'utf8'));
const T = targetsRaw.thresholds;
const CG = targetsRaw.cardGate;
const FOCUS_PRESET = targetsRaw.presets.focus;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--faction') out.faction = argv[++i];
    else if (a === '--quick') out.quick = true;
    else if (a === '--rd') out.rd = argv[++i];
    else if (a === '--baseline') out.baseline = argv[++i];
    else out._.push(a);
  }
  return out;
}

function wilson(w, n, z = 1.96) {
  if (n <= 0) return [0, 0, 0];
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}
const overlap = ([lo1, , hi1], [lo2, , hi2]) => lo1 <= hi2 && lo2 <= hi1;
const pct = (x) => `${x.toFixed(1)}%`;
// Two-proportion z-test, pooled variance (standard test for "did this cell's
// win% move" between two independent binomial samples). |z|>1.96 ~ p<0.05 two-tailed.
function twoPropZ(w1, n1, w2, n2) {
  const p1 = w1 / n1, p2 = w2 / n2, pooled = (w1 + w2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (p1 - p2) / se;
}

// ── Baseline resolution ───────────────────────────────────────────────────
function loadRulesetManifest() {
  try {
    return JSON.parse(readFileSync(new URL('./sim-data/ruleset-v1.json', import.meta.url), 'utf8'));
  } catch {
    return null;
  }
}
function resolveBaseline(id) {
  if (id === 'latest') {
    const e = latestBaseline();
    if (!e) {
      console.error(
        'balance-card-gate: no qualifying baseline in the ledger yet (kind=verify, no focus, preset verdict/full or GPP_MATRIX>=1000).\n' +
        "Run a full panel first — e.g. `node balance-cli.mjs verify --preset verdict --label <name>` — then re-run the gate.",
      );
      process.exit(1);
    }
    return e;
  }
  if (id) {
    const e = readLedger(9999).find((x) => x.id === id);
    if (!e) { console.error(`balance-card-gate: no ledger entry with id ${id}`); process.exit(1); }
    return e;
  }
  // Default: the RATIFIED run named by the locked ruleset manifest — the
  // integrity anchor. latestBaseline()'s heuristic search is opt-in only
  // (--baseline latest), for historical validation.
  const manifest = loadRulesetManifest();
  const ledgerId = manifest?.ratification?.ledgerId;
  if (!ledgerId) {
    console.error('balance-card-gate: no ratification.ledgerId in sim-data/ruleset-v1.json — the ruleset is not yet locked. Pass --baseline <id> or --baseline latest explicitly.');
    process.exit(1);
  }
  const e = readLedger(9999).find((x) => x.id === ledgerId);
  if (!e) { console.error(`balance-card-gate: ratified ledger entry ${ledgerId} not found in balance-runs/ledger.jsonl — the ledger is stale or missing.`); process.exit(1); }
  return e;
}
function loadArchive(entry) {
  const p = `${RUNS_DIR}${entry.id}.json`;
  if (!existsSync(p)) {
    console.error(`balance-card-gate: baseline archive missing at ${p} — the run history for ${entry.id} is incomplete.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}
function loadBaselinePool(entry) {
  const p = entry.pool.path.startsWith('file://') ? fileURLToPath(entry.pool.path) : entry.pool.path;
  if (!existsSync(p)) {
    console.error(`balance-card-gate: baseline pool file missing at ${p}. Re-run make-pools.mjs to regenerate it, or point --baseline at a run with a surviving pool.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(p, 'utf8'));
}

// ── STAGE A: static diff + pricer ───────────────────────────────────────────
function diffPools(basePool, candPool) {
  const baseById = new Map(basePool.map((c) => [c.id, c]));
  const candById = new Map(candPool.map((c) => [c.id, c]));
  const changed = [], added = [], removed = [];
  for (const [id, c] of candById) {
    const b = baseById.get(id);
    if (!b) added.push(c);
    else if (JSON.stringify(b) !== JSON.stringify(c)) changed.push(c);
  }
  for (const [id, b] of baseById) if (!candById.has(id)) removed.push(b);
  return { changed, added, removed };
}

function runStaticGate(candidateRaw, candidatePoolPath, touched) {
  const touchedIds = new Set(touched.changed.concat(touched.added).map((c) => c.id));
  const { index } = indexFromRaw(candidateRaw);
  const results = auditPool(index).filter((r) => touchedIds.has(r.id));
  const rows = results.map((r) => {
    const budgetMatch = r.reasons.find((x) => x.startsWith('budget:'));
    const loopMatch = r.reasons.find((x) => x.startsWith('loop '));
    const overBudget = !!(budgetMatch && budgetMatch.startsWith('budget: over'));
    // Amount BEYOND tolerance (the audit's "over by X"). Budget deviations are
    // SIM-NEEDED per the valuation doc (sims are the verdict layer) — only an
    // EGREGIOUS deviation (cardGate.staticOverBudgetHardFail power points past
    // tolerance) is a statically-provable stop, like loops and hero-band hits.
    const overAmount = overBudget ? parseFloat(budgetMatch.replace('budget: over by ', '')) || 0 : 0;
    return { ...r, overBudget, overAmount, hasLoop: !!loopMatch };
  });

  let heroFlagLines = [];
  const heroTouched = touched.changed.concat(touched.added).some((c) => c.cardType === 'H' || c.cardType === 'T');
  if (heroTouched) {
    const res = spawnSync('node', ['balance-hero-audit.mjs'], {
      cwd: ENGINE_DIR, env: { ...process.env, AETHERION_CARDS: candidatePoolPath }, encoding: 'utf8',
    });
    heroFlagLines = (res.stdout || '').split('\n').filter((l) => l.includes('FLAG'));
  }

  const egregious = CG.staticOverBudgetHardFail ?? 4;
  const hardFail = rows.some((r) => r.hasLoop || r.overAmount > egregious) || heroFlagLines.length > 0;
  const simNeeded = rows.some((r) => r.overBudget || r.verdict !== 'SHIP');
  return { rows, heroFlagLines, hardFail, simNeeded };
}

function printStaticTable(diff, gate) {
  console.log(`\n══ STAGE A — static pricer (balance-card-audit.mjs) ══`);
  console.log(`Diff vs baseline pool: ${diff.changed.length} changed, ${diff.added.length} added, ${diff.removed.length} removed`);
  if (!diff.changed.length && !diff.added.length && !diff.removed.length) {
    console.log('  no-op pool — nothing changed, PASS by definition.');
    return;
  }
  if (!gate.rows.length) {
    console.log('  no changed/added non-hero cards to price (hero-only or removal-only change).');
  }
  for (const r of gate.rows) {
    const verdict = r.hasLoop || r.overAmount > (CG.staticOverBudgetHardFail ?? 4) ? 'FAIL' : r.overBudget || r.verdict !== 'SHIP' ? 'SIM-NEEDED' : 'PASS';
    console.log(`  ${verdict.padEnd(4)} ${String(r.id).padEnd(6)} ${r.name.padEnd(28).slice(0, 28)} ${r.faction.padEnd(9)} ${r.reasons.join(' | ') || '—'}`);
  }
  // Removed cards can't be priced (nothing left to run the pricer on), but
  // their absence must still be visible in the table, not silently dropped.
  for (const c of diff.removed) {
    console.log(`  ${'REMOVED'.padEnd(4)} ${String(c.id).padEnd(6)} ${c.name.padEnd(28).slice(0, 28)} ${(c.alignment || []).join('/').padEnd(9)} —`);
  }
  if (gate.heroFlagLines.length) {
    console.log('  Hero-audit window violations (balance-hero-audit.mjs):');
    for (const l of gate.heroFlagLines) console.log(`    ${l.trim()}`);
  }
}

// ── Faction containment ───────────────────────────────────────────────────
// A FOCUS run only measures --faction's pairings; a touched card outside that
// faction's alignment would be silently ungated (edited but never re-measured).
function checkFactionContainment(diff, faction) {
  const touched = [...diff.changed, ...diff.added, ...diff.removed];
  const offenders = touched.filter((c) => !(c.alignment || []).includes(faction));
  if (!offenders.length) return;
  console.error(`\n══ VERDICT: FAIL (faction containment) ══`);
  console.error(`--faction ${faction} but the following touched cards are not aligned to it:`);
  for (const c of offenders) console.error(`  ${String(c.id).padEnd(6)} ${c.name.padEnd(28)} alignment: ${(c.alignment || []).join(', ') || '(none)'}`);
  process.exit(2);
}

// ── STAGE B: simulation gate ─────────────────────────────────────────────
function runSimStage({ candidatePoolPath, faction, quick, rd, label, baseline }) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const gaugeOut = `${RUNS_DIR}gate-tmp-${Date.now()}.json`;
  const env = { ...process.env, FOCUS: faction, AETHERION_CARDS: candidatePoolPath, GAUGE_OUT: gaugeOut };
  // Like-for-like ruleset: the candidate MUST run under the baseline's recorded
  // rules or every cell comparison is confounded (e.g. a comp-on baseline vs a
  // comp-off candidate silently shifts marginals ~2pp). Explicit flags/env win;
  // otherwise inherit from the baseline entry's ruleset snapshot.
  const rs = baseline?.ruleset ?? {};
  if (!rd && !process.env.RESOURCE_DECK && rs.resourceDeckSize) env.RESOURCE_DECK = String(rs.resourceDeckSize);
  if (!process.env.COMP && rs.firstPlayerCompensation) env.COMP = String(rs.firstPlayerCompensation);
  if (quick) {
    env.SKIP_ROLLOUT = '1';
    env.GPP_MATRIX = '200';
    env.RL_GPP = '0';
    env.RH_GPP = '0';
    env.RX_GPP = '0';
  } else {
    // rolloutMandatory (cardGate.rolloutMandatory) — SKIP_ROLLOUT is never set here.
    env.GPP_MATRIX = String(FOCUS_PRESET.GPP_MATRIX);
    env.RL_GPP = String(FOCUS_PRESET.RL_GPP);
    env.RH_GPP = String(FOCUS_PRESET.RH_GPP);
    env.RX_GPP = String(FOCUS_PRESET.RX_GPP);
  }
  if (rd) env.RESOURCE_DECK = String(rd);
  console.log(`\n══ STAGE B — ${quick ? 'quick heuristic pass (ADVISORY ONLY)' : 'simulation gate (rollout mandatory)'} ══`);
  const res = spawnSync('node', ['balance-verify.mjs'], { cwd: ENGINE_DIR, env, stdio: 'inherit' });
  if (res.status !== 0) { console.error('balance-card-gate: balance-verify.mjs exited non-zero'); process.exit(res.status ?? 1); }
  const result = JSON.parse(readFileSync(gaugeOut, 'utf8'));
  const entry = appendRun({ kind: 'card-gate', label, resultPath: gaugeOut, env: { FOCUS: faction, GPP_MATRIX: env.GPP_MATRIX, RESOURCE_DECK: env.RESOURCE_DECK, COMP: env.COMP, SKIP_ROLLOUT: env.SKIP_ROLLOUT }, preset: quick ? 'quick' : 'focus' });
  return { result, entry };
}

// Pool w/n from every 'agg' (rollout) pilot's marg[faction] — cardGate.marginalBand.
function pooledMarginal(pilots, faction) {
  let w = 0, n = 0;
  for (const p of pilots) if (p.kind === 'agg' && p.marg?.[faction]) { w += p.marg[faction].w; n += p.marg[faction].n; }
  return { w, n, wilson: wilson(w, n) };
}
// Normalize a matchupDetail cell to the focus faction's win side, regardless of fA/fB order.
function focusCell(detail, focus, opp) {
  const d = detail[`${focus}|${opp}`] || detail[`${opp}|${focus}`];
  if (!d) return null;
  const focusIsA = d.fA === focus;
  return { w: focusIsA ? d.wA : d.wB, n: d.wA + d.wB };
}
function pooledCell(pilots, focus, opp) {
  let w = 0, n = 0;
  for (const p of pilots) if (p.kind === 'agg' && p.matchupDetail) { const c = focusCell(p.matchupDetail, focus, opp); if (c) { w += c.w; n += c.n; } }
  return { w, n };
}

// ── Acceptance rules (sim-data/balance-targets.json → cardGate + thresholds) ─
function evaluateAcceptance(result, baselineArchive, faction) {
  const rules = [];
  const cand = pooledMarginal(result.pilots, faction);
  const candCi = wilson(cand.w, cand.n);
  const [lo, hi] = CG.marginalBand;
  const baseMarg = pooledMarginal(baselineArchive.pilots, faction);
  const baseCi = baseMarg.wilson;
  let margVerdict = 'PASS';
  if (candCi[0] > hi || candCi[2] < lo) margVerdict = 'FAIL'; // cardGate.marginalBand (CI clear of band)
  else if (candCi[1] > hi || candCi[1] < lo) margVerdict = 'FAIL'; // point estimate outside band
  else if (!overlap(candCi, baseCi)) {
    const movedUp = candCi[1] > baseCi[1] && candCi[1] > hi - (hi - lo) / 4;
    const movedDown = candCi[1] < baseCi[1] && candCi[1] < lo + (hi - lo) / 4;
    if (movedUp || movedDown) margVerdict = 'FAIL'; // moved outside baseline CI toward imbalance
  }
  rules.push({ rule: 'marginalBand', verdict: margVerdict, detail: `${faction} ${pct(candCi[1])} [${pct(candCi[0])}–${pct(candCi[2])}] vs baseline ${pct(baseCi[1])} [${pct(baseCi[0])}–${pct(baseCi[2])}], band [${lo}-${hi}]` });

  // maxCellWinPct — every FOCUS-involving cell, pooled across rollout rungs.
  for (const opp of FACTIONS) {
    const c = pooledCell(result.pilots, faction, opp);
    if (c.n < CG.minCellGames) continue;
    const wp = (100 * c.w) / c.n;
    const beyond = wp > CG.maxCellWinPct || wp < 100 - CG.maxCellWinPct;
    let verdict = beyond ? 'FAIL' : 'PASS';
    if (beyond) {
      const baseCell = findBaselineCell(baselineArchive, faction, opp);
      if (baseCell && baseCell.n >= CG.minCellGames) {
        const baseWp = (100 * baseCell.w) / baseCell.n;
        const baseBeyond = baseWp > CG.maxCellWinPct || baseWp < 100 - CG.maxCellWinPct;
        const candCellCi = wilson(c.w, c.n), baseCellCi = wilson(baseCell.w, baseCell.n);
        if (baseBeyond && overlap(candCellCi, baseCellCi)) verdict = 'PASS'; // already-extreme cell, not worse beyond CI noise
      }
    }
    rules.push({ rule: 'maxCellWinPct', verdict, detail: `${faction} vs ${opp}: ${pct(wp)} (n=${c.n})` });
  }

  // decided% / mirror FP — graded per thresholds (FLAG tolerated, FAIL fails gate).
  const agg = result.pilots.filter((p) => p.kind === 'agg');
  if (agg.length) {
    const games = agg.reduce((s, p) => s + p.games, 0);
    const decided = agg.reduce((s, p) => s + (p.decidedPct / 100) * p.games, 0);
    const decidedPct = 100 * decided / games;
    rules.push({ rule: 'decidedPct', verdict: decidedPct < T.decidedPct.failBelow ? 'FAIL' : decidedPct < T.decidedPct.flagBelow ? 'FLAG' : 'PASS', detail: pct(decidedPct) });
    const mirror = agg.find((p) => Number.isFinite(p.mirrorFp));
    if (mirror) {
      const edge = Math.abs(mirror.mirrorFp - 50);
      rules.push({ rule: 'mirrorFp', verdict: edge > T.mirrorFpEdgePp.failAbove ? 'FAIL' : edge > T.mirrorFpEdgePp.flagAbove ? 'FLAG' : 'PASS', detail: `${pct(mirror.mirrorFp - 50)} over 50%` });
    }
  }

  // spread — LIKE-to-LIKE: candidate's focus-involving cells vs the baseline
  // panel's SAME cells (never vs the baseline's full-panel spread — see the
  // FOCUS-mode comment in balance-verify.mjs). Replaces the old fixed-6pp
  // margin with a real test: per cell, a two-proportion z-test (candidate vs
  // baseline, pooled variance) decides SIGNIFICANCE; the sign of the shift vs
  // that cell's own 50%-skew decides whether it's ADVERSE (pushes the cell
  // further from 50%, which is what widens max-min spread). FAILs only when
  // BOTH hold: candidate's spread exceeds baseline's, AND at least one cell
  // moved significantly (|z|>1.96 ~ p<0.05, two-tailed) in that adverse direction.
  const cells = [];
  for (const opp of FACTIONS) {
    const c = pooledCell(result.pilots, faction, opp);
    const b = findBaselineCell(baselineArchive, faction, opp);
    if (c.n < CG.minCellGames || !b || b.n < CG.minCellGames) continue;
    cells.push({ opp, cWp: (100 * c.w) / c.n, bWp: (100 * b.w) / b.n, c, b });
  }
  if (cells.length >= 2) {
    const candSpread = Math.max(...cells.map((x) => x.cWp)) - Math.min(...cells.map((x) => x.cWp));
    const baseSpread = Math.max(...cells.map((x) => x.bWp)) - Math.min(...cells.map((x) => x.bWp));
    const sigAdverse = cells.filter((x) => {
      const z = twoPropZ(x.c.w, x.c.n, x.b.w, x.b.n);
      const delta = x.cWp - x.bWp;
      const widensSpread = (x.bWp >= 50 && delta > 0) || (x.bWp < 50 && delta < 0);
      return Math.abs(z) > 1.96 && widensSpread;
    });
    const cellName = (x) => (x.opp === faction ? `${faction} mirror` : `${faction} v ${x.opp}`);
    const verdict = candSpread > baseSpread && sigAdverse.length > 0 ? 'FAIL' : 'PASS';
    rules.push({
      rule: 'spreadRegression', verdict,
      detail: `candidate ${pct(candSpread)} vs baseline ${pct(baseSpread)} (cells: ${cells.map(cellName).join(', ')}); significant adverse cells: ${sigAdverse.length ? sigAdverse.map(cellName).join(', ') : 'none'}`,
    });
  }

  return rules;
}
function findBaselineCell(archive, focus, opp) {
  // Prefer the baseline's rollout (agg) pilots pooled the same way as the
  // candidate; fall back to a matrix pilot's full matrix (baseline panels are
  // non-focus, so every cell is populated there).
  const agg = archive.pilots.filter((p) => p.kind === 'agg');
  if (agg.length) { const c = pooledCell(archive.pilots, focus, opp); if (c.n) return c; }
  for (const p of archive.pilots) {
    if (p.kind !== 'matrix') continue;
    const cell = p.matrix?.[focus]?.[opp];
    if (cell && cell.w !== undefined) return cell;
    // Reversed orientation: w is opp's wins over focus — flip before consuming.
    const rev = p.matrix?.[opp]?.[focus];
    if (rev && rev.w !== undefined) return { w: rev.n - rev.w, n: rev.n };
  }
  return null;
}

// ── main ─────────────────────────────────────────────────────────────────
const args = parseArgs(process.argv.slice(2));
if (!args._[0] || !args.faction) {
  console.error('Usage: node balance-card-gate.mjs <candidate-pool.json> --faction <Onyx|Radiant|Sapphire|Verdant> [--quick] [--rd <n>] [--baseline <ledger-id>|latest]');
  process.exit(1);
}
if (!FACTIONS.includes(args.faction)) { console.error(`--faction must be one of: ${FACTIONS.join(', ')}`); process.exit(1); }

const candidatePoolPath = path.resolve(process.cwd(), args._[0]);
if (!existsSync(candidatePoolPath)) { console.error(`candidate pool not found: ${candidatePoolPath}`); process.exit(1); }
const candidateRaw = JSON.parse(readFileSync(candidatePoolPath, 'utf8'));

const baselineEntry = resolveBaseline(args.baseline);
const baselinePool = loadBaselinePool(baselineEntry);
const diff = diffPools(baselinePool, candidateRaw);
checkFactionContainment(diff, args.faction);

const staticGate = runStaticGate(candidateRaw, candidatePoolPath, diff);
printStaticTable(diff, staticGate);
if (staticGate.hardFail) {
  console.log('\n══ VERDICT: FAIL (static) ══');
  process.exit(2);
}
// A byte-identical no-op cannot regress anything; simulating it would only
// compare fresh seeds against the stored baseline and can false-FAIL on noise.
if (!diff.changed.length && !diff.added.length && !diff.removed.length) {
  console.log('\n══ VERDICT: PASS (no-op pool, Stage B skipped) ══');
  process.exit(0);
}

if (args.quick) {
  const { result } = runSimStage({ candidatePoolPath, faction: args.faction, quick: true, rd: args.rd, label: `gate-quick-${args.faction}`, baseline: baselineEntry });
  console.log(`\nADVISORY ONLY — static+quick sim, NOT a PASS (exit 10; only a graded run exits 0). (games=${result.pilots.reduce((s, p) => s + p.games, 0)})`);
  process.exit(10); // distinct advisory code: scripts must not read --quick as gate-PASS
}

const { result, entry } = runSimStage({ candidatePoolPath, faction: args.faction, quick: false, rd: args.rd, label: `gate-${args.faction}`, baseline: baselineEntry });
const baselineArchive = loadArchive(baselineEntry);
const rules = evaluateAcceptance(result, baselineArchive, args.faction);

console.log(`\n══ STAGE B ACCEPTANCE RULES (vs baseline ${baselineEntry.id}) ══`);
for (const r of rules) console.log(`  ${r.verdict.padEnd(4)} ${r.rule.padEnd(18)} ${r.detail}`);
const fail = rules.some((r) => r.verdict === 'FAIL');
console.log(`\n══ VERDICT: ${fail ? 'FAIL' : 'PASS'} ══  (ledger: ${entry.id})`);
process.exit(fail ? 3 : 0);

// balance-ledger.mjs — durable run history for balance-verify.mjs output.
//
// Every invocation of the verify harness writes ONE result JSON (GAUGE_OUT).
// This module folds that into two things: a full copy under
// balance-runs/runs/<id>.json (gitignored — reproducible, not source of truth)
// and one compact, TRACKED line in balance-runs/ledger.jsonl (the run history:
// what was run, on which pool, against which git rev, with what headline
// numbers). ledger.jsonl is append-only — never edit past lines by hand.
import { readFileSync, writeFileSync, appendFileSync, copyFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENGINE_DIR = fileURLToPath(new URL('.', import.meta.url));
const RUNS_DIR = `${ENGINE_DIR}balance-runs/runs/`;
const LEDGER_PATH = `${ENGINE_DIR}balance-runs/ledger.jsonl`;

const pad2 = (n) => String(n).padStart(2, '0');
function localDateStamp(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function gitRev() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ENGINE_DIR, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

/** Reduce a pilot's full marginals to the ledger headline: wilson-mid per faction. */
function headlinePilot(p) {
  const marg = {};
  for (const [f, m] of Object.entries(p.marg || {})) marg[f] = m.wilson ? m.wilson[1] : null;
  return {
    label: p.label,
    spread: p.spread,
    mirrorFp: p.mirrorFp,
    decidedPct: p.decidedPct,
    games: p.games,
    runHash: p.runHash ?? null,
    marg,
  };
}

/**
 * Fold a balance-verify.mjs result (written to GAUGE_OUT=resultPath) into the
 * ledger: append one compact JSON line to ledger.jsonl and archive the full
 * result under balance-runs/runs/<id>.json. Returns the appended entry.
 */
export function appendRun({ kind, label, resultPath, env, preset }) {
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  const poolSha8 = result.pool.sha256_16.slice(0, 8);
  const date = new Date();
  const safeLabel = String(label).replace(/[^A-Za-z0-9._-]+/g, '-');
  const id = `${localDateStamp(date)}_${kind}_${poolSha8}_${safeLabel}`;

  mkdirSync(RUNS_DIR, { recursive: true });
  const archivePath = `${RUNS_DIR}${id}.json`;
  if (resultPath !== archivePath) {
    try {
      copyFileSync(resultPath, archivePath);
      if (existsSync(resultPath)) unlinkSync(resultPath);
    } catch (err) {
      console.error(`balance-ledger: failed to archive result — left in place at ${resultPath}`, err);
    }
  }

  const entry = {
    id,
    date: date.toISOString(),
    gitRev: gitRev(),
    kind,
    label,
    preset: preset ?? null,
    pool: result.pool,
    focus: result.focus,
    env: Object.fromEntries(Object.entries(env || {}).filter(([, v]) => v !== undefined && v !== '')),
    config: result.config,
    ...(result.ruleset !== undefined ? { ruleset: result.ruleset } : {}),
    ...(result.ruleOff !== undefined ? { ruleOff: result.ruleOff } : {}),
    pilots: (result.pilots || []).map(headlinePilot),
  };

  if (!existsSync(LEDGER_PATH)) writeFileSync(LEDGER_PATH, '');
  appendFileSync(LEDGER_PATH, `${JSON.stringify(entry)}\n`);
  return entry;
}

function parseLedgerLines() {
  if (!existsSync(LEDGER_PATH)) return [];
  const lines = readFileSync(LEDGER_PATH, 'utf8').split('\n').filter((l) => l.trim());
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      console.warn(`balance-ledger: skipping malformed ledger line: ${line.slice(0, 80)}…`);
    }
  }
  return entries;
}

/**
 * Last ledger entry with kind 'verify', no focus, and full panel size (not a
 * smoke-sized run) — the reference baseline. "Full panel size" means the
 * preset is 'verdict' or 'full', or (for older/unlabeled entries) the
 * per-cell game count (GPP_MATRIX) is at least 1000.
 */
export function latestBaseline() {
  const entries = parseLedgerLines();
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind !== 'verify' || e.focus) continue;
    const isFullPreset = e.preset === 'verdict' || e.preset === 'full';
    const isFullGpp = (e.config?.GPP_MATRIX ?? 0) >= 1000;
    if (isFullPreset || isFullGpp) return e;
  }
  return null;
}

/** Last n ledger entries, oldest first. */
export function readLedger(n = 10) {
  const entries = parseLedgerLines();
  return entries.slice(-n);
}

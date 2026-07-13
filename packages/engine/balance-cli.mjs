// balance-cli.mjs — thin dispatcher over the balance harness scripts.
//
// Wraps balance-verify.mjs (env-var driven) with named presets from
// sim-data/balance-targets.json, and folds successful runs into the ledger
// (balance-ledger.mjs) so every measured run is discoverable later without
// re-simulating. Everything else (audit, hero-audit, pools) is a passthrough
// spawn — no ledger entry, those tools own their own output.
//
// Usage: node balance-cli.mjs <cmd> [flags]   (see usage() below)
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { appendRun, readLedger } from './balance-ledger.mjs';

const ENGINE_DIR = fileURLToPath(new URL('.', import.meta.url));
const RUNS_DIR = `${ENGINE_DIR}balance-runs/runs/`;
const TARGETS_PATH = new URL('./sim-data/balance-targets.json', import.meta.url);

function usage() {
  console.log(`Usage: node balance-cli.mjs <cmd> [flags]

  verify --preset <smoke|focus|ablation|verdict|full> [--label <s>] [--rd <n>]
         [--pool <path>] [--focus <Faction>] [--env KEY=VAL ...]
         Run balance-verify.mjs with a named preset; ledger the result.
  smoke  Alias for: verify --preset smoke --label smoke
  focus --faction <Faction> [--preset <p>] [--label <s>] [--rd <n>] [--pool <path>]
         Alias for verify with FOCUS set (kind 'focus').
  audit [args...]       Passthrough to balance-card-audit.mjs (no ledger entry)
  hero-audit [args...]  Passthrough to balance-hero-audit.mjs (no ledger entry)
  pools [args...]       Passthrough to make-pools.mjs (no ledger entry)
  ledger [--n 10]       Print the last n ledger entries
  card <pool.json> --faction <Faction> [--quick] [--rd <n>] [--baseline <id>]
         Passthrough to balance-card-gate.mjs (the pre-adoption pool gate).
         Exit codes: 0 graded PASS · 2 static FAIL · 3 sim FAIL · 10 --quick advisory (never a PASS).
  deck-panel --set <deck-set.json> (--vs-starters | --field <deckKey,...> | --pairs <file>)
         [--gpp <n>] [--rung <8|12>] [--label <s>] [--out <path>]
         Passthrough to balance-deck-panel.mjs (per-DECK panel + card-usage instrument).`);
}

function parseFlags(args) {
  const out = { env: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--preset') out.preset = args[++i];
    else if (a === '--label') out.label = args[++i];
    else if (a === '--rd') out.rd = args[++i];
    else if (a === '--pool') out.pool = args[++i];
    else if (a === '--focus' || a === '--faction') out.focus = args[++i];
    else if (a === '--env') out.env.push(args[++i]);
    else if (a === '--n') out.n = args[++i];
    else console.warn(`balance-cli: ignoring unknown flag ${a}`);
  }
  return out;
}

function spawnPass(script, args) {
  const res = spawnSync('node', [script, ...args], { cwd: ENGINE_DIR, stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

async function runVerify(flags, { kindOverride } = {}) {
  if (!flags.preset) {
    console.error('verify requires --preset <smoke|focus|ablation|verdict|full>');
    process.exit(1);
  }
  const presets = JSON.parse(readFileSync(TARGETS_PATH, 'utf8')).presets;
  const presetEnv = presets[flags.preset];
  if (!presetEnv) {
    console.error(`unknown preset "${flags.preset}" — choices: ${Object.keys(presets).join(', ')}`);
    process.exit(1);
  }
  const focus = flags.focus || '';
  const label = flags.label || (focus ? `focus-${focus}` : flags.preset);
  const kind = kindOverride || (focus ? 'focus' : 'verify');

  mkdirSync(RUNS_DIR, { recursive: true });
  const gaugeOut = `${RUNS_DIR}tmp-${Date.now()}.json`;

  const env = { ...process.env }; // WORKERS (and everything else) passes through untouched
  for (const [k, v] of Object.entries(presetEnv)) env[k] = String(v);
  if (flags.rd) env.RESOURCE_DECK = flags.rd;
  if (flags.pool) env.AETHERION_CARDS = path.resolve(process.cwd(), flags.pool);
  if (focus) env.FOCUS = focus;
  for (const kv of flags.env) {
    const eq = kv.indexOf('=');
    if (eq < 0) continue;
    env[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  env.GAUGE_OUT = gaugeOut;

  const res = spawnSync('node', ['balance-verify.mjs'], { cwd: ENGINE_DIR, env, stdio: 'inherit' });
  if (res.status !== 0) process.exit(res.status ?? 1);

  const KNOBS = ['GPP_MATRIX', 'RL_GPP', 'RH_GPP', 'RX_GPP', 'SKIP_ROLLOUT', 'FOCUS', 'RESOURCE_DECK', 'AETHERION_CARDS', 'WORKERS', 'HEUR_RAMP', 'RULE_OFF', 'COMP'];
  const knobEnv = Object.fromEntries(KNOBS.map((k) => [k, env[k]]).filter(([, v]) => v !== undefined));

  const entry = appendRun({ kind, label, resultPath: gaugeOut, env: knobEnv, preset: flags.preset });
  console.log(`\nLedger: ${entry.id}`);
  for (const p of entry.pilots) {
    console.log(`  ${p.label.padEnd(24)} spread ${p.spread?.toFixed(1)}pp  mirrorFp ${p.mirrorFp?.toFixed(1)}%  decided ${p.decidedPct?.toFixed(1)}%  n=${p.games}`);
  }
  return entry;
}

function printLedger(n) {
  const entries = readLedger(n);
  if (!entries.length) {
    console.log("ledger is empty — run 'node balance-cli.mjs smoke' to create the first entry.");
    return;
  }
  for (const e of entries) {
    const poolSha8 = e.pool.sha256_16.slice(0, 8);
    const pilots = e.pilots.map((p) => `${p.label}:spread ${p.spread?.toFixed(1)}pp/fp ${p.mirrorFp?.toFixed(1)}%`).join('  ');
    console.log(`${e.id}  [${e.kind}]  pool ${poolSha8}  ${pilots}`);
  }
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case 'verify':
    await runVerify(parseFlags(rest));
    break;
  case 'smoke': {
    const flags = parseFlags(rest);
    await runVerify({ ...flags, preset: 'smoke', label: flags.label || 'smoke' });
    break;
  }
  case 'focus': {
    const flags = parseFlags(rest);
    if (!flags.focus) {
      console.error('focus requires --faction <Onyx|Radiant|Sapphire|Verdant>');
      process.exit(1);
    }
    await runVerify({ ...flags, preset: flags.preset || 'focus' }, { kindOverride: 'focus' });
    break;
  }
  case 'audit':
    spawnPass('balance-card-audit.mjs', rest);
    break;
  case 'hero-audit':
    spawnPass('balance-hero-audit.mjs', rest);
    break;
  case 'pools':
    spawnPass('make-pools.mjs', rest);
    break;
  case 'ledger':
    printLedger(+(parseFlags(rest).n || 10));
    break;
  case 'card':
    spawnPass('balance-card-gate.mjs', rest);
    break;
  case 'deck-panel':
    spawnPass('balance-deck-panel.mjs', rest);
    break;
  default:
    usage();
    process.exit(cmd ? 1 : 0);
}

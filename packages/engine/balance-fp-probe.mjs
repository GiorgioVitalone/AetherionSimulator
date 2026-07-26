// balance-fp-probe.mjs — mirror-only first-player probe (rule-lock Step 1).
//
// Measures the mirror first-player edge under one condition with enough games to
// grade against the ≤+3pp target (sim-data/balance-targets.json mirrorFpEdgePp).
// Mirrors are the clean FP control: both seats run identical decks and pilot, so
// any decided-game asymmetry is seat order. 4 factions × GPP games ≈ 4·GPP mirror
// games → pooled CI ~±1.5pp at GPP=1000.
//
// Env knobs:
//   ROLLOUTS=4|8|12   rollout rung (r4 d2 c5 / r8 d3 c8 / r12 d3 c8); default 8
//   GPP=1000          games per mirror pairing
//   RESOURCE_DECK=<n> resource-deck size rule under test (unset = 15)
//   TAPCHOICE=0       disable reserveTapChoice (E3 mechanism split)
//   COMP=card|resource|both|play_or_draw   firstPlayerCompensation under test (Step 2 sweep)
//   FP_VARIANT=resource_skip   §13r candidate variant: firstPlayerSkipsFirstResource +
//                              firstPlayerDrawsNormally. Competing lever vs COMP — the
//                              two are mutually exclusive; setting both is an error.
//   AETHERION_CARDS, GAUGE_OUT, WORKERS as in balance-verify.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { createHash } from 'node:crypto';
import { runSim } from './sim-runner.mjs';
import { runSimParallel } from './sim-parallel.mjs';
import { CURRENT_GAME_CONFIG } from './dist/index.js';

const POOL_PATH = process.env.AETHERION_CARDS || new URL('./sim-data/aetherion-cards.json', import.meta.url);
const POOL_SHA = createHash('sha256')
  .update(JSON.stringify(JSON.parse(readFileSync(POOL_PATH, 'utf8'))))
  .digest('hex')
  .slice(0, 16);
const T = JSON.parse(readFileSync(new URL('./sim-data/balance-targets.json', import.meta.url), 'utf8'));

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map(f => [f, f]));

const GPP = +(process.env.GPP || 1000);
const ROLLOUTS = +(process.env.ROLLOUTS || 8);
const RUNG = { 4: { rollouts: 4, rolloutDepth: 2, maxCandidates: 5 }, 8: { rollouts: 8, rolloutDepth: 3, maxCandidates: 8 }, 12: { rollouts: 12, rolloutDepth: 3, maxCandidates: 8 } }[ROLLOUTS];
if (!RUNG) { console.error('ROLLOUTS must be 4, 8 or 12'); process.exit(1); }
const TAPCHOICE_OFF = process.env.TAPCHOICE === '0';
const FP_VARIANT = process.env.FP_VARIANT || null;
if (FP_VARIANT && FP_VARIANT !== 'resource_skip') { console.error('FP_VARIANT must be "resource_skip"'); process.exit(1); }
if (FP_VARIANT && process.env.COMP) { console.error('FP_VARIANT and COMP are competing first-player-compensation levers — set only one'); process.exit(1); }
const OUT = process.env.GAUGE_OUT || '/tmp/balance-fp-probe-result.json';
// Default capped at 8 (~1 GB/worker under sim-parallel's heap cap keeps a 64 GB
// desktop responsive); WORKERS env overrides for beefier machines.
const WORKERS = +(process.env.WORKERS || Math.min(availableParallelism(), 8));
const run = (cfg) => (WORKERS > 1 ? runSimParallel(cfg, WORKERS) : Promise.resolve(runSim(cfg)));

// Same standard ruleset as balance-verify.mjs BASE, sourced from the same
// locked manifest; firstPlayer alternating is what makes the mirror split a
// clean seat read.
const BASE = {
  rulesProfile: 'current',
  firstPlayer: 'alternating',
  termination: 'tiebreak',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 12345,
  // §13q seat-asymmetry fix (2026-07-10) — see balance-verify.mjs BASE.
  seatAlternation: true,
};

// Env overrides (RESOURCE_DECK, COMP, TAPCHOICE, FP_VARIANT) are EXPERIMENT
// deviations from the locked manifest — loudly banner + record any that
// actually change an effective rule value away from the manifest's.
const ruleOverrides = [];
function override(key, effectiveValue) {
  const manifestValue = CURRENT_GAME_CONFIG[key] ?? null;
  if (manifestValue !== effectiveValue) {
    console.log(`RULE OVERRIDE (experiment): ${key} ${JSON.stringify(manifestValue)} -> ${JSON.stringify(effectiveValue)} — not the locked ruleset`);
    ruleOverrides.push({ rule: key, manifestValue, effectiveValue });
    if (BASE.rulesProfile === 'current') {
      BASE.rulesProfile = 'custom-diagnostic';
      Object.assign(BASE, CURRENT_GAME_CONFIG);
    }
  }
  BASE[key] = effectiveValue;
}
if (TAPCHOICE_OFF) override('reserveTapChoice', false);
if (process.env.RESOURCE_DECK) override('resourceDeckSize', Number(process.env.RESOURCE_DECK));
if (FP_VARIANT === 'resource_skip') {
  // Not a manifest key at all — new levers under test, so always an override.
  override('firstPlayerSkipsFirstResource', true);
  override('firstPlayerDrawsNormally', true);
} else if (process.env.COMP) {
  override('firstPlayerCompensation', process.env.COMP);
}

function wilson(w, n, z = 1.96) {
  if (n <= 0) return [0, 0, 0];
  const p = w / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z / d) * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [100 * (c - h), 100 * p, 100 * (c + h)];
}

const label = `mirror-fp r${ROLLOUTS} rd${BASE.resourceDeckSize ?? 15}${TAPCHOICE_OFF ? ' tapchoice-off' : ''}${BASE.firstPlayerCompensation ? ` comp-${BASE.firstPlayerCompensation}` : ''}${FP_VARIANT ? ` variant-${FP_VARIANT}` : ''}`;
console.log(`Condition: ${label}  GPP=${GPP}  pool ${POOL_SHA}  workers ${WORKERS}`);

const r = await run({
  ...BASE,
  botPolicy: 'rollout',
  ...RUNG,
  decks: realDecks,
  matchups: FACTIONS.map(f => ({ p0Deck: f, p1Deck: f })),
  gamesPerPairing: GPP,
});

// Per-mirror-cell fp split from matchupDetail; decided n = wA + wB (seat wins).
let fpW = 0, fpN = 0;
const perFaction = {};
for (const d of Object.values(r.matchupDetail || {})) {
  const n = d.wA + d.wB;
  const w = Math.round((d.firstPlayerWinPct / 100) * n);
  perFaction[d.fA] = { fpPct: d.firstPlayerWinPct, n };
  fpW += w; fpN += n;
}
const [lo, mid, hi] = wilson(fpW, fpN);
const edge = { lo: lo - 50, mid: mid - 50, hi: hi - 50 };
const th = T.thresholds.mirrorFpEdgePp;
const verdict = Math.abs(edge.mid) > th.failAbove ? 'FAIL' : Math.abs(edge.mid) > th.flagAbove ? 'FLAG' : 'PASS';

console.log(`\nPer-mirror fp-win%:`);
for (const f of FACTIONS) console.log(`  ${f.padEnd(9)} ${perFaction[f] ? `${perFaction[f].fpPct.toFixed(1)}% (n=${perFaction[f].n})` : 'n/a'}`);
console.log(`\nPooled mirror FP edge: ${edge.mid.toFixed(2)}pp over 50 [${edge.lo.toFixed(2)} … ${edge.hi.toFixed(2)}]  (${fpW}/${fpN})`);
console.log(`Verdict vs ≤+${th.flagAbove}pp target: ${verdict}  (decided ${r.decidedPct.toFixed(1)}%, avgTurns ${r.gameLength.avg.toFixed(1)}, runHash ${r.runHash})`);

writeFileSync(OUT, JSON.stringify({
  generatedFrom: 'balance-fp-probe.mjs',
  pool: { path: String(POOL_PATH), sha256_16: POOL_SHA },
  focus: null,
  config: { GPP, ROLLOUTS, resourceDeckSize: BASE.resourceDeckSize ?? 15, tapChoiceOff: TAPCHOICE_OFF, comp: BASE.firstPlayerCompensation ?? 'none', fpVariant: FP_VARIANT ?? 'none' },
  ruleset: BASE,
  ruleOverrides,
  pilots: [{
    label, kind: 'agg',
    marg: Object.fromEntries(FACTIONS.map(f => [f, { w: 0, n: perFaction[f]?.n ?? 0, wilson: [0, perFaction[f]?.fpPct ?? 0, 0] }])),
    spread: 0,
    mirrorFp: mid, mirrorFpEdge: edge, fpWins: fpW, fpDecided: fpN, perFaction,
    decidedPct: r.decidedPct, timeoutPct: r.timeoutPct, avgTurns: r.gameLength.avg,
    games: r.games, runHash: r.runHash, verdict,
  }],
}, null, 2));
console.log(`\nJSON → ${OUT}`);

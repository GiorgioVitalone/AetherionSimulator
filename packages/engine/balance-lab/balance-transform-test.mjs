// balance-transform-test.mjs — test two workshopped changes against the §8 pacing
// diagnosis, under the trustworthy fairPilot mode:
//   A: transform unlocked when the Resource Deck is empty at Upkeep (before the draw)
//      — the engine's resource_deck_empty_transform mode (now corrected to before-draw).
//   B: lower the Resource Deck 15 -> 10 cards, keeping that transform rule.
// 4-config matrix isolates the two effects (transform payoff vs resource cap). Reports
// faction win%, the top(Radiant+Verdant)-vs-floor(Onyx+Sapphire) gap, avgTurns, and the
// transform RATE (fraction of heroes that transformed — must be > 0 or the mechanic is
// silently inert). Env: PILOT (heuristic|rollout), GPP, RDEPTH (rollout horizon), TURNCAP.
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';
import { getDeck } from '../deck-loader.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const PROACTIVE = ['Radiant', 'Verdant'];
const REACTIVE = ['Onyx', 'Sapphire'];
const PILOT = process.env.PILOT || 'heuristic';
const GPP = +(process.env.GPP || (PILOT === 'rollout' ? 12 : 400));
const RDEPTH = +(process.env.RDEPTH || 3);
const TURNCAP = +(process.env.TURNCAP || 80);
const OUT = process.env.OUT || '/tmp/balance-transform-result.json';

// Real starter decks, optionally with the Resource Deck sliced to N cards (Scenario B).
function decksN(n) {
  return Object.fromEntries(
    FACTIONS.map((f) => {
      const d = getDeck(f);
      return [f, { heroDefId: d.heroDefId, mainDeckDefIds: d.mainDeckDefIds, resourceDeckDefIds: d.resourceDeckDefIds.slice(0, n), faction: f }];
    }),
  );
}

const pilotCfg = PILOT === 'rollout'
  ? { botPolicy: 'rollout', rollouts: 4, maxCandidates: 5, rolloutDepth: RDEPTH }
  : { botPolicy: 'heuristic' };
const BASE = {
  rulesProfile: 'custom-diagnostic',
  matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true, termination: 'tiebreak',
  abilitiesOn: true, turnCap: TURNCAP, seedBase: 12345, fairPilot: true, gamesPerPairing: GPP, ...pilotCfg,
};

const CONFIGS = [
  ['baseline (15, turn_cap)', { decks: decksN(15), terminationMode: 'turn_cap' }],
  ['A: 15 + empty-transform', { decks: decksN(15), terminationMode: 'resource_deck_empty_transform' }],
  ['B-ctrl: 10, turn_cap', { decks: decksN(10), terminationMode: 'turn_cap' }],
  ['B: 10 + empty-transform', { decks: decksN(10), terminationMode: 'resource_deck_empty_transform' }],
];

// Read-only transform-incidence collector via the runner's __diag side-channel. begin()
// returns a valid DiagCounters (the engine writes combat tallies in; we ignore them);
// onGame counts heroes that ended transformed.
function transformCollector() {
  let games = 0, transforms = 0;
  return {
    diag: {
      begin: () => ({ shieldFires: [0, 0], shieldPrevented: [0, 0], armAbsorbedBase: [0, 0], armAbsorbedBulwark: [0, 0] }),
      onGame: (fin) => { games++; if (fin.players[0].hero.transformed) transforms++; if (fin.players[1].hero.transformed) transforms++; },
    },
    rate: () => (games ? (100 * transforms) / (games * 2) : 0),
  };
}

const pct = (x) => x.toFixed(1);
const avg = (wp, fs) => fs.reduce((s, f) => s + (wp[f] ?? 0), 0) / fs.length;
console.log(`Transform / resource-deck test — ${PILOT} + fairPilot, real decks, all-pairs, GPP=${GPP}${PILOT === 'rollout' ? ` depth=${RDEPTH}` : ''}`);
console.log(`  ${'config'.padEnd(26)}${FACTIONS.map((f) => f.slice(0, 4).padStart(7)).join('')}   top floor  gap  turns xform%`);
const results = [];
for (const [label, delta] of CONFIGS) {
  const c = transformCollector();
  const s = Date.now();
  const r = runSim({ ...BASE, ...delta, __diag: c.diag });
  const wp = Object.fromEntries(FACTIONS.map((f) => [f, r.factionWinPct[f] ?? 0]));
  const top = avg(wp, PROACTIVE), floor = avg(wp, REACTIVE), xform = c.rate();
  console.log(
    `  ${label.padEnd(26)}${FACTIONS.map((f) => pct(wp[f]).padStart(7)).join('')}   ` +
      `${pct(top).padStart(4)} ${pct(floor).padStart(5)} ${pct(top - floor).padStart(4)} ${r.gameLength.avg.toFixed(0).padStart(5)} ${pct(xform).padStart(5)}  (${((Date.now() - s) / 1000).toFixed(0)}s)`,
  );
  results.push({ label, faction: wp, spread: r.paritySpread, top, floor, gap: top - floor, avgTurns: r.gameLength.avg, transformPct: xform });
}
writeFileSync(OUT, JSON.stringify({ PILOT, GPP, results }, null, 1));
console.log(`\n(top = Radiant+Verdant; floor = Onyx+Sapphire; xform% = heroes that transformed. A − baseline = transform@15;`);
console.log(` B-ctrl − baseline = resource-cap@10; B − B-ctrl = transform once it procs in time; B − baseline = combined.)`);
console.log(`Wrote ${OUT}`);

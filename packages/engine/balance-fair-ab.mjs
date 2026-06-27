// balance-fair-ab.mjs — A/B the opt-in fairPilot mode (Step 0 validation).
// Runs the real starter decks OFF vs ON for both the heuristic and the rollout pilot
// (all-pairs incl. mirrors, alternating first player, deterministic) and prints the
// faction win% + parity spread + ranking for each, so we can see whether fixing the
// measurement (a) lifts the under-piloted control/value factions (Sapphire/Onyx),
// (b) converges the heuristic and rollout rankings, and (c) leaves the Radiant+Verdant
// top tier intact. Env: HGPP (heuristic games/cell), RGPP (rollout games/cell).
import { runSim } from './sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const HGPP = +(process.env.HGPP || 400);
const RGPP = +(process.env.RGPP || 10);
const BASE = {
  decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating',
  fixHandSizeStall: true, termination: 'tiebreak', abilitiesOn: true, turnCap: +(process.env.TURNCAP || 80), seedBase: 12345,
};
const pct = (x) => x.toFixed(1);

function run(label, cfg) {
  const s = Date.now();
  const r = runSim(cfg);
  const ms = Date.now() - s;
  const wp = Object.fromEntries(FACTIONS.map((f) => [f, r.factionWinPct[f] ?? 0]));
  const rank = [...FACTIONS].sort((a, b) => wp[b] - wp[a]).join(' > ');
  console.log(
    `  ${label.padEnd(16)}` +
      FACTIONS.map((f) => pct(wp[f]).padStart(7)).join('') +
      `   spread ${pct(r.paritySpread).padStart(5)}  decided ${pct(r.decidedPct)}%  (${(ms / 1000).toFixed(0)}s)`,
  );
  console.log(`  ${''.padEnd(16)}rank: ${rank}`);
  return { label, wp, spread: r.paritySpread };
}

console.log(`fairPilot A/B — real decks, all-pairs, alternating FP. HGPP=${HGPP} RGPP=${RGPP}`);
console.log(`  ${'config'.padEnd(16)}${FACTIONS.map((f) => f.slice(0, 4).padStart(7)).join('')}   spread`);

if (!process.env.SKIP_HEURISTIC) {
  console.log('\n— Heuristic —');
  run('heuristic OFF', { ...BASE, botPolicy: 'heuristic', gamesPerPairing: HGPP });
  run('heuristic ON', { ...BASE, botPolicy: 'heuristic', gamesPerPairing: HGPP, fairPilot: true });
}

if (!process.env.SKIP_ROLLOUT) {
  // RDEPTH (optional): pin the rollout horizon for BOTH off/on to keep the A/B fast
  // (else ON takes the fair depth-0 roll-to-end default, which is much slower).
  const depthPin = process.env.RDEPTH ? { rolloutDepth: +process.env.RDEPTH } : {};
  console.log(`\n— Rollout (r4, c5; ${process.env.RDEPTH ? `depth pinned ${process.env.RDEPTH}` : 'ON uses fair depth-0 roll-to-end'}) —`);
  const rollout = { ...BASE, botPolicy: 'rollout', rollouts: 4, maxCandidates: 5, gamesPerPairing: RGPP, ...depthPin };
  run('rollout OFF', rollout);
  run('rollout ON', { ...rollout, fairPilot: true });
}

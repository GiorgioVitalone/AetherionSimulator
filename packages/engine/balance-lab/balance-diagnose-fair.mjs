// balance-diagnose-fair.mjs — causal decomposition of the spread under the TRUSTWORTHY
// pilot (fair rollout: outcome-driven + threat-aware counters). Pins rolloutDepth=3 for
// tractability (depth-0 is ~34s/game); the fair scoring + counters are still on, so the
// top tier (Radiant/Verdant — proactive decks the rollout pilots fine at depth 3) is
// decomposed faithfully. Each lever neutralizes one driver; the move in each faction's
// win% vs baseline is that driver's causal contribution. Env: GPP (games/cell).
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const realDecks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 14);
const OUT = process.env.OUT || '/tmp/balance-diagnose-fair-result.json';
const RAD2 = [45, 46, 47, 48, 49, 51, 53, 54]; // Radiant characters costing >= 2
const BASE = {
  rulesProfile: 'custom-diagnostic',
  decks: realDecks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', abilitiesOn: true, turnCap: 80, seedBase: 12345,
  botPolicy: 'rollout', rollouts: 4, maxCandidates: 5, rolloutDepth: 3, fairPilot: true, gamesPerPairing: GPP,
};

const ABLATIONS = [
  ['baseline (fair rollout)', {}],
  // Hero layer — the 25/30/33/35 LP head-start spread, normalized.
  ['hero: equalize all hero LP -> 31', { equalizeHeroLp: 31 }],
  // Radiant — strip the whole defensive longevity package at once.
  ['Radiant: strip shield+bulwark+defender-forcing+hero-heal', { ablateShield: true, ablateBulwark: true, ablateDefenderForcing: true, disableHeroHealing: true }],
  // Radiant — the load-bearing body-HP lever (combat survivability).
  ['Radiant: cost-2+ bodies -1 HP', { cardStatOverride: Object.fromEntries(RAD2.map((id) => [id, { hp: -1 }])) }],
  // Verdant — raw stat/ramp efficiency (the hidden-by-the-old-bot driver).
  ['Verdant: char stats x0.80', { factionStatScale: { faction: 'Verdant', scale: 0.8 } }],
];

const pct = (x) => x.toFixed(1);
const results = [];
let base = null;
console.log(`Fair-rollout causal decomposition — real decks, all-pairs, depth-3 fair rollout, GPP=${GPP}`);
console.log(`  ${'config'.padEnd(52)}${FACTIONS.map((f) => f.slice(0, 4).padStart(7)).join('')}   spread   ΔRad ΔVerd`);
for (const [label, delta] of ABLATIONS) {
  const s = Date.now();
  const r = runSim({ ...BASE, ...delta });
  const wp = Object.fromEntries(FACTIONS.map((f) => [f, r.factionWinPct[f] ?? 0]));
  const dR = base ? wp.Radiant - base.Radiant : 0;
  const dV = base ? wp.Verdant - base.Verdant : 0;
  console.log(
    `  ${label.padEnd(52)}${FACTIONS.map((f) => pct(wp[f]).padStart(7)).join('')}   ${pct(r.paritySpread).padStart(5)}` +
      (base ? `  ${(dR >= 0 ? '+' : '') + pct(dR)} ${(dV >= 0 ? '+' : '') + pct(dV)}` : '') +
      `  (${((Date.now() - s) / 1000).toFixed(0)}s)`,
  );
  results.push({ label, faction: wp, spread: r.paritySpread });
  if (!base) base = wp;
}
writeFileSync(OUT, JSON.stringify({ GPP, results }, null, 1));
console.log(`\nWrote ${OUT}`);

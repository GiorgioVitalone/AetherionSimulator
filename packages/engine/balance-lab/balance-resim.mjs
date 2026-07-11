// balance-resim.mjs — run the 4 starter decks all-pairs under the trustworthy
// fairPilot, report faction win% + the top(Radiant+Verdant)/floor(Onyx+Sapphire)
// gap. Cards come from AETHERION_CARDS if set (loaded at import), so run this once
// with the default cards (before) and once with the edited set (after).
// Env: PILOT (heuristic|rollout), GPP, RDEPTH, LABEL, OUT.
import { writeFileSync } from 'node:fs';
import { runSim } from '../sim-runner.mjs';
import { getDeck } from '../deck-loader.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const PILOT = process.env.PILOT || 'heuristic';
const GPP = +(process.env.GPP || (PILOT === 'rollout' ? 12 : 400));
const RDEPTH = +(process.env.RDEPTH || 3);
const LABEL = process.env.LABEL || 'run';

const decks = Object.fromEntries(
  FACTIONS.map((f) => {
    const d = getDeck(f);
    return [f, { heroDefId: d.heroDefId, mainDeckDefIds: d.mainDeckDefIds, resourceDeckDefIds: d.resourceDeckDefIds, faction: f }];
  }),
);
const pilotCfg = PILOT === 'rollout'
  ? { botPolicy: 'rollout', rollouts: 4, maxCandidates: 5, rolloutDepth: RDEPTH }
  : { botPolicy: 'heuristic' };
const cfg = {
  decks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', terminationMode: 'turn_cap', abilitiesOn: true, turnCap: 80,
  seedBase: 12345, fairPilot: true, gamesPerPairing: GPP, ...pilotCfg,
  // STANDARD PILOT (adopted): reach-discard + exile-on-discard + value/synergy ranking.
  // On by default; set NO_REACH / NO_EXILE / NO_VALUE to ablate any leg.
  reachDiscard: !process.env.NO_REACH,
  exileDiscardForEnergy: !process.env.NO_EXILE,
  valuePilot: !process.env.NO_VALUE,
};

const r = runSim(cfg);
const wp = Object.fromEntries(FACTIONS.map((f) => [f, r.factionWinPct[f] ?? 0]));
const top = (wp.Radiant + wp.Verdant) / 2;
const floor = (wp.Onyx + wp.Sapphire) / 2;
const result = { label: LABEL, pilot: PILOT, gpp: GPP, wp, top, floor, gap: top - floor, spread: r.paritySpread, avgTurns: r.gameLength.avg, medTurns: r.gameLength.median };

const pct = (x) => x.toFixed(1).padStart(5);
console.log(`${LABEL.padEnd(8)} ${FACTIONS.map((f) => `${f.slice(0, 4)}${pct(wp[f])}`).join('  ')}   top ${pct(top)} floor ${pct(floor)} gap ${pct(top - floor)}  spread ${r.paritySpread.toFixed(1)}  turns avg ${r.gameLength.avg.toFixed(1)} med ${r.gameLength.median}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(result, null, 1));

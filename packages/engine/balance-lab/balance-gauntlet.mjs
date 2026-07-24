// balance-gauntlet.mjs — run ONE test deck against a FIXED field of the official
// starters, instead of the expensive all-pairs sweep. The targeted check for a
// card/deck the static audit (balance-card-audit.mjs) flagged as SIM-NEEDED: a
// card is strongest in its best home, so if it's fine vs the field it's fine.
//
// runSim exposes results only as faction-aggregate factionCounts, and same-faction
// mirrors don't split — so the field is the OTHER factions, run one matchup each.
// To test a NEW card: add it to the pool via AETHERION_CARDS (global to both seats,
// so it only appears where a decklist names it) and pass a DECK whose mainDeckDefIds
// include its id. Env: DECK (faction|deckId|name), GPP (default 100), LABEL, OUT,
// AETHERION_CARDS, NO_REACH/NO_EXILE/NO_VALUE (ablate the standard pilot).
import { runSim } from '../sim-runner.mjs';
import { getDeck } from '../deck-loader.mjs';
import { writeFileSync } from 'node:fs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const GPP = +(process.env.GPP || 100);
const DECK = process.env.DECK || 'Onyx';
const LABEL = process.env.LABEL || DECK;

const testDeck = getDeck(DECK);
const testFaction = testDeck ? testDeck.faction : DECK;
const field = FACTIONS.filter((f) => f !== testFaction);
const testSpec = testDeck
  ? {
      heroDefId: testDeck.heroDefId,
      mainDeckDefIds: testDeck.mainDeckDefIds,
      resourceDeckDefIds: testDeck.resourceDeckDefIds,
      faction: testFaction,
    }
  : DECK;

const BASE = {
  firstPlayer: 'alternating',
  fixHandSizeStall: true,
  termination: 'tiebreak',
  terminationMode: 'turn_cap',
  abilitiesOn: true,
  turnCap: 80,
  seedBase: 12345,
  fairPilot: true,
  botPolicy: 'heuristic',
  // Standard pilot (adopted) on by default; NO_REACH / NO_EXILE / NO_VALUE to ablate.
  reachDiscard: !process.env.NO_REACH,
  exileDiscardForEnergy: !process.env.NO_EXILE,
  valuePilot: !process.env.NO_VALUE,
};

const rows = [];
for (const f of field) {
  const r = runSim({ ...BASE, matchups: [{ p0Deck: testSpec, p1Deck: f }], gamesPerPairing: GPP });
  const c = r.factionCounts[testFaction] || { w: 0, n: 0 };
  rows.push({ vs: f, winPct: c.n ? (100 * c.w) / c.n : 0, n: c.n });
}
const wins = rows.map((x) => x.winPct);
const mean = wins.reduce((s, x) => s + x, 0) / wins.length;
const spread = Math.max(...wins) - Math.min(...wins);

console.log(
  `Gauntlet — ${LABEL} (${testFaction}) vs field, GPP=${GPP}${process.env.AETHERION_CARDS ? ' [patched cards]' : ''}`,
);
for (const x of rows) console.log(`  vs ${x.vs.padEnd(9)} ${x.winPct.toFixed(1).padStart(5)}%  (n=${x.n})`);
console.log(`  ── aggregate ${mean.toFixed(1)}%   spread ${spread.toFixed(1)}`);
if (process.env.OUT) {
  writeFileSync(process.env.OUT, JSON.stringify({ label: LABEL, testFaction, rows, mean, spread }, null, 1));
}

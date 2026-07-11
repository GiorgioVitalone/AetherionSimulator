// balance-faction-index.mjs — a cheap, NO-SIM invariant: per-faction aggregate
// card power + starter deck value. Balance is a faction-archetype property (see
// docs/balance-diagnosis.md §11), so a new card that pushes its faction's index
// out of line with the pack is the signal to run a full sim — without one, this is
// the fast drift check. Read-only (stdout + optional OUT). Env: DRIFT (flag %
// off the cross-faction mean, default 8), OUT.
import { computeCardPower, computeDeckValue } from './dist/balance/index.js';
import { loadBalanceData } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';
import { writeFileSync } from 'node:fs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const DRIFT_PCT = +(process.env.DRIFT || 8);

const { index, heroByFaction } = loadBalanceData();

const rows = FACTIONS.map((f) => {
  const cards = [...index.values()].filter((c) => c.alignment.includes(f));
  const powers = cards.map((c) => computeCardPower(c).power);
  const sum = powers.reduce((s, x) => s + x, 0);
  const avg = powers.length ? sum / powers.length : 0;
  const deck = getDeck(f);
  const deckValue = deck
    ? computeDeckValue({ faction: f, mainDeckDefIds: deck.mainDeckDefIds }, heroByFaction.get(f), index).value
    : 0;
  return { faction: f, n: cards.length, sum, avg, deckValue };
});

const meanAvg = rows.reduce((s, r) => s + r.avg, 0) / rows.length;
const meanDv = rows.reduce((s, r) => s + r.deckValue, 0) / rows.length;
const pct = (x, m) => (m ? (100 * (x - m)) / m : 0);

console.log(`Faction power-index — no sim; AUDIT NEEDED at ±${DRIFT_PCT}% off the cross-faction mean.`);
console.log(`  faction      n   sumPow   avgPow   deckVal   avgΔ%    dvΔ%   status`);
const out = [];
for (const r of rows) {
  const aD = pct(r.avg, meanAvg);
  const dD = pct(r.deckValue, meanDv);
  const status = Math.abs(aD) > DRIFT_PCT || Math.abs(dD) > DRIFT_PCT ? 'AUDIT NEEDED' : 'ok';
  out.push({ ...r, avgDeltaPct: aD, dvDeltaPct: dD, status });
  console.log(
    `  ${r.faction.padEnd(9)} ${String(r.n).padStart(3)} ${r.sum.toFixed(1).padStart(8)} ${r.avg.toFixed(2).padStart(7)} ${r.deckValue.toFixed(1).padStart(8)} ${aD.toFixed(1).padStart(6)} ${dD.toFixed(1).padStart(7)}   ${status}`,
  );
}
console.log(`  mean                      ${meanAvg.toFixed(2).padStart(7)} ${meanDv.toFixed(1).padStart(8)}`);
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify({ rows: out, meanAvg, meanDv }, null, 1));

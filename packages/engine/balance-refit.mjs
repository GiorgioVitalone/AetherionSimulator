// balance-refit.mjs — iterate the budget-fit (suggest → apply) on the starter pool
// until the in-window count stabilizes, then write the converged tight-window card
// set for re-simulation. computeSuggestions re-fits each pass (chasing the moving
// line); we MEASURE "within" against a FIXED baseline window so convergence is clean.
// Env: PASSES (default 4), FLATTEN_LP (default 30), OUT (/tmp/aetherion-cards-refit.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { computeCardPower } from './dist/balance/index.js';
import { indexFromRaw, budgetModel } from './balance-data.mjs';
import { applyEdits } from './balance-apply-edits.mjs';
import { getDeck } from './deck-loader.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const PASSES = +(process.env.PASSES || 4);
const FLATTEN_LP = process.env.FLATTEN_LP ? (Number(process.env.FLATTEN_LP) > 1 ? Number(process.env.FLATTEN_LP) : 30) : 30;
const OUT = process.env.OUT || '/tmp/aetherion-cards-refit.json';
const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;

function starterCards(raw) {
  const { index } = indexFromRaw(raw);
  const out = [];
  for (const f of FACTIONS) {
    for (const id of new Set(getDeck(f).mainDeckDefIds)) {
      const sc = index.get(id);
      if (sc) out.push({ id, name: sc.name, faction: f, cost: totalCost(sc), power: computeCardPower(sc).power, rarity: sc.rarity });
    }
  }
  return out;
}
function counts(cards, model) {
  const c = { over: 0, within: 0, under: 0 };
  const outliers = [];
  for (const x of cards) {
    const e = model.expectedFor(x.cost, x.rarity);
    const s = x.power > e + model.tol ? 'over' : x.power < e - model.tol ? 'under' : 'within';
    c[s]++;
    if (s !== 'within') outliers.push({ ...x, status: s, edge: +(s === 'over' ? x.power - (e + model.tol) : e - model.tol - x.power).toFixed(1) });
  }
  return { c, outliers };
}

const base = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
const fixed = budgetModel(starterCards(base)); // FIXED measurement window
console.log(`Budget-fit iteration — tight window ±${fixed.tol}, LP→${FLATTEN_LP} (within measured vs the fixed baseline window)`);
let cur = base;
let r = counts(starterCards(cur), fixed);
console.log(`  pass 0 (baseline): over ${r.c.over} · within ${r.c.within} · under ${r.c.under}`);
for (let p = 1; p <= PASSES; p++) {
  cur = applyEdits(cur, { mode: 'all', flattenLp: FLATTEN_LP }).raw;
  r = counts(starterCards(cur), fixed);
  console.log(`  pass ${p}: over ${r.c.over} · within ${r.c.within} · under ${r.c.under}  (flagged ${r.c.over + r.c.under})`);
}
writeFileSync(OUT, JSON.stringify(cur));
console.log(`\nWrote ${OUT}. Residual outliers (${r.outliers.length}):`);
for (const o of r.outliers.sort((a, b) => b.edge - a.edge)) {
  console.log(`  ${o.status === 'over' ? 'OVER ' : 'under'} ${o.name.padEnd(24)} ${o.faction.padEnd(8)} cost ${o.cost}  ${o.status === 'over' ? '+' : '−'}${o.edge}`);
}

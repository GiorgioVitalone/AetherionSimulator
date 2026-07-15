// balance-refit.mjs — iterate suggest → apply on the starter pool until the
// in-window count stabilizes, then write the converged card set for re-simulation.
// Since §B1 the budget line is FROZEN (balance-budget.v1.json): computeSuggestions
// no longer re-fits per pass, and this tool measures "within" against those same
// frozen windows — one source of truth for judgment.
// Env: PASSES (default 4), FLATTEN_LP (default 30), OUT (/tmp/aetherion-cards-refit.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { computeCardPower } from '../dist/balance/index.js';
import { indexFromRaw, loadBudgetModel } from '../balance-data.mjs';
import { applyEdits } from '../balance-apply-edits.mjs';
import { getDeck } from '../deck-loader.mjs';

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
      if (sc) out.push({ id, name: sc.name, faction: f, cardType: sc.cardType, cost: totalCost(sc), power: computeCardPower(sc).power, rarity: sc.rarity });
    }
  }
  return out;
}
function counts(cards, model) {
  const c = { over: 0, within: 0, under: 0 };
  const outliers = [];
  for (const x of cards) {
    const e = model.expectedFor(x.cost, x.rarity, x.cardType);
    const mtol = model.tolFor(x.cardType);
    const s = x.power > e + mtol ? 'over' : x.power < e - mtol ? 'under' : 'within';
    c[s]++;
    if (s !== 'within') outliers.push({ ...x, status: s, edge: +(s === 'over' ? x.power - (e + mtol) : e - mtol - x.power).toFixed(1) });
  }
  return { c, outliers };
}

const base = JSON.parse(readFileSync(new URL('../sim-data/aetherion-cards.json', import.meta.url)));
const fixed = loadBudgetModel(); // FIXED measurement window = the frozen declared line (§B1)
console.log(`Budget iteration — frozen v${fixed.version} windows (C ±${fixed.characters.tol} / SE ±${fixed.spellsEquip.tol}), LP→${FLATTEN_LP} (within measured vs the fixed baseline window)`);
let cur = base;
let r = counts(starterCards(cur), fixed);
console.log(`  pass 0 (baseline): over ${r.c.over} · within ${r.c.within} · under ${r.c.under}`);
for (let p = 1; p <= PASSES; p++) {
  // mode: 'exploratory' — iterates the fit for lab inspection; writes to
  // /tmp by default, never card data. See applyEdits' doc comment.
  cur = applyEdits(cur, { mode: 'exploratory', arm: 'all', flattenLp: FLATTEN_LP }).raw;
  r = counts(starterCards(cur), fixed);
  console.log(`  pass ${p}: over ${r.c.over} · within ${r.c.within} · under ${r.c.under}  (flagged ${r.c.over + r.c.under})`);
}
writeFileSync(OUT, JSON.stringify(cur));
console.log(`\nWrote ${OUT}. Residual outliers (${r.outliers.length}):`);
for (const o of r.outliers.sort((a, b) => b.edge - a.edge)) {
  console.log(`  ${o.status === 'over' ? 'OVER ' : 'under'} ${o.name.padEnd(24)} ${o.faction.padEnd(8)} cost ${o.cost}  ${o.status === 'over' ? '+' : '−'}${o.edge}`);
}

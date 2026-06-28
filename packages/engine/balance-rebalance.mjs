// balance-rebalance.mjs — constrained, function-preserving rebalance of the
// out-of-window starter cards, and a comparison of rebalance "balance vectors".
//
// A balance vector = the per-card choice of LEVER (cost / stat / ability). This
// tool builds candidate vectors under different policies, reports each one's lever
// mix and deck-value landscape, writes the recommended pool, and prints the command
// to SIM-confirm it.
//
// HONEST DIVISION OF LABOUR (see docs/balance-valuation.md, the §11f finding):
//   • the formula FILTERS — every edit lands in its budget window and stays
//     combat-viable (ATK≥1, HP+ARM≥2). That is enforced upstream in the levers.
//   • the formula does NOT JUDGE balance — the card score is cost-free, so a
//     cost-raise (the safest nerf) is almost invisible to deck value. The SIM is
//     the balance judge; this tool only tees it up.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeDeckValue } from './dist/balance/index.js';
import { loadBalanceData, indexFromRaw } from './balance-data.mjs';
import { computeSuggestions } from './balance-suggestions.mjs';
import { getDeck } from './deck-loader.mjs';

const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire'];
const STAT_TRIM_MAX = 2; // mirror the suggestions engine's "clean trim" threshold
const OUT = process.env.OUT || '/tmp/aetherion-rebalanced.json';

const { raw, index: baseIdx, heroByFaction } = loadBalanceData();
const deckValues = (idx) =>
  FACTIONS.map((f) =>
    computeDeckValue({ faction: f, mainDeckDefIds: getDeck(f).mainDeckDefIds }, heroByFaction.get(f), idx).value,
  );

const bumpCost = (sc, delta) => {
  const c = { ...sc.cost };
  const key = c.energy >= c.mana ? 'energy' : 'mana';
  c[key] = Math.max(0, c[key] + delta);
  return c;
};
const bumpStats = (sc, e) => ({ atk: sc.stats.atk + e.da, hp: sc.stats.hp + e.dh, arm: sc.stats.arm + e.dr });

// Lever choice for ONE over-budget card under a named policy. Returns {stats?,cost,lever}.
function overLever(c, policy) {
  const cleanTrim = c.statEdit && c.abilityShare < 0.5 && c.statEdit.mag <= STAT_TRIM_MAX;
  const wantStat =
    policy === 'cost' ? false : policy === 'stat' ? Boolean(c.statEdit) : cleanTrim; // 'function'
  if (wantStat) return { stats: bumpStats(c.sc, c.statEdit), cost: c.sc.cost, lever: 'stat' };
  return { cost: bumpCost(c.sc, c.costK), lever: 'cost' };
}

// Build a full patched pool for a policy: under cards always re-cost down; over
// cards take the policy's lever. Pure (deep-copies the base pool).
function buildPool(over, under, policy) {
  const pool = JSON.parse(JSON.stringify(raw));
  const byId = new Map(pool.map((c) => [c.id, c]));
  const mix = { cost: 0, stat: 0 };
  for (const c of under) {
    const card = byId.get(c.id);
    if (card) card.cost = bumpCost(c.sc, c.costAfter - c.cost);
  }
  for (const c of over) {
    const card = byId.get(c.id);
    if (!card) continue;
    const e = overLever(c, policy);
    if (e.stats) card.stats = e.stats;
    card.cost = e.cost;
    mix[e.lever]++;
  }
  return { pool, mix };
}

function report() {
  const { over, under } = computeSuggestions();
  const f1 = (x) => x.toFixed(0).padStart(5);
  const before = deckValues(baseIdx);
  console.log(`Constrained rebalance — ${over.length} over / ${under.length} under budget on the starter pool.`);
  console.log(`Baseline deck value: ${FACTIONS.map((f, i) => `${f.slice(0, 4)} ${before[i].toFixed(0)}`).join('  ')}\n`);

  console.log('Balance-vector candidates (all viability-floored; under-cards re-cost down in every one):');
  console.log(`  ${'policy'.padEnd(10)}${'levers'.padStart(14)}   deck value (R / V / O / Sa)        outliers left`);
  const pools = {};
  for (const policy of ['cost', 'function', 'stat']) {
    const { pool, mix } = buildPool(over, under, policy);
    pools[policy] = pool;
    const vals = deckValues(indexFromRaw(pool).index);
    const left = (() => {
      const s = computeSuggestions(pool);
      return s.over.length + s.under.length;
    })();
    const tag = policy === 'function' ? ' ◄ recommended' : '';
    console.log(`  ${policy.padEnd(10)}${`${mix.cost}c / ${mix.stat}s`.padStart(14)}   ${FACTIONS.map((_, i) => f1(vals[i])).join('  ')}        ${String(left).padStart(2)}${tag}`);
  }

  console.log('\nRead this honestly:');
  console.log('  • cost vs function land at nearly the SAME deck values — the formula barely sees a');
  console.log('    cost-raise (the card score is cost-free). That sameness is the POINT: the formula');
  console.log("    cannot tell you which balances. Only the sim can. The 'stat' vector moves the");
  console.log('    numbers most precisely because the formula over-reads stat cuts — the §11f trap.');
  console.log('  • the recommended `function` vector preserves every body and never crosses a combat');
  console.log('    breakpoint; it is the safest candidate to hand to the sim.');

  writeFileSync(OUT, JSON.stringify(pools.function));
  const games = process.env.GPP || '300';
  console.log(`\nWrote the recommended (function-preserving) pool → ${OUT}`);
  console.log('SIM-confirm it (the real balance judge):');
  console.log(`  AETHERION_CARDS=${OUT} node sim-runner.mjs --reachDiscard true \\`);
  console.log(`    --exileDiscardForEnergy true --valuePilot true --gamesPerPairing ${games}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) report();

// balance-calibrate-budget.mjs — versioned re-seed: derive
// sim-data/balance-budget.v2.json (v1 was the 2026-07-14 seed; v2 is the
// maintainer-authorized 2026-07-18 re-seed) from mechanically-curated "simple,
// confidently-scored" cards. §B1: judgment of "how much power a cost buys".
// NOTE: the human-ratified `stabilityContract` and `recalibrationReason`
// provenance fields in the committed v2 JSON are added by hand (they record a
// maintainer decision this generator cannot know); this script emits the
// line values + method + calibratedFrom, which reproduce the committed
// numbers.
// must be an abstract DESIGN CONSTANT, never re-derived from the pool being
// judged (a mispriced pool would move its own goalposts) -- this script runs
// ONCE to seed the constants from the curated set, writes the frozen JSON,
// and refuses to overwrite it (bump the version to recalibrate). The
// suggestions tool (balance-suggestions.mjs) only ever READS the JSON.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { computeCardPower } from './dist/balance/index.js';
import { indexFromRaw, MIN_TOL, RMSE_MULT, RARITY_BONUS } from './balance-data.mjs';

const OUT_URL = new URL('./sim-data/balance-budget.v2.json', import.meta.url);
// "Confidently scored": zero context flags AND a near-point interval (§S3
// powerHigh-powerLow) -- a vanilla body or plain fixed-value effect, not a
// conditional/tutor/recursion/free-cast/rules-sensitive one.
const SPREAD_MAX = 0.5;
const r1 = (x) => Math.round(x * 10) / 10;
const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;

/** Robust (Theil-Sen) linear fit: slope = median of all pairwise slopes,
 * intercept = median of (y - slope*x). Resistant to the handful of outliers
 * even a curated set can still contain, unlike a least-squares mean fit.
 * points: [{x, y}]. */
export function theilSenFit(points) {
  const median = (arr) => {
    const s = [...arr].sort((a, b) => a - b);
    const mid = Math.floor((s.length - 1) / 2);
    return s.length % 2 ? s[mid] : (s[mid] + s[mid + 1]) / 2;
  };
  const slopes = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  const slope = median(slopes);
  const intercept = median(points.map((p) => p.y - slope * p.x));
  return { slope, intercept };
}

/** Fit one card-type population: (power - declared rarity offset) vs cost.
 * Tolerance keeps the CURRENT policy's intent (window sized to residual
 * spread, MIN_TOL floor) but computed ONCE here from the curated set's own
 * residuals, then frozen -- not recomputed against whatever pool is judged.
 * cards: [{cost, power, rarity}]. */
export function fitPopulation(cards) {
  const points = cards.map((c) => ({ x: c.cost, y: c.power - (RARITY_BONUS[c.rarity] ?? 0) }));
  const { slope, intercept } = theilSenFit(points);
  const rmse = Math.sqrt(points.reduce((s, p) => s + (p.y - (intercept + slope * p.x)) ** 2, 0) / points.length);
  const tolerance = r1(Math.max(MIN_TOL, RMSE_MULT * rmse));
  return { slope: r1(slope), intercept: r1(intercept), tolerance };
}

/** Mechanically curate the candidate set: every C/S/E card in `raw` whose §S3
 * breakdown has flags === [] and a near-zero powerHigh-powerLow spread. */
export function curate(raw, spreadMax = SPREAD_MAX) {
  const { index } = indexFromRaw(raw);
  const rows = [];
  for (const [id, sc] of index) {
    const bd = computeCardPower(sc);
    if (bd.flags.length !== 0) continue;
    if (bd.powerHigh - bd.powerLow > spreadMax) continue;
    rows.push({
      id,
      name: sc.name,
      cardType: sc.cardType,
      rarity: sc.rarity,
      cost: totalCost(sc),
      power: bd.power,
      faction: sc.alignment[0] ?? 'None',
    });
  }
  return rows;
}

function run() {
  if (existsSync(OUT_URL)) {
    throw new Error(
      `Refusing to overwrite ${fileURLToPath(OUT_URL)} -- this is a frozen, versioned budget line. Bump the version (new filename) to recalibrate.`,
    );
  }
  const raw = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
  const curated = curate(raw);
  const ids = curated.map((c) => c.id).sort((a, b) => a - b);
  console.log(`Curated ${curated.length}/${raw.length} pool cards (flags===[], interval spread <= ${SPREAD_MAX}):`);
  console.log(ids.join(', '));

  const characters = fitPopulation(curated.filter((c) => c.cardType === 'C'));
  const spellsEquip = fitPopulation(curated.filter((c) => c.cardType !== 'C'));

  const json = {
    version: '2.0.0',
    provenance: {
      date: new Date().toISOString().slice(0, 10),
      method:
        'Theil-Sen (median pairwise slope, median intercept) on a mechanically-curated flag-free, tight-interval card set; frozen thereafter',
      calibratedFrom: ids,
      note:
        'Rarity offsets are DECLARED from the existing RARITY_BONUS constants in balance-data.mjs, lifted as-is (not re-derived, so rarity is never double-counted through the fitted intercept). Abstract design constants: judge cost-for-power against this frozen line, never against the pool being judged. Bump the version to recalibrate.',
    },
    characters,
    spellsEquip,
    rarityOffsets: { ...RARITY_BONUS },
  };
  writeFileSync(OUT_URL, JSON.stringify(json, null, 2) + '\n');
  console.log(`\nWrote ${fileURLToPath(OUT_URL)}`);
  console.log(`Characters:   slope ${characters.slope}  intercept ${characters.intercept}  tolerance ${characters.tolerance}`);
  console.log(`SpellsEquip:  slope ${spellsEquip.slope}  intercept ${spellsEquip.intercept}  tolerance ${spellsEquip.tolerance}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();

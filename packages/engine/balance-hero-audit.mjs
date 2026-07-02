// balance-hero-audit.mjs — §13c hero power budget: a PARITY BAND, not a cost line.
//
// Heroes are free and singular (one per deck, cost nothing), so unlike cards
// there is no cost axis to regress against — the constraint is that all four
// heroes deliver comparable EFFECTIVE value (the same logic as the LP→30
// equalization, extended to the kit axis):
//
//   heroBudget = baseKitNet + P(flip) × liveFraction × transformKitNet
//
//   - netValue per ability = abilityContribution (gross, §13-corrected)
//     − activationCost × RESOURCE_VALUE_TEMP × expectedUses (recurrence): a
//     cost-7 ultimate is NOT a free one. Audit-layer netting only — cards keep
//     gross pricing in the shared pricer until this is validated.
//   - The transform side is availability-discounted: a flip kit is only live
//     for P(flip) × (turns alive after flip ÷ game length). Measured per
//     faction from a balance-verify JSON when MEASURED=<path> is given
//     (factionDetail.transformPct / avgTurnsAfterFlip / avgTurns); otherwise
//     §12c placeholders (P=0.70, live=0.25) with provenance below.
//   - Band: PASS if every heroBudget is within ±20% of the four-hero mean.
//     Out-of-band heroes are COST/COOLDOWN TUNING CANDIDATES (the sanctioned
//     hero knobs) — never mechanically edited (§11f discipline).
//
// Pre-registered falsifiability (H5): heroBudget deltas should rank-agree with
// the measured transform payoffs; if they disagree, the budget model — not the
// measurement — goes back to the shop.
//
// Usage:
//   AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json \
//   [MEASURED=./bv-CURRENT-v2.json] [BAND=0.20] node balance-hero-audit.mjs
import { readFileSync } from 'node:fs';
import { toStatic } from './balance-data.mjs';
import { abilityContribution, recurrence, RESOURCE_VALUE_TEMP, LP_VALUE } from './dist/balance/index.js';

const SRC = process.env.AETHERION_CARDS;
if (!SRC) {
  console.error('AETHERION_CARDS required (no silent default) — e.g. AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json');
  process.exit(1);
}
const BAND = +(process.env.BAND || 0.2);
const raw = JSON.parse(readFileSync(SRC, 'utf8'));

// ── Availability: measured per faction when a balance-verify JSON is supplied ─
// Placeholders provenance (§12c CURRENT ladder): transformPct 55–90% ⇒ ~0.70;
// turns-after-flip ~5–10 of avgTurns ~37 ⇒ liveFraction ~0.25.
const FALLBACK = { pFlip: 0.7, liveFraction: 0.25, source: '§12c placeholders' };
function measuredAvailability() {
  if (!process.env.MEASURED) return null;
  const gauge = JSON.parse(readFileSync(process.env.MEASURED, 'utf8'));
  // Last pilot with factionDetail = the strongest instrumented pilot in the file.
  const pilots = (gauge.pilots || []).filter((p) => p.factionDetail);
  const p = pilots[pilots.length - 1];
  if (!p) return null;
  const out = {};
  for (const [f, d] of Object.entries(p.factionDetail)) {
    out[f] = {
      pFlip: (d.transformPct ?? 70) / 100,
      liveFraction: d.avgTurnsAfterFlip != null && p.avgTurns ? d.avgTurnsAfterFlip / p.avgTurns : FALLBACK.liveFraction,
      source: `${process.env.MEASURED} (${p.label})`,
    };
  }
  return out;
}
const measured = measuredAvailability();

const heroes = raw.filter((c) => c.cardType === 'H');
const transformOf = (hero) => raw.find((c) => c.cardType === 'T' && c.originalHeroId === hero.id);

function abilityRows(card) {
  return (card.abilities || []).map((ab, i) => {
    const dsl = ab.dsl || {};
    const trig = dsl.trigger || {};
    const kind = dsl.type === 'aura' ? 'aura' : trig.type || dsl.type || '?';
    const cost = trig.cost || {};
    const costTotal = (cost.mana || 0) + (cost.energy || 0) + (cost.flexible || 0);
    const gross = dsl.effects || dsl.type ? +abilityContribution(dsl).toFixed(2) : 0;
    const uses = dsl.type ? recurrence(dsl) : 0; // expected uses over a game
    const net = +(gross - costTotal * RESOURCE_VALUE_TEMP * uses).toFixed(2);
    return {
      i,
      name: (ab.effect || '').split(':')[0],
      kind,
      costTotal,
      cd: trig.cooldown ?? ab.cooldown ?? null,
      once: trig.oncePerGame === true,
      gross,
      net,
    };
  });
}

function printSide(label, card) {
  const rows = abilityRows(card);
  console.log(`  ${label}: ${card.name}`);
  for (const r of rows) {
    const bits = [
      `#${r.i}`,
      r.kind.padEnd(14),
      r.costTotal ? `cost ${String(r.costTotal).padStart(2)}` : 'free   ',
      r.cd != null ? `cd ${r.cd}` : '    ',
      r.once ? 'ONCE/GAME' : '         ',
      `gross ${String(r.gross).padStart(6)}`,
      `net ${String(r.net).padStart(6)}`,
    ];
    console.log(`    ${bits.join('  ')}  ${r.name.slice(0, 50)}`);
  }
  return +rows.reduce((s, r) => s + r.net, 0).toFixed(2);
}

console.log(`Hero power budget (§13c) — pool: ${SRC}`);
console.log(`availability: ${measured ? `measured from ${process.env.MEASURED}` : FALLBACK.source} | band ±${BAND * 100}% of mean\n`);

const budgets = [];
for (const h of heroes) {
  const faction = h.alignment[0];
  console.log(`${faction} — ${h.name}`);
  const baseNet = printSide('base', h);
  const t = transformOf(h);
  const tNet = t ? printSide('TRANSFORMED', t) : 0;
  const avail = (measured && measured[faction]) || FALLBACK;
  // All transforms currently keep LP (hp:0 placeholder ⇒ lpDelta 0); the term
  // exists so a future LP-shifting transform is priced automatically.
  const lpDelta = 0;
  const budget = +(baseNet + avail.pFlip * avail.liveFraction * tNet + lpDelta * LP_VALUE).toFixed(2);
  budgets.push({ faction, hero: h.name, baseNet, tNet, pFlip: avail.pFlip, liveFraction: +avail.liveFraction.toFixed(2), budget });
  console.log(`  → baseNet ${baseNet} + ${avail.pFlip} × ${avail.liveFraction.toFixed(2)} × ${tNet} = heroBudget ${budget}\n`);
}

const mean = budgets.reduce((s, b) => s + b.budget, 0) / budgets.length;
const lo = mean * (1 - BAND), hi = mean * (1 + BAND);
console.log(`══ PARITY BAND ══  mean ${mean.toFixed(2)}, band [${lo.toFixed(2)} – ${hi.toFixed(2)}]`);
for (const b of budgets.sort((a, z) => z.budget - a.budget)) {
  const verdict = b.budget > hi ? 'FLAG (over — cost/cooldown-up candidate)' : b.budget < lo ? 'FLAG (under — cost/cooldown-down candidate)' : 'PASS';
  console.log(`  ${b.faction.padEnd(9)} ${String(b.budget).padStart(7)}  (base ${b.baseNet}, flip ${b.tNet} × ${b.pFlip}·${b.liveFraction})  ${verdict}`);
}
console.log('\nH5 pre-registration: heroBudget ordering should rank-agree with measured transform');
console.log('payoffs (factionDetail winPctWhenTransformed / §13b autopsy); disagreement sends the');
console.log('budget model back to the shop, not the measurement.');

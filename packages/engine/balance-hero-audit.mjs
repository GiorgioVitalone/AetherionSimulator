// balance-hero-audit.mjs — §13e hero power budget: the three-window framework.
//
// Heroes are free and singular (one per deck, no cost axis), so hero balance is
// PARITY, checked in three windows (all flag-only — out-of-band heroes are
// cost/cooldown tuning candidates, never mechanically edited; §11f discipline):
//
//   W1 NORMAL:    each hero's base-kit net value inside a FIXED design window
//                 (default [3.00 – 4.99] — absolute, set by design review after
//                 the §13f remeasure; replaced the mean-relative ±30% band so a
//                 single over-window hero can't drag the window up with it).
//   W2 TRANSFORM: each transformed kit inside a window around the transform
//                 mean (default ±25%) AND above an IMPACT FLOOR — a flip must
//                 swing the game, not fizzle (default ≥10 ≈ a strong top-end
//                 card's §13 power).
//   W3 COMPOSITE: 0.66 × baseNet + 0.33 × transformNet inside a TIGHTER band
//                 (default ±10%) — heroes get wiggle room to skew normal-vs-
//                 transformed, but their overall packages stay tightly matched.
//
//   netValue per ability = §13-corrected abilityContribution (gross) minus
//   activationCost × RESOURCE_VALUE_TEMP × expectedUses (recurrence model):
//   a cost-7 ultimate is not a free one. Netting is audit-layer only. (Known
//   limitation: effect-INTERNAL payments — e.g. "you may pay 2" riders — are
//   not netted; only trigger/activation costs are.)
//
// Usage:
//   AETHERION_CARDS=<pool.json> node balance-hero-audit.mjs
//   [W1_LO=3.00] [W1_HI=4.99] [TF_BAND=0.25] [TF_FLOOR=10] [COMPOSITE_BAND=0.10]
import { readFileSync } from 'node:fs';
import { abilityContribution, recurrence, RESOURCE_VALUE_TEMP } from './dist/balance/index.js';

const SRC = process.env.AETHERION_CARDS;
if (!SRC) {
  console.error('AETHERION_CARDS required (no silent default) — e.g. AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json');
  process.exit(1);
}
// W1 is a FIXED design window (post-§13f design review): the §13e mean-relative
// ±30% band passed Verdant's 5.44 base kit while the measurement showed the base
// battery is the outlier — an absolute ceiling can't be dragged up by the very
// hero it should catch. W2/W3 stay mean-relative (parity among the four).
const W1_LO = +(process.env.W1_LO || 3.0);
const W1_HI = +(process.env.W1_HI || 4.99);
const TF_BAND = +(process.env.TF_BAND || 0.25);
const TF_FLOOR = +(process.env.TF_FLOOR || 10);
const COMPOSITE_BAND = +(process.env.COMPOSITE_BAND || 0.1);
const W_NORMAL = 0.66, W_TRANSFORM = 0.33;

const raw = JSON.parse(readFileSync(SRC, 'utf8'));
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
    const uses = dsl.type ? recurrence(dsl) : 0;
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

console.log(`Hero power budget — three-window framework (§13e, W1 fixed per §13g) — pool: ${SRC}`);
console.log(`W1 normal [${W1_LO.toFixed(2)} – ${W1_HI.toFixed(2)}] fixed | W2 transform ±${TF_BAND * 100}% + floor ≥${TF_FLOOR} | W3 composite (${W_NORMAL}·base + ${W_TRANSFORM}·transform) ±${COMPOSITE_BAND * 100}%\n`);

const rows = [];
for (const h of heroes) {
  const faction = h.alignment[0];
  console.log(`${faction} — ${h.name}`);
  const baseNet = printSide('base', h);
  const t = transformOf(h);
  const tNet = t ? printSide('TRANSFORMED', t) : 0;
  const composite = +(W_NORMAL * baseNet + W_TRANSFORM * tNet).toFixed(2);
  rows.push({ faction, baseNet, tNet, composite });
  console.log(`  → base ${baseNet} | transform ${tNet} | composite ${composite}\n`);
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const band = (m, w) => [m * (1 - w), m * (1 + w)];
const inB = (v, [lo, hi]) => v >= lo && v <= hi;
const fmtB = ([lo, hi]) => `[${lo.toFixed(2)} – ${hi.toFixed(2)}]`;

const mBase = mean(rows.map((r) => r.baseNet));
const mTf = mean(rows.map((r) => r.tNet));
const mComp = mean(rows.map((r) => r.composite));
const bBase = [W1_LO, W1_HI];
const bTf = band(mTf, TF_BAND);
const bComp = band(mComp, COMPOSITE_BAND);

console.log(`══ W1 NORMAL FORM ══  mean ${mBase.toFixed(2)}, fixed window ${fmtB(bBase)}`);
for (const r of rows) console.log(`  ${r.faction.padEnd(9)} ${String(r.baseNet).padStart(7)}  ${inB(r.baseNet, bBase) ? 'PASS' : r.baseNet > bBase[1] ? 'FLAG over' : 'FLAG under'}`);
console.log(`══ W2 TRANSFORMED ══  mean ${mTf.toFixed(2)}, window ${fmtB(bTf)}, impact floor ≥${TF_FLOOR}`);
for (const r of rows) {
  const w = inB(r.tNet, bTf) ? 'PASS' : r.tNet > bTf[1] ? 'FLAG over' : 'FLAG under';
  const fl = r.tNet >= TF_FLOOR ? '' : '  + BELOW IMPACT FLOOR';
  console.log(`  ${r.faction.padEnd(9)} ${String(r.tNet).padStart(7)}  ${w}${fl}`);
}
console.log(`══ W3 COMPOSITE (tight) ══  mean ${mComp.toFixed(2)}, band ${fmtB(bComp)}`);
for (const r of rows.sort((a, z) => z.composite - a.composite)) {
  console.log(`  ${r.faction.padEnd(9)} ${String(r.composite).padStart(7)}  (${W_NORMAL}×${r.baseNet} + ${W_TRANSFORM}×${r.tNet})  ${inB(r.composite, bComp) ? 'PASS' : r.composite > bComp[1] ? 'FLAG over — knob-up candidate' : 'FLAG under — knob-down candidate'}`);
}
console.log('\nOut-of-window heroes are COST/COOLDOWN tuning candidates (the sanctioned hero');
console.log('knobs) — never mechanically edited. Remeasure the panel after any hero tune.');

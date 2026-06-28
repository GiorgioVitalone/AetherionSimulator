// balance-card-audit.mjs — per-card SHIP / SIM-NEEDED verdict from four cheap,
// LOCAL checks (no simulation): cost-budget, inter-card synergy cap, static
// loop/combo risk, and mechanic novelty. The point of the scalability toolkit:
// most cards clear all four and need no sim; only flagged ones do. Read-only
// (stdout table + optional JSON to OUT). Audits the whole pool, or one card by
// id/name substring as argv[2]. Env: LABEL, OUT.
import {
  computeCardPower,
  emitSignals,
  emitDemands,
  pairSynergy,
  detectCardLoops,
  flattenEffects,
  PAIR_CAP,
} from './dist/balance/index.js';
import { loadBalanceData, budgetModel } from './balance-data.mjs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;
const effectsOf = (ab) => (ab.type === 'stat_grant' ? [] : ab.effects || []);
const effectTypes = (sc) =>
  new Set(sc.abilities.flatMap((ab) => flattenEffects(effectsOf(ab)).map((e) => e.type)));

/** Audit every C/S/E card in the pool against the rest of the pool. */
export function auditPool(index) {
  const cards = [...index.values()];
  const model = budgetModel(
    cards.map((sc) => ({ cost: totalCost(sc), power: computeCardPower(sc).power, rarity: sc.rarity })),
  );
  // Pool universe for novelty: how many cards bear each trait / effect-type.
  const traitFreq = new Map();
  const effFreq = new Map();
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
  for (const sc of cards) {
    for (const t of new Set(sc.traits)) bump(traitFreq, t);
    for (const et of effectTypes(sc)) bump(effFreq, et);
  }
  const sig = new Map(cards.map((sc) => [sc.id, { provides: emitSignals(sc), demands: emitDemands(sc) }]));
  return cards.map((sc) => auditCard(sc, cards, model, { traitFreq, effFreq, sig }));
}

function auditCard(sc, pool, model, ctx) {
  const reasons = [];

  const power = computeCardPower(sc).power;
  const exp = model.expectedFor(totalCost(sc), sc.rarity);
  if (power > exp + model.tol) reasons.push(`budget: over by ${(power - exp - model.tol).toFixed(1)}`);
  else if (power < exp - model.tol) reasons.push(`budget: under by ${(exp - model.tol - power).toFixed(1)}`);

  const me = ctx.sig.get(sc.id);
  let maxPair = 0;
  let partner = null;
  for (const other of pool) {
    if (other.id === sc.id) continue;
    const o = ctx.sig.get(other.id);
    const v = pairSynergy(me.provides, o.demands) + pairSynergy(o.provides, me.demands);
    if (v > maxPair) {
      maxPair = v;
      partner = other.name;
    }
  }
  if (maxPair > PAIR_CAP) reasons.push(`synergy: ${partner} ${maxPair.toFixed(1)} > cap ${PAIR_CAP}`);

  const loop = detectCardLoops(sc);
  if (loop.level !== 'none') {
    reasons.push(`loop ${loop.level}: ${loop.abilities.flatMap((a) => a.reasons).join('; ')}`);
  }

  const novel = [
    ...[...new Set(sc.traits)].filter((t) => (ctx.traitFreq.get(t) || 0) <= 1),
    ...[...effectTypes(sc)].filter((et) => (ctx.effFreq.get(et) || 0) <= 1),
  ];
  if (novel.length) reasons.push(`novelty: unique ${novel.join(', ')}`);

  return {
    id: sc.id,
    name: sc.name,
    faction: sc.alignment[0] || '?',
    verdict: reasons.length ? 'SIM-NEEDED' : 'SHIP',
    reasons,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { index } = loadBalanceData();
  const arg = process.argv[2];
  let results = auditPool(index);
  if (arg) {
    const q = arg.toLowerCase();
    results = results.filter((r) => String(r.id) === arg || r.name.toLowerCase().includes(q));
  }
  const ship = results.filter((r) => r.verdict === 'SHIP').length;
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(
    `Card audit — ${results.length} cards: ${ship} SHIP, ${results.length - ship} SIM-NEEDED${process.env.LABEL ? ` [${process.env.LABEL}]` : ''}`,
  );
  for (const r of results.sort((a, b) =>
    a.verdict === b.verdict ? a.id - b.id : a.verdict === 'SIM-NEEDED' ? -1 : 1,
  )) {
    const tag = r.verdict === 'SHIP' ? '✓ SHIP     ' : '⚠ SIM-NEEDED';
    console.log(`  ${tag} ${pad(r.name, 26)} ${pad(r.faction, 4)} ${r.reasons.join(' | ')}`);
  }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
}

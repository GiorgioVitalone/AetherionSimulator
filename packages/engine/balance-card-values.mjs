// balance-card-values.mjs — first-principles card-power / deck-value report.
//
// DIAGNOSTIC ONLY: the weights are first-principles (anchored to the engine's own
// spell-eval / combat-plan constants), NEVER fitted to win rates. The correlation
// block below REPORTS how well a pure score tracks measured strength; it is not a
// calibration target. Read-only (stdout only). See docs/balance-valuation.md.
import { readFileSync } from 'node:fs';
import { computeCardPower, computeDeckValue } from './dist/balance/index.js';
import { pearson, spearman } from './dist/stats/index.js';
import { normalizeTraits } from './dist/setup/trait-normalizer.js';
import { getDeck } from './deck-loader.mjs';

const raw = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));

// ── Adapters: raw SimCard JSON -> StaticCard / HeroInput (the trust boundary) ──
const dslsOf = (c) => (c.abilities || []).map((a) => a.dsl).filter(Boolean);

function toStatic(c) {
  const norm = normalizeTraits(c.traits || []);
  const regen = norm.statusEffects
    .filter((s) => s.statusType === 'regeneration')
    .reduce((m, s) => Math.max(m, s.value), 0);
  const s = c.stats;
  return {
    id: c.id,
    name: c.name,
    cardType: c.cardType,
    cost: { mana: c.cost?.mana || 0, energy: c.cost?.energy || 0, flexible: c.cost?.flexible || 0 },
    stats: s ? { hp: s.hp || 0, atk: s.atk || 0, arm: s.arm || 0 } : null,
    traits: norm.traits,
    rushValue: norm.rushValue,
    recycleValue: norm.recycleValue,
    regenValue: regen || undefined,
    tags: c.tags || [],
    abilities: dslsOf(c),
    alignment: c.alignment || [],
  };
}

const transformsByHero = new Map();
for (const c of raw) if (c.cardType === 'T' && c.originalHeroId != null) transformsByHero.set(c.originalHeroId, c);

const heroByFaction = new Map();
for (const c of raw) {
  if (c.cardType !== 'H') continue;
  const lp = c.stats?.hp || 30;
  const t = transformsByHero.get(c.id);
  const transform = t
    ? { lpDelta: (t.stats?.hp || lp) - lp, abilities: dslsOf(t) }
    : undefined;
  const hero = { id: c.id, name: c.name, lp, abilities: dslsOf(c), transform, alignment: c.alignment || [] };
  for (const f of c.alignment || []) if (!heroByFaction.has(f)) heroByFaction.set(f, hero);
}

const index = new Map();
for (const c of raw) {
  if (c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E') index.set(c.id, toStatic(c));
}

// ── 1. Per-card power table ───────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
const r1 = (x) => x.toFixed(1).padStart(6);
const breakdowns = [...index.values()].map(computeCardPower);
const byPower = [...breakdowns].sort((a, b) => b.power - a.power || a.cardId - b.cardId);
const faction = (id) => (index.get(id)?.alignment?.[0] || '?').slice(0, 4);

console.log('DIAGNOSTIC ONLY — weights are first-principles; correlation is reported, never optimized.\n');
console.log(`Per-card power — ${byPower.length} cards (C/S/E). ★ = intra-card synergy multiplier > 1.2`);
console.log(`  ${pad('card', 26)}${pad('fac', 5)}${'power'.padStart(7)}${'stat'.padStart(7)}${'trait'.padStart(7)}${'abil'.padStart(7)}${'xMult'.padStart(7)}`);
byPower.forEach((b, i) => {
  const flag = b.synergyMultiplier > 1.2 ? ' ★' : i < 5 ? ' ↑' : i >= byPower.length - 5 ? ' ↓' : '';
  console.log(
    `  ${pad(b.name, 26)}${pad(faction(b.cardId), 5)}${r1(b.power)}${r1(b.statBase)}${r1(b.traitValue)}${r1(b.abilityValue)}${b.synergyMultiplier.toFixed(2).padStart(7)}${flag}`,
  );
});

// ── 2. Per-deck value + breakdown ─────────────────────────────────────────────
const FACTIONS = ['Radiant', 'Verdant', 'Onyx', 'Sapphire']; // win-rate-vector order
console.log(`\nPer-deck value (4 starters)`);
console.log(`  ${pad('faction', 10)}${'value'.padStart(8)}${'cardSum'.padStart(9)}${'consist'.padStart(9)}${'synergy'.padStart(9)}${'hero'.padStart(8)}  top synergy pairs`);
const deckValues = [];
for (const f of FACTIONS) {
  const deck = getDeck(f);
  const hero = heroByFaction.get(f);
  const dv = computeDeckValue({ faction: f, mainDeckDefIds: deck.mainDeckDefIds }, hero, index);
  deckValues.push(dv.value);
  const pairs = dv.interSynergy.topPairs.slice(0, 3).map((p) => `${p.a}+${p.b} ${p.value.toFixed(1)}`).join('; ');
  console.log(
    `  ${pad(f, 10)}${dv.value.toFixed(1).padStart(8)}${dv.cardPowerSum.toFixed(1).padStart(9)}${dv.consistency.toFixed(1).padStart(9)}${dv.interSynergy.capped.toFixed(1).padStart(9)}${dv.heroSynergy.toFixed(1).padStart(8)}  ${pairs}`,
  );
}

// ── 3. Correlation vs measured win rates (REPORTED, never optimized) ──────────
const WIN_FAIR = [78, 69, 44, 8]; // fair rollout (trustworthy), Radiant/Verdant/Onyx/Sapphire
const WIN_HEUR = [81.7, 44.9, 33.8, 39.6]; // heuristic baseline (disagrees in the middle)
const rankOrder = (vals) => FACTIONS.map((f, i) => [f, vals[i]]).sort((a, b) => b[1] - a[1]).map(([f]) => f).join(' > ');
const pf = pearson(deckValues, WIN_FAIR);
const sf = spearman(deckValues, WIN_FAIR);
const ph = pearson(deckValues, WIN_HEUR);
console.log(`\nCorrelation of deck value vs measured win rate (n=4 — Spearman ρ is the headline; Pearson r is noisy):`);
console.log(`  vs fair rollout : Pearson r = ${pf.r.toFixed(3)}   Spearman ρ = ${sf.r.toFixed(3)}`);
console.log(`  vs heuristic    : Pearson r = ${ph.r.toFixed(3)}`);
console.log(`  score order : ${rankOrder(deckValues)}`);
console.log(`  fair  order : ${rankOrder(WIN_FAIR)}`);
console.log(`  heur  order : ${rankOrder(WIN_HEUR)}`);

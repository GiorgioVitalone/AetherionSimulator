// balance-data.mjs — shared loader: raw SimCard JSON -> StaticCard index + heroes.
// Used by balance-card-values.mjs and balance-dashboard.mjs (the dsl->AbilityDSL
// cast + normalizeTraits happen here, the single trust boundary, as sim-runner does).
import { readFileSync } from 'node:fs';
import { normalizeTraits } from './dist/setup/trait-normalizer.js';

const dslsOf = (c) => (c.abilities || []).map((a) => a.dsl).filter(Boolean);

export function toStatic(c) {
  const norm = normalizeTraits(c.traits || []);
  const regen = norm.statusEffects
    .filter((s) => s.statusType === 'regeneration')
    .reduce((m, s) => Math.max(m, s.value), 0);
  const s = c.stats;
  return {
    id: c.id,
    name: c.name,
    cardType: c.cardType,
    rarity: c.rarity || 'Common',
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

/** Load the card pool into a StaticCard index + a faction->HeroInput map. */
export function loadBalanceData() {
  const raw = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));

  const transformsByHero = new Map();
  for (const c of raw) {
    if (c.cardType === 'T' && c.originalHeroId != null) transformsByHero.set(c.originalHeroId, c);
  }

  const heroByFaction = new Map();
  for (const c of raw) {
    if (c.cardType !== 'H') continue;
    const lp = c.stats?.hp || 30;
    const t = transformsByHero.get(c.id);
    const transform = t ? { lpDelta: (t.stats?.hp || lp) - lp, abilities: dslsOf(t) } : undefined;
    const hero = { id: c.id, name: c.name, lp, abilities: dslsOf(c), transform, alignment: c.alignment || [] };
    for (const f of c.alignment || []) if (!heroByFaction.has(f)) heroByFaction.set(f, hero);
  }

  const index = new Map();
  for (const c of raw) {
    if (c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E') index.set(c.id, toStatic(c));
  }

  return { raw, index, heroByFaction };
}

// ── Cost-budget model (shared by the dashboard + the suggestions generator) ───
export const MIN_TOL = 1.5;
// Window half-width ≈ RMSE_MULT × the pool's RMSE around the model. Tightened from
// 0.9 to 0.6 (full window ~8 → ~5.3): the budget is a real gate while staying a
// window, not a strict single value. See docs/balance-diagnosis.md.
export const RMSE_MULT = 0.6;
// Monotonic upward shift per rarity tier (higher rarity ⇒ higher budget). Tunable.
export const RARITY_BONUS = { Common: 0, Ethereal: 0.75, Mythic: 1.5, Legendary: 2.5 };
export const RARITY_ORDER = ['Common', 'Ethereal', 'Mythic', 'Legendary'];

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Least-squares power = a + b·cost line over the pool, shifted up by rarity, with
 * a ±TOL window sized to the residual RMSE. cards: [{cost, power, rarity}].
 * Returns { slope, intercept, tol, rmse, expectedFor }.
 */
export function budgetModel(cards) {
  const n = cards.length;
  const meanCost = cards.reduce((s, c) => s + c.cost, 0) / n;
  const meanPow = cards.reduce((s, c) => s + c.power, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const c of cards) {
    sxy += (c.cost - meanCost) * (c.power - meanPow);
    sxx += (c.cost - meanCost) ** 2;
  }
  const slope = r1(sxy / sxx);
  const intercept = r1(meanPow - (sxy / sxx) * meanCost);
  const expectedFor = (cost, rarity) => intercept + slope * cost + (RARITY_BONUS[rarity] ?? 0);
  const rmse = Math.sqrt(cards.reduce((s, c) => s + (c.power - expectedFor(c.cost, c.rarity)) ** 2, 0) / n);
  const tol = r1(Math.max(MIN_TOL, RMSE_MULT * rmse));
  return { slope, intercept, tol, rmse: Math.round(rmse * 100) / 100, expectedFor };
}

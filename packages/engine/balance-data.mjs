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

/** Build a StaticCard index + faction->HeroInput map from a raw SimCard array.
 * Pure — runs on the baseline pool or any edited copy (e.g. the rebalanced set). */
export function indexFromRaw(raw) {
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

  return { index, heroByFaction };
}

/** Load the baseline card pool into a StaticCard index + a faction->HeroInput map. */
export function loadBalanceData() {
  const raw = JSON.parse(readFileSync(new URL('./sim-data/aetherion-cards.json', import.meta.url)));
  return { raw, ...indexFromRaw(raw) };
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

/**
 * Characters and spells/equipment are different POPULATIONS: a character's power
 * scales steeply with cost (stats), a spell/equipment's scales gently (situational
 * effects) -- fitting one shared line for both is a bad statistical model for
 * either. At cost 3 Common on the starter pool this mixed model expects ~4.5,
 * while characters alone expect ~7.4 and spells/equipment alone expect ~2.2 -- a
 * ~3.4x gap. The shared line over-flags characters as over-budget (dragged down
 * by weaker spells) and invents false "under-budget" spell buffs (dragged up by
 * stronger bodies), while structurally hiding genuinely over-costed spells (their
 * power never clears the body-inflated line). Fits TWO models and dispatches by
 * cardType. cards: [{cost, power, rarity, cardType}].
 */
export function budgetModelByType(cards) {
  const isBody = (c) => c.cardType === 'C';
  const characters = budgetModel(cards.filter(isBody));
  const spellsEquip = budgetModel(cards.filter((c) => !isBody(c)));
  const modelFor = (cardType) => (cardType === 'C' ? characters : spellsEquip);
  const expectedFor = (cost, rarity, cardType) => modelFor(cardType).expectedFor(cost, rarity);
  const tolFor = (cardType) => modelFor(cardType).tol;
  return { characters, spellsEquip, expectedFor, tolFor };
}

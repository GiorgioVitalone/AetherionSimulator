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

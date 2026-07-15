/**
 * computeCardPower — the first-principles card score:
 *   power = base * synergyMultiplier,  base = statBase + traitValue + abilityValue
 * The base is additive (each element counted once); the intra-card synergy is a
 * bounded multiplier on top (the "Defender + self-heal worth more than the sum"
 * case). NEVER reads card cost — this is raw power.
 */
import type { Effect } from '../types/effects.js';
import type { AbilityDSL, StatGrantDSL } from '../types/ability.js';
import type { CardPowerBreakdown, PowerFlag, StaticCard } from './types.js';
import { sumEffectsDetailed } from './effect-interval.js';
import { emitDemands, emitSignals } from './signals.js';
import { flattenEffects } from './signal-extract.js';
import { intraSynergy } from './synergy.js';
import { regenerationValue, traitValue } from './trait-scaling.js';
import { EFFECT_SUM_CAP, INTRA_CAP, recurrence, W_ARM, W_ATK, W_HP } from './weights.js';

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function statBase(card: StaticCard): number {
  if (card.cardType !== 'C' || card.stats === null) return 0;
  return card.stats.atk * W_ATK + card.stats.hp * W_HP + card.stats.arm * W_ARM;
}

function traitValueTotal(card: StaticCard): number {
  let v = 0;
  for (const t of card.traits) {
    v += traitValue(t, card.stats, { rushValue: card.rushValue, recycleValue: card.recycleValue });
  }
  if (card.regenValue !== undefined && card.regenValue > 0) {
    v += regenerationValue(card.regenValue, card.stats?.hp ?? 1);
  }
  return v;
}

function statGrantValue(ab: StatGrantDSL): number {
  const m = ab.modifier;
  return (m.atk ?? 0) * W_ATK + (m.hp ?? 0) * W_HP + (m.arm ?? 0) * W_ARM;
}

/** §S3 (R2 fix): does this ability's effect tree contain a cost_reduction
 * node, ANYWHERE it could be nested? Was a shallow composite-only scan, which
 * missed a cost_reduction wrapped in choose_one/conditional/scheduled/
 * replacement — the auditor's reproduction (a choose_one-nested reducer
 * scoring flags: [] / AUTO_SAFE). Reuses signal-extract's flattenEffects,
 * the SAME full-recursion wrapper-walk signals.ts already relies on, so this
 * can't independently drift out of sync with the container list again. */
function hasCostReduction(effects: readonly Effect[]): boolean {
  return flattenEffects(effects).some((e) => e.type === 'cost_reduction');
}

const clamp = (x: number): number => Math.min(Math.max(0, x), EFFECT_SUM_CAP);

interface AbilityContribution {
  readonly value: number;
  readonly low: number;
  readonly high: number;
  readonly flags: readonly PowerFlag[];
}

/** Detailed sibling of abilityContribution: clamped effect-sum × trigger
 * recurrence, with a [low, high] band and context flags. The scalar
 * abilityContribution below derives its `.value` — one core computation. */
function abilityContributionDetailed(ab: AbilityDSL): AbilityContribution {
  const rec = recurrence(ab);
  if (ab.type === 'stat_grant') {
    const v = clamp(statGrantValue(ab)) * rec;
    return { value: v, low: v, high: v, flags: [] };
  }
  const sum = sumEffectsDetailed(ab.effects);
  const flags =
    ab.type === 'aura' && hasCostReduction(ab.effects)
      ? [...sum.flags, 'free_cast' as const]
      : sum.flags;
  return {
    value: clamp(sum.value) * rec,
    low: clamp(sum.low) * rec,
    high: clamp(sum.high) * rec,
    flags,
  };
}

/** Static value of one ability = clamped effect-sum × trigger recurrence. Shared
 * with deck-value's hero-engine valuation. */
export function abilityContribution(ab: AbilityDSL): number {
  return abilityContributionDetailed(ab).value;
}

export function computeCardPower(card: StaticCard): CardPowerBreakdown {
  const sb = statBase(card);
  const tv = traitValueTotal(card);
  const contributions = card.abilities.map(abilityContributionDetailed);
  const av = contributions.reduce((s, c) => s + c.value, 0);
  const avLow = contributions.reduce((s, c) => s + c.low, 0);
  const avHigh = contributions.reduce((s, c) => s + c.high, 0);
  const base = sb + tv + av;
  const baseLow = sb + tv + avLow;
  const baseHigh = sb + tv + avHigh;
  const provides = emitSignals(card);
  const demands = emitDemands(card);
  const intra = intraSynergy(provides, demands);
  const synergyMultiplier = 1 + Math.min(INTRA_CAP, base > 0 ? intra / base : 0);
  const flags = new Set<PowerFlag>(contributions.flatMap((c) => c.flags));
  if ((card.stats?.arm ?? 0) > 0) flags.add('rules_sensitive');
  return {
    cardId: card.id,
    name: card.name,
    power: round2(base * synergyMultiplier),
    powerLow: round2(baseLow * synergyMultiplier),
    powerHigh: round2(baseHigh * synergyMultiplier),
    flags: [...flags],
    statBase: round2(sb),
    traitValue: round2(tv),
    abilityValue: round2(av),
    intraSynergy: round2(intra),
    synergyMultiplier: round2(synergyMultiplier),
    provides,
    demands,
  };
}

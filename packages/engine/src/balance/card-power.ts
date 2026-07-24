/**
 * computeCardPower — the first-principles card score:
 *   power = base * synergyMultiplier,  base = statBase + traitValue + abilityValue
 * The base is additive (each element counted once); the intra-card synergy is a
 * bounded multiplier on top (the "Defender + self-heal worth more than the sum"
 * case). NEVER reads card cost — this is raw power.
 */
import type { AbilityDSL, StatGrantDSL } from '../types/ability.js';
import type { CardPowerBreakdown, PowerFlag, StaticCard } from './types.js';
import { dynamicBonusDetailed, sumEffectsDetailed } from './effect-interval.js';
import { emitDemands, emitSignals } from './signals.js';
import { scanRiskyEffects } from './risky-effects.js';
import { intraSynergy } from './synergy.js';
import { regenerationValue, traitValue } from './trait-scaling.js';
import {
  abilityOwnCondition,
  CONDITION_DISCOUNT,
  EFFECT_SUM_CAP,
  INTRA_CAP,
  recurrence,
  W_ARM,
  W_ATK,
  W_HP,
} from './weights.js';

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

/** §V2(b) (round-7): stat_grant.dynamicModifier was silently ignored (only
 * the fixed `modifier` was priced) — routed through the SAME
 * dynamicBonusDetailed modify_stats effects use, flagging 'dynamic_amount'
 * and widening the interval, never a second dynamic-amount model. */
interface StatGrantRange {
  readonly value: number;
  readonly low: number;
  readonly high: number;
  readonly flags: readonly PowerFlag[];
}
function statGrantValueDetailed(ab: StatGrantDSL): StatGrantRange {
  const base = statGrantValue(ab);
  const dyn = dynamicBonusDetailed(ab.dynamicModifier);
  return {
    value: base + dyn.value,
    low: base + dyn.low,
    high: base + dyn.high,
    flags: dyn.flags,
  };
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
    const sg = statGrantValueDetailed(ab);
    return {
      value: clamp(sg.value) * rec,
      low: clamp(sg.low) * rec,
      high: clamp(sg.high) * rec,
      flags: sg.flags,
    };
  }
  const sum = sumEffectsDetailed(ab.effects);
  // §P1 (R3 fix): free_cast/selection/recursion must be ability-kind-
  // independent — scanRiskyEffects walks EVERY ability kind, not just aura,
  // and (via flattenEffects) every wrapper, including non-best choose_one
  // branches sum.flags itself never sees (sumEffectsDetailed's choose_one
  // only keeps the highest-value option).
  const risky = scanRiskyEffects([ab]);
  const flagSet = new Set<PowerFlag>([...sum.flags, ...risky.flags]);
  // §V2(a) (round-7): an ability-level Condition (triggered/aura `condition`)
  // already discounts the SCALAR via recurrence()'s conditionFactor
  // (CONDITION_DISCOUNT), but previously added neither the 'conditional' flag
  // nor any interval widening — a falsely-precise powerLow === powerHigh
  // could reach AUTO_SAFE gating. `rec` already carries the ×CONDITION_DISCOUNT
  // for the midpoint (unchanged); the interval spans [never fires, always
  // fires] around it — the same treatment effect-level `conditional` gets.
  // §X1 (round-9): abilityOwnCondition also catches a conditional aura
  // expressed as `trigger: { type: 'while', condition }` (WhileCondition) —
  // the SAME condition-bearing shape from this flag/widening's point of view,
  // never a second inventory (see weights.ts's abilityOwnCondition).
  const condition = abilityOwnCondition(ab);
  if (condition !== undefined) {
    flagSet.add('conditional');
    const recFull = rec / CONDITION_DISCOUNT;
    return {
      value: clamp(sum.value) * rec,
      low: 0,
      high: clamp(sum.high) * recFull,
      flags: [...flagSet],
    };
  }
  return {
    value: clamp(sum.value) * rec,
    low: clamp(sum.low) * rec,
    high: clamp(sum.high) * rec,
    flags: [...flagSet],
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

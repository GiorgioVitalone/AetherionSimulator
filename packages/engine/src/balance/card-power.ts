/**
 * computeCardPower — the first-principles card score:
 *   power = base * synergyMultiplier,  base = statBase + traitValue + abilityValue
 * The base is additive (each element counted once); the intra-card synergy is a
 * bounded multiplier on top (the "Defender + self-heal worth more than the sum"
 * case). NEVER reads card cost — this is raw power.
 */
import type { AbilityDSL, StatGrantDSL } from '../types/ability.js';
import type { CardPowerBreakdown, StaticCard } from './types.js';
import { sumEffects } from './effect-value.js';
import { emitDemands, emitSignals } from './signals.js';
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

/** Static value of one ability = clamped effect-sum × trigger recurrence. Shared
 * with deck-value's hero-engine valuation. */
export function abilityContribution(ab: AbilityDSL): number {
  const sum = ab.type === 'stat_grant' ? statGrantValue(ab) : sumEffects(ab.effects).value;
  return Math.min(Math.max(0, sum), EFFECT_SUM_CAP) * recurrence(ab);
}

export function computeCardPower(card: StaticCard): CardPowerBreakdown {
  const sb = statBase(card);
  const tv = traitValueTotal(card);
  const av = card.abilities.reduce((s, ab) => s + abilityContribution(ab), 0);
  const base = sb + tv + av;
  const provides = emitSignals(card);
  const demands = emitDemands(card);
  const intra = intraSynergy(provides, demands);
  const synergyMultiplier = 1 + Math.min(INTRA_CAP, base > 0 ? intra / base : 0);
  return {
    cardId: card.id,
    name: card.name,
    power: round2(base * synergyMultiplier),
    statBase: round2(sb),
    traitValue: round2(tv),
    abilityValue: round2(av),
    intraSynergy: round2(intra),
    synergyMultiplier: round2(synergyMultiplier),
    provides,
    demands,
  };
}

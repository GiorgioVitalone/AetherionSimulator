/**
 * Public API for the first-principles card-power / deck-value valuation system.
 * Pure, deterministic balance/design tooling — see docs/balance-valuation.md.
 */
export { abilityContribution, computeCardPower } from './card-power.js';
export { computeDeckValue, ACCEL_RAMP_TEMPO, type DeckInput } from './deck-value.js';
export { effectStaticValue, sumEffects } from './effect-value.js';
export { effectStaticValueDetailed, sumEffectsDetailed } from './effect-interval.js';
export {
  abilityThrottle,
  detectAbilityLoop,
  detectCardLoops,
  isRepeatableTrigger,
  type AbilityLoopRisk,
  type CardLoopRisk,
  type LoopLevel,
  type LoopRisk,
} from './loop-detector.js';
export { emitDemands, emitSignals, heroDemands } from './signals.js';
export { deckInterSynergy, intraSynergy, pairSynergy, type CardSignals } from './synergy.js';
export { INTERACTION_MATRIX, interactionWeight } from './interaction-matrix.js';
export { regenerationValue, traitValue } from './trait-scaling.js';
export { recurrence, PAIR_CAP, RESOURCE_VALUE_TEMP, LP_VALUE } from './weights.js';
export { flattenEffects } from './signal-extract.js';
export type {
  CardIndex,
  CardPowerBreakdown,
  CardStats,
  Demand,
  DeckValueBreakdown,
  EffectValue,
  EffectValueDetailed,
  HeroInput,
  HeroTransform,
  InteractionMatrix,
  PowerFlag,
  ProvideKind,
  Signal,
  StaticCard,
  SynergyBreakdown,
  SynergyPair,
  WantKind,
} from './types.js';

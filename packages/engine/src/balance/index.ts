/**
 * Public API for the first-principles card-power / deck-value valuation system.
 * Pure, deterministic balance/design tooling — see docs/balance-valuation.md.
 */
export { abilityContribution, computeCardPower } from './card-power.js';
export { computeDeckValue, type DeckInput } from './deck-value.js';
export { effectStaticValue, sumEffects } from './effect-value.js';
export { emitDemands, emitSignals, heroDemands } from './signals.js';
export { deckInterSynergy, intraSynergy, pairSynergy, type CardSignals } from './synergy.js';
export { INTERACTION_MATRIX, interactionWeight } from './interaction-matrix.js';
export { regenerationValue, traitValue } from './trait-scaling.js';
export { recurrence } from './weights.js';
export type {
  CardIndex,
  CardPowerBreakdown,
  CardStats,
  Demand,
  DeckValueBreakdown,
  EffectValue,
  HeroInput,
  HeroTransform,
  InteractionMatrix,
  ProvideKind,
  Signal,
  StaticCard,
  SynergyBreakdown,
  SynergyPair,
  WantKind,
} from './types.js';

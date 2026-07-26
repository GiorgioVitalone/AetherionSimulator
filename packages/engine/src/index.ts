// ── Types ───────────────────────────────────────────────────────────────────
export type * from './types/index.js';
export {
  ZONE_SLOTS,
  MAX_HAND_SIZE,
  RESOURCE_DECK_SIZE,
  INITIAL_HAND_SIZE,
  MULLIGAN_HAND_SIZE,
  MAX_TRIGGER_DEPTH,
} from './types/index.js';

// ── Rules authority ─────────────────────────────────────────────────────────
export {
  CURRENT_GAME_CONFIG,
  CURRENT_RULES_MANIFEST,
  assertRatified,
  validateRulesManifest,
} from './rules/index.js';
export type { ArtifactStatus, RulesManifest } from './rules/index.js';

// ── Canonical selectors ─────────────────────────────────────────────────────
export {
  effectiveTraits,
  hasEffectiveTrait,
  hasEffectiveTag,
  snapshotCard,
} from './selectors/index.js';

// ── Authoritative transitions ────────────────────────────────────────────────
export { transition, validatePlayerAction, validateReactiveAction } from './transitions/index.js';
export type {
  EngineCommand,
  EngineFailure,
  PendingInteraction,
  RuleViolation,
  RuleViolationCode,
  TransitionResult,
} from './transitions/index.js';

// ── Zones ───────────────────────────────────────────────────────────────────
export {
  deployToZone,
  removeFromZone,
  moveCard,
  findCard,
  hasOpenSlot,
  firstOpenSlot,
  getCardsInZone,
  getAllCards,
  getZoneArray,
  getZoneSlots,
  isAdjacentZone,
  createEmptyZoneState,
} from './zones/index.js';
export type { CardLocation, RemoveResult } from './zones/index.js';
export { getValidAttackTargets, isBoardEmpty } from './zones/index.js';
export type { AttackTarget } from './zones/index.js';

// ── Combat ──────────────────────────────────────────────────────────────────
export { calculateCombatDamage, calculateHeroDamage, resolveCombat } from './combat/index.js';
export type { DamageResult, CombatResult } from './combat/index.js';

// ── Events ──────────────────────────────────────────────────────────────────
export {
  triggerMatchesEvent,
  findMatchingTriggers,
  registerCardTriggers,
  unregisterCardTriggers,
  getAllRegisteredTriggers,
  buildHeroTriggers,
  registerHeroTriggers,
} from './events/index.js';

// ── Runtime (dispatch + auras) ───────────────────────────────────────────────
export { dispatchTriggers, recomputeAuras } from './runtime/index.js';
export type { DispatchResult } from './runtime/index.js';

// ── Trusted effect support (player actions use transition()) ─────────────────
export { resolveTargets } from './effects/index.js';
export type { ResolvedTargets } from './effects/index.js';
export { evaluateCondition } from './effects/index.js';
export { evaluateAmount } from './effects/index.js';
export { attemptDraw } from './effects/index.js';
export type { DrawAttemptResult, DrawCause } from './effects/index.js';
export {
  heroTargetId,
  parseHeroTargetId,
  isHeroTargetId,
} from './selectors/hero-identity.js';
export {
  validateGameStateInvariants,
  assertGameStateInvariants,
} from './invariants/game-state-invariants.js';
export type { StateInvariantViolation } from './invariants/game-state-invariants.js';

// ── Actions ─────────────────────────────────────────────────────────────────
export {
  computeAvailableActions,
  computeReactiveActions,
  canAfford,
  payCost,
  getAvailableResources,
  enumerateConcretePlayerActions,
  keyOfPlayerAction,
} from './actions/index.js';
export type {
  AvailableActions,
  DeployOption,
  CastSpellOption,
  EquipOption,
  RemoveEquipmentOption,
  TransferEquipmentOption,
  MoveOption,
  ActivateOption,
  AttackOption,
  ReactiveOption,
  CandidateGenMode,
} from './actions/index.js';

// ── Setup ───────────────────────────────────────────────────────────────────
export {
  createRng,
  nextRandom,
  randomInt,
  shuffle,
  createGame,
  createCurrentGame,
  applyMulligan,
} from './setup/index.js';
export type {
  CardDefinition,
  HeroDefinition,
  DeckSelection,
  CardDefinitionRegistry,
  GameSetupOptions,
} from './setup/index.js';

// ── State Machine ───────────────────────────────────────────────────────────
export { gameMachine } from './state-machine/index.js';
export type { GameMachineContext, GameMachineEvent, PlayerAction } from './state-machine/index.js';
export {
  refreshCards,
  drawResourceCard,
  drawMainDeckCard,
  removeTemporaryResources,
  checkHandSize,
  discardCards,
  passTurn,
} from './state-machine/index.js';

// ── Bot (heuristic policy) ───────────────────────────────────────────────────
export {
  chooseAction,
  chooseReactiveAction,
  chooseChoiceResponse,
  shouldKeepHand,
} from './bot/index.js';

// ── Neural (value-net featurizer) ────────────────────────────────────────────
export { featurize, FEATURE_SCHEMA_VERSION, FEATURE_LENGTH } from './neural/featurizer.js';

// ── Certification validation ────────────────────────────────────────────────
export { validateCardData, RULES as CARD_DATA_RULES } from './sim/card-data-validator.js';
export type {
  Finding as CardDataFinding,
  SemanticException,
  ValidatorCard,
} from './sim/card-data-validator.js';
export {
  buildCardScenarioInventory,
  validateCardScenarioInventory,
} from './sim/card-scenario-inventory.js';
export type {
  CardScenarioInventoryItem,
  ScenarioRequirement,
} from './sim/card-scenario-inventory.js';

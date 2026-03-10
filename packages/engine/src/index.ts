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
export {
  getValidAttackTargets,
  isBoardEmpty,
} from './zones/index.js';
export type { AttackTarget } from './zones/index.js';

// ── Combat ──────────────────────────────────────────────────────────────────
export {
  calculateCombatDamage,
  calculateHeroDamage,
  resolveCombat,
} from './combat/index.js';
export type { DamageResult, CombatResult } from './combat/index.js';

// ── Events ──────────────────────────────────────────────────────────────────
export {
  triggerMatchesEvent,
  findMatchingTriggers,
  registerCardTriggers,
  registerHeroTriggers,
  registerInitialTriggers,
  unregisterCardTriggers,
  getAllRegisteredTriggers,
  resolveTriggeredEvents,
  resumePendingResolution,
} from './events/index.js';

// ── Effects ─────────────────────────────────────────────────────────────────
export { executeEffect } from './effects/index.js';
export { resolveTargets } from './effects/index.js';
export type { ResolvedTargets } from './effects/index.js';
export { evaluateCondition } from './effects/index.js';
export { evaluateAmount } from './effects/index.js';

// ── Actions ─────────────────────────────────────────────────────────────────
export {
  computeAvailableActions,
  canAfford,
  payCost,
  getAvailableResources,
  computeMaxX,
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
  HeroActivateOption,
  AttackOption,
} from './actions/index.js';

// ── Setup ───────────────────────────────────────────────────────────────────
export {
  createRng,
  nextRandom,
  randomInt,
  shuffle,
  createGame,
  applyMulligan,
} from './setup/index.js';
export type {
  CardDefinition,
  HeroDefinition,
  DeckSelection,
  CardDefinitionRegistry,
} from './setup/index.js';

// ── State Machine ───────────────────────────────────────────────────────────
export { gameMachine } from './state-machine/index.js';
export type {
  GameMachineContext,
  GameMachineEvent,
  PlayerAction,
} from './state-machine/index.js';
export {
  refreshCards,
  drawResourceCard,
  drawMainDeckCard,
  executePlayerAction,
  removeTemporaryResources,
  checkHandSize,
  discardCards,
  passTurn,
} from './state-machine/index.js';

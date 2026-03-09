/**
 * Effect DSL Type System — barrel re-exports.
 *
 * Dependency graph (no cycles):
 *   common ─┬─ targets
 *            ├─ conditions
 *            ├─ durations (standalone)
 *            ├─ triggers ← conditions
 *            ├─ effects ← targets, conditions, durations, triggers
 *            └─ ability ← effects, triggers, conditions
 */

// ── Foundation ──────────────────────────────────────────
export type {
  ZoneType,
  Side,
  ResourceType,
  CardTypeCode,
  Stat,
  Trait,
  AmountExpr,
  CountingExpr,
  CountingFilter,
  ResourceCost,
  StatModifier,
  DynamicStatSource,
  TokenDef,
} from './common.js';

// ── Targets ─────────────────────────────────────────────
export type {
  TargetExpr,
  SelfTarget,
  HeroTarget,
  TargetCharacter,
  TargetEquipment,
  AllCharacters,
  AllCharactersInZone,
  UpToTargets,
  AdjacentToSelf,
  EquippedCharacter,
  OwnerHero,
  TargetCardInDiscard,
  TargetSpell,
  CopyTarget,
  RandomTarget,
  EachPlayer,
  SourceCharacter,
  PlayerTarget,
  TargetFilter,
} from './targets.js';

// ── Conditions ──────────────────────────────────────────
export type {
  Condition,
  HpThreshold,
  StatCompare,
  CardCount,
  ZoneIs,
  HasTrait,
  CostCheck,
  CardTypeCheck,
  ResourceCheck,
  IsAlive,
  TurnCount,
  IsTransformed,
  ControlsCharacter,
  CompareToOpponent,
  EventContext,
  TriggeringCardCost,
  AndCondition,
  OrCondition,
  NotCondition,
} from './conditions.js';

// ── Durations ───────────────────────────────────────────
export type {
  Duration,
  InstantDuration,
  UntilEndOfTurn,
  UntilNextUpkeep,
  PermanentDuration,
  ForCombat,
  WhileInPlay,
} from './durations.js';

// ── Triggers ────────────────────────────────────────────
export type {
  Trigger,
  OnDeploy,
  OnDestroy,
  OnTurnStart,
  OnTurnEnd,
  OnAttack,
  OnTakeDamage,
  OnDealDamage,
  OnDealLethalDamage,
  OnBlock,
  OnAllyDeployed,
  OnAllyDestroyed,
  OnSpellCast,
  OnSacrifice,
  OnHealed,
  OnEquipmentAttached,
  OnGainResource,
  OnStatModified,
  WhileCondition,
  Activated,
  OnCast,
  OnCounter,
  OnFlash,
  OnOverheal,
  TriggerFilter,
} from './triggers.js';

// ── Effects ─────────────────────────────────────────────
export type {
  Effect,
  DealDamageEffect,
  HealEffect,
  ModifyStatsEffect,
  DrawCardsEffect,
  ScryEffect,
  DeployTokenEffect,
  DestroyEffect,
  SacrificeEffect,
  BounceEffect,
  DiscardEffect,
  ReturnFromDiscardEffect,
  CounterSpellEffect,
  GainResourceEffect,
  CostReductionEffect,
  CostReductionFilter,
  GrantTraitEffect,
  GrantAbilityEffect,
  GrantedAbilityRef,
  MoveEffect,
  ApplyStatusEffect,
  StatusType,
  CleanseEffect,
  SearchDeckEffect,
  ShuffleIntoDeckEffect,
  CopyCardEffect,
  DeployFromDeckEffect,
  AttachAsEquipmentEffect,
  ChooseOneEffect,
  ChooseOneOption,
  ConditionalEffect,
  CompositeEffect,
  ReplacementEffect,
  ReplacedEvent,
  ScheduledEffect,
  ScheduledTiming,
  ScryAction,
} from './effects.js';

// ── Ability (top-level) ─────────────────────────────────
export type {
  AbilityDSL,
  TriggeredAbilityDSL,
  AuraAbilityDSL,
  StatGrantDSL,
} from './ability.js';

// ── Game State (runtime) ────────────────────────────────────
export type {
  GameState,
  GamePhase,
  PlayerState,
  ZoneState,
  TurnCounters,
  TemporaryResource,
  CardInstance,
  GrantedTrait,
  GrantedDuration,
  ActiveModifier,
  ActiveStatus,
  StatusEffectType,
  HeroState,
  ResourceCard,
  RegisteredTrigger,
  PendingChoice,
  PendingResolution,
  PendingChoiceType,
  ChoiceOption,
  EffectExecutionFrame,
  ResolutionWorkItem,
  EventResolutionWorkItem,
  TriggerResolutionWorkItem,
  PlayerResponse,
  StackItem,
  GameEvent,
  CardDeployedEvent,
  CardDestroyedEvent,
  CardBouncedEvent,
  CardExiledEvent,
  CardSacrificedEvent,
  DamageDealtEvent,
  HeroDamagedEvent,
  HeroHealedEvent,
  SpellCastEvent,
  AbilityActivatedEvent,
  CharacterAttackedEvent,
  CardDrawnEvent,
  CardDiscardedEvent,
  ResourceGainedEvent,
  EquipmentAttachedEvent,
  TurnStartEvent,
  TurnEndEvent,
  PhaseChangedEvent,
  StatModifiedEvent,
  LethalDamageDealtEvent,
  CharacterHealedEvent,
  CharacterOverhealedEvent,
  CardMovedEvent,
  TurnState,
  RngState,
  EffectContext,
  EffectResult,
} from './game-state.js';

export {
  ZONE_SLOTS,
  MAX_HAND_SIZE,
  RESOURCE_DECK_SIZE,
  INITIAL_HAND_SIZE,
  MULLIGAN_HAND_SIZE,
  MAX_TRIGGER_DEPTH,
} from './game-state.js';

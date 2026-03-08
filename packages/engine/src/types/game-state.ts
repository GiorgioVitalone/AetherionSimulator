/**
 * Runtime game state types — the in-memory representation of a game in progress.
 * Distinct from the DSL types (which define card *definitions*, not runtime *instances*).
 *
 * Every field is readonly — the engine produces new state objects, never mutates.
 */
import type {
  AbilityDSL,
  CardTypeCode,
  ResourceCost,
  ResourceType,
  StatModifier,
  Trait,
  ZoneType,
} from './index.js';
import type { Condition } from './conditions.js';
import type { Effect } from './effects.js';
import type { Trigger } from './triggers.js';

// ── Top-level Game State ─────────────────────────────────────────────────────

export interface GameState {
  readonly players: readonly [PlayerState, PlayerState];
  readonly activePlayerIndex: 0 | 1;
  readonly turnNumber: number;
  readonly phase: GamePhase;
  readonly stack: readonly StackItem[];
  readonly pendingChoice: PendingChoice | null;
  readonly log: readonly GameEvent[];
  readonly winner: 0 | 1 | 'draw' | null;
  readonly rng: RngState;
  readonly turnState: TurnState;
}

export type GamePhase =
  | 'setup'
  | 'mulligan'
  | 'upkeep'
  | 'strategy'
  | 'action'
  | 'end'
  | 'game_over';

// ── Player State ─────────────────────────────────────────────────────────────

export interface PlayerState {
  readonly hero: HeroState;
  readonly zones: ZoneState;
  readonly hand: readonly CardInstance[];
  readonly mainDeck: readonly CardInstance[];
  readonly resourceDeck: readonly ResourceCard[];
  readonly resourceBank: readonly ResourceCard[];
  readonly discardPile: readonly CardInstance[];
  readonly temporaryResources: readonly TemporaryResource[];
  readonly turnCounters: TurnCounters;
}

export interface ZoneState {
  readonly reserve: readonly (CardInstance | null)[];
  readonly frontline: readonly (CardInstance | null)[];
  readonly highGround: readonly (CardInstance | null)[];
}

export interface TurnCounters {
  readonly spellsCast: number;
  readonly equipmentPlayed: number;
  readonly charactersDeployed: number;
  readonly abilitiesActivated: number;
}

export interface TemporaryResource {
  readonly resourceType: ResourceType;
  readonly amount: number;
}

// ── Card Instance ────────────────────────────────────────────────────────────

export interface CardInstance {
  readonly instanceId: string;
  readonly cardDefId: number;
  readonly name: string;
  readonly cardType: CardTypeCode;
  readonly currentHp: number;
  readonly currentAtk: number;
  readonly currentArm: number;
  readonly baseHp: number;
  readonly baseAtk: number;
  readonly baseArm: number;
  readonly exhausted: boolean;
  readonly summoningSick: boolean;
  readonly movedThisTurn: boolean;
  readonly attackedThisTurn: boolean;
  readonly traits: readonly Trait[];
  readonly grantedTraits: readonly GrantedTrait[];
  readonly abilities: readonly AbilityDSL[];
  readonly registeredTriggers: readonly RegisteredTrigger[];
  readonly modifiers: readonly ActiveModifier[];
  readonly statusEffects: readonly ActiveStatus[];
  readonly equipment: CardInstance | null;
  readonly isToken: boolean;
  readonly tags: readonly string[];
  readonly cost: ResourceCost;
  readonly alignment: readonly string[];
  readonly owner: 0 | 1;
}

export interface GrantedTrait {
  readonly trait: Trait;
  readonly sourceInstanceId: string;
  readonly duration: GrantedDuration;
}

export type GrantedDuration =
  | { readonly type: 'permanent' }
  | { readonly type: 'until_end_of_turn' }
  | { readonly type: 'until_next_upkeep' }
  | { readonly type: 'while_in_play'; readonly sourceId: string };

export interface ActiveModifier {
  readonly id: string;
  readonly sourceInstanceId: string;
  readonly modifier: StatModifier;
  readonly duration: GrantedDuration;
}

export interface ActiveStatus {
  readonly statusType: StatusEffectType;
  readonly value: number;
  readonly remainingTurns: number | null;
}

export type StatusEffectType = 'persistent' | 'regeneration' | 'slowed' | 'stunned' | 'hexproof' | 'anti_redirect';

// ── Hero State ───────────────────────────────────────────────────────────────

export interface HeroState {
  readonly cardDefId: number;
  readonly name: string;
  readonly currentLp: number;
  readonly maxLp: number;
  readonly transformed: boolean;
  readonly canTransformThisGame: boolean;
  readonly transformedThisTurn: boolean;
  readonly abilities: readonly AbilityDSL[];
  readonly cooldowns: ReadonlyMap<number, number>;
  readonly registeredTriggers: readonly RegisteredTrigger[];
}

// ── Resource Card ────────────────────────────────────────────────────────────

export interface ResourceCard {
  readonly instanceId: string;
  readonly resourceType: ResourceType;
  readonly exhausted: boolean;
}

// ── Triggers (runtime registration) ──────────────────────────────────────────

export interface RegisteredTrigger {
  readonly id: string;
  readonly sourceInstanceId: string;
  readonly ownerPlayerId: 0 | 1;
  readonly trigger: Trigger;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
  readonly abilityIndex: number;
}

// ── PendingChoice (engine pauses for player input) ───────────────────────────

export interface PendingChoice {
  readonly type: PendingChoiceType;
  readonly playerId: 0 | 1;
  readonly options: readonly ChoiceOption[];
  readonly minSelections: number;
  readonly maxSelections: number;
  readonly context: string;
}

export type PendingChoiceType =
  | 'mulligan'
  | 'select_targets'
  | 'reserve_exhaust'
  | 'discard_to_hand_limit'
  | 'choose_one'
  | 'choose_zone_slot'
  | 'choose_discard';

export interface ChoiceOption {
  readonly id: string;
  readonly label: string;
  readonly instanceId?: string;
}

// ── Player Response (answer to PendingChoice) ────────────────────────────────

export interface PlayerResponse {
  readonly selectedOptionIds: readonly string[];
}

// ── Stack (response chain for Counter/Flash) ─────────────────────────────────

export interface StackItem {
  readonly id: string;
  readonly type: 'spell' | 'ability' | 'attack';
  readonly sourceInstanceId: string;
  readonly controllerId: 0 | 1;
  readonly effects: readonly Effect[];
  readonly targets: readonly string[];
}

// ── Game Events (emitted during state transitions) ───────────────────────────

export type GameEvent =
  | CardDeployedEvent
  | CardDestroyedEvent
  | CardBouncedEvent
  | CardExiledEvent
  | CardSacrificedEvent
  | DamageDealtEvent
  | HeroDamagedEvent
  | HeroHealedEvent
  | SpellCastEvent
  | AbilityActivatedEvent
  | CharacterAttackedEvent
  | CardDrawnEvent
  | CardDiscardedEvent
  | ResourceGainedEvent
  | EquipmentAttachedEvent
  | TurnStartEvent
  | TurnEndEvent
  | PhaseChangedEvent
  | StatModifiedEvent
  | LethalDamageDealtEvent
  | CharacterHealedEvent
  | CharacterOverhealedEvent
  | CardMovedEvent;

export interface CardDeployedEvent {
  readonly type: 'CARD_DEPLOYED';
  readonly cardInstanceId: string;
  readonly zone: ZoneType;
  readonly playerId: 0 | 1;
}
export interface CardDestroyedEvent {
  readonly type: 'CARD_DESTROYED';
  readonly cardInstanceId: string;
  readonly cause: 'combat' | 'effect' | 'sacrifice';
  readonly playerId: 0 | 1;
}
export interface CardBouncedEvent {
  readonly type: 'CARD_BOUNCED';
  readonly cardInstanceId: string;
}
export interface CardExiledEvent {
  readonly type: 'CARD_EXILED';
  readonly cardInstanceId: string;
}
export interface CardSacrificedEvent {
  readonly type: 'CARD_SACRIFICED';
  readonly cardInstanceId: string;
}
export interface DamageDealtEvent {
  readonly type: 'DAMAGE_DEALT';
  readonly sourceId: string;
  readonly targetId: string;
  readonly amount: number;
}
export interface HeroDamagedEvent {
  readonly type: 'HERO_DAMAGED';
  readonly playerId: 0 | 1;
  readonly amount: number;
  readonly sourceId: string;
}
export interface HeroHealedEvent {
  readonly type: 'HERO_HEALED';
  readonly playerId: 0 | 1;
  readonly amount: number;
}
export interface SpellCastEvent {
  readonly type: 'SPELL_CAST';
  readonly cardInstanceId: string;
  readonly playerId: 0 | 1;
}
export interface AbilityActivatedEvent {
  readonly type: 'ABILITY_ACTIVATED';
  readonly cardInstanceId: string;
  readonly abilityIndex: number;
}
export interface CharacterAttackedEvent {
  readonly type: 'CHARACTER_ATTACKED';
  readonly attackerId: string;
  readonly targetId: string;
}
export interface CardDrawnEvent {
  readonly type: 'CARD_DRAWN';
  readonly playerId: 0 | 1;
  readonly count: number;
}
export interface CardDiscardedEvent {
  readonly type: 'CARD_DISCARDED';
  readonly cardInstanceId: string;
  readonly playerId: 0 | 1;
}
export interface ResourceGainedEvent {
  readonly type: 'RESOURCE_GAINED';
  readonly playerId: 0 | 1;
  readonly resourceType: ResourceType;
  readonly amount: number;
}
export interface EquipmentAttachedEvent {
  readonly type: 'EQUIPMENT_ATTACHED';
  readonly equipmentId: string;
  readonly targetId: string;
}
export interface TurnStartEvent {
  readonly type: 'TURN_START';
  readonly playerId: 0 | 1;
  readonly turnNumber: number;
}
export interface TurnEndEvent {
  readonly type: 'TURN_END';
  readonly playerId: 0 | 1;
  readonly turnNumber: number;
}
export interface PhaseChangedEvent {
  readonly type: 'PHASE_CHANGED';
  readonly phase: GamePhase;
  readonly playerId: 0 | 1;
}
export interface StatModifiedEvent {
  readonly type: 'STAT_MODIFIED';
  readonly cardInstanceId: string;
  readonly modifier: StatModifier;
}
export interface LethalDamageDealtEvent {
  readonly type: 'LETHAL_DAMAGE_DEALT';
  readonly attackerId: string;
  readonly targetId: string;
}
export interface CharacterHealedEvent {
  readonly type: 'CHARACTER_HEALED';
  readonly cardInstanceId: string;
  readonly amount: number;
}
export interface CharacterOverhealedEvent {
  readonly type: 'CHARACTER_OVERHEALED';
  readonly cardInstanceId: string;
  readonly excess: number;
}
export interface CardMovedEvent {
  readonly type: 'CARD_MOVED';
  readonly cardInstanceId: string;
  readonly fromZone: ZoneType;
  readonly toZone: ZoneType;
}

// ── Turn State (per-turn tracking) ───────────────────────────────────────────

export interface TurnState {
  readonly discardedForEnergy: boolean;
  readonly firstPlayerFirstTurn: boolean;
}

// ── RNG State (seeded PRNG for determinism) ──────────────────────────────────

export interface RngState {
  readonly seed: number;
  readonly counter: number;
}

// ── Effect Context (passed through effect execution) ─────────────────────────

export interface EffectContext {
  readonly sourceInstanceId: string;
  readonly controllerId: 0 | 1;
  readonly triggerDepth: number;
  readonly selectedTargets?: readonly string[];
}

// ── Effect Result (returned by all engine operations) ────────────────────────

export interface EffectResult {
  readonly newState: GameState;
  readonly events: readonly GameEvent[];
  readonly pendingChoice?: PendingChoice;
}

// ── Zone Slot Counts (constants) ─────────────────────────────────────────────

export const ZONE_SLOTS = {
  reserve: 2,
  frontline: 3,
  high_ground: 2,
} as const;

export const MAX_HAND_SIZE = 8;
export const RESOURCE_DECK_SIZE = 15;
export const INITIAL_HAND_SIZE = 5;
export const MULLIGAN_HAND_SIZE = 4;
export const MAX_TRIGGER_DEPTH = 10;

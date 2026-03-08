/**
 * Effects — the actions that abilities perform.
 * 28 variants covering all abilities across 130 cards.
 *
 * Key design decisions:
 * - GrantedAbilityRef uses Trigger (no circular dep — triggers.ts doesn't import effects.ts)
 * - ReplacementEffect intercepts events, modeled as its own effect type
 * - DeployTokenEffect.inEachEmpty covers "deploy in each empty Frontline space"
 * - DrawCardsEffect.player uses Side (not TargetExpr) — drawing isn't character-targeted
 */
import type {
  AmountExpr,
  CardTypeCode,
  DynamicStatSource,
  ResourceType,
  Side,
  StatModifier,
  TokenDef,
  Trait,
  ZoneType,
  ResourceCost,
} from './common.js';
import type { TargetExpr, TargetFilter } from './targets.js';
import type { Condition } from './conditions.js';
import type { Duration } from './durations.js';
import type { Trigger } from './triggers.js';

export type Effect =
  | DealDamageEffect
  | HealEffect
  | ModifyStatsEffect
  | DrawCardsEffect
  | ScryEffect
  | DeployTokenEffect
  | DestroyEffect
  | SacrificeEffect
  | BounceEffect
  | DiscardEffect
  | ReturnFromDiscardEffect
  | CounterSpellEffect
  | GainResourceEffect
  | CostReductionEffect
  | GrantTraitEffect
  | GrantAbilityEffect
  | MoveEffect
  | ApplyStatusEffect
  | CleanseEffect
  | SearchDeckEffect
  | ShuffleIntoDeckEffect
  | CopyCardEffect
  | DeployFromDeckEffect
  | AttachAsEquipmentEffect
  | ChooseOneEffect
  | ConditionalEffect
  | CompositeEffect
  | ReplacementEffect
  | ScheduledEffect;

export interface DealDamageEffect {
  readonly type: 'deal_damage';
  readonly amount: AmountExpr;
  readonly target: TargetExpr;
}
export interface HealEffect {
  readonly type: 'heal';
  readonly amount: AmountExpr;
  readonly target: TargetExpr;
}
export interface ModifyStatsEffect {
  readonly type: 'modify_stats';
  readonly modifier: StatModifier;
  readonly target: TargetExpr;
  readonly duration: Duration;
  readonly dynamicModifier?: DynamicStatSource;
}
export interface DrawCardsEffect {
  readonly type: 'draw_cards';
  readonly count: AmountExpr;
  readonly player: Side;
}
export interface ScryEffect {
  readonly type: 'scry';
  readonly lookCount: number;
  readonly action: ScryAction;
}
export type ScryAction =
  | { readonly type: 'pick_and_remainder'; readonly pickCount: number; readonly pickTo: 'hand'; readonly remainder: 'bottom' | 'discard' | 'shuffle' }
  | { readonly type: 'distribute'; readonly destinations: readonly ('hand' | 'discard' | 'bottom')[] }
  | { readonly type: 'rearrange' };
export type DeployTokenEffect =
  | {
      readonly type: 'deploy_token';
      readonly token: TokenDef;
      readonly count: number;
      readonly zone?: ZoneType;
      readonly inEachEmpty?: false | undefined;
    }
  | {
      readonly type: 'deploy_token';
      readonly token: TokenDef;
      readonly inEachEmpty: true;
      readonly zone: ZoneType;
      readonly count?: never;
    };
export interface DestroyEffect {
  readonly type: 'destroy';
  readonly target: TargetExpr;
}
export interface SacrificeEffect {
  readonly type: 'sacrifice';
  readonly target: TargetExpr;
}
export interface BounceEffect {
  readonly type: 'bounce';
  readonly target: TargetExpr;
}
export interface DiscardEffect {
  readonly type: 'discard';
  readonly count: number;
  readonly target: TargetExpr;
}
export interface ReturnFromDiscardEffect {
  readonly type: 'return_from_discard';
  readonly target: TargetExpr;
  readonly destination: 'hand' | 'battlefield';
}
export interface CounterSpellEffect {
  readonly type: 'counter_spell';
  readonly target: TargetExpr;
  readonly unlessPay?: ResourceCost;
}
export interface GainResourceEffect {
  readonly type: 'gain_resource';
  readonly resourceType: ResourceType;
  readonly amount: number;
  readonly temporary?: boolean;
}
export interface CostReductionEffect {
  readonly type: 'cost_reduction';
  readonly reduction: number;
  readonly appliesTo: CostReductionFilter;
  readonly duration: Duration;
}
export interface CostReductionFilter {
  readonly cardType?: Extract<CardTypeCode, 'C' | 'S' | 'E'>;
  readonly tag?: string;
  readonly firstPerTurn?: boolean;
}
export interface GrantTraitEffect {
  readonly type: 'grant_trait';
  readonly trait: Trait;
  readonly target: TargetExpr;
  readonly duration: Duration;
}
export interface GrantAbilityEffect {
  readonly type: 'grant_ability';
  readonly ability: GrantedAbilityRef;
  readonly target: TargetExpr;
  readonly duration: Duration;
}
export interface GrantedAbilityRef {
  readonly trigger: Trigger;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
}
export interface MoveEffect {
  readonly type: 'move';
  readonly target: TargetExpr;
  readonly destination: ZoneType | 'any' | 'adjacent_to_current';
}
export interface ApplyStatusEffect {
  readonly type: 'apply_status';
  readonly status: StatusType;
  readonly target: TargetExpr;
  readonly value?: number;
  readonly durationTurns?: number;
}
export type StatusType = 'persistent' | 'regeneration' | 'slowed' | 'stunned' | 'hexproof' | 'anti_redirect';
export interface CleanseEffect {
  readonly type: 'cleanse';
  readonly target: TargetExpr;
}
export interface SearchDeckEffect {
  readonly type: 'search_deck';
  readonly filter: TargetFilter;
  readonly destination: 'hand' | 'battlefield';
  readonly castForFree?: boolean;
  readonly castFreeIfCost?: number;
}
export interface ShuffleIntoDeckEffect {
  readonly type: 'shuffle_into_deck';
  readonly source: 'discard' | 'hand';
}
export interface CopyCardEffect {
  readonly type: 'copy_card';
  readonly source: 'discard' | 'deck';
  readonly filter?: TargetFilter;
  readonly destination: 'hand';
}
export interface DeployFromDeckEffect {
  readonly type: 'deploy_from_deck';
  readonly filter: TargetFilter;
}
/** Morph a character into equipment attached to a target. Symbiotic Crawler. */
export interface AttachAsEquipmentEffect {
  readonly type: 'attach_as_equipment';
  readonly target: TargetExpr;
  readonly retainAbilities?: boolean;
}
export interface ChooseOneEffect {
  readonly type: 'choose_one';
  readonly options: readonly ChooseOneOption[];
}
export interface ChooseOneOption {
  readonly label: string;
  readonly effects: readonly Effect[];
}
export interface ConditionalEffect {
  readonly type: 'conditional';
  readonly condition: Condition;
  readonly ifTrue: readonly Effect[];
  readonly ifFalse?: readonly Effect[];
}
export interface CompositeEffect {
  readonly type: 'composite';
  readonly effects: readonly Effect[];
}
export interface ReplacementEffect {
  readonly type: 'replacement';
  readonly replaces: ReplacedEvent;
  readonly instead: readonly Effect[];
  readonly oncePerTurn?: boolean;
}
export type ReplacedEvent =
  | { readonly type: 'on_would_be_destroyed' }
  | { readonly type: 'on_would_take_damage'; readonly reduction?: number };

/** Effect that fires at a scheduled future timing. */
export interface ScheduledEffect {
  readonly type: 'scheduled';
  readonly timing: ScheduledTiming;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
}
export type ScheduledTiming =
  | { readonly type: 'next_turn_start' }
  | { readonly type: 'end_of_turn' }
  | { readonly type: 'next_upkeep' };

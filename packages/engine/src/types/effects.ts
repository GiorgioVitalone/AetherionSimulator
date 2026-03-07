/**
 * Effects — the actions that abilities perform.
 * 22 variants covering ~95% of 146 abilities across 128 cards.
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
  ResourceType,
  Side,
  StatModifier,
  TokenDef,
  Trait,
  ZoneType,
  ResourceCost,
} from './common.js';
import type { TargetExpr } from './targets.js';
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
  | ChooseOneEffect
  | ConditionalEffect
  | CompositeEffect
  | ReplacementEffect;

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
}
export interface DrawCardsEffect {
  readonly type: 'draw_cards';
  readonly count: AmountExpr;
  readonly player: Side;
}
/** Approximation — multi-destination scry flagged for Phase 2. */
export interface ScryEffect {
  readonly type: 'scry';
  readonly lookCount: number;
  readonly pickCount: number;
  readonly remainder: 'bottom' | 'discard' | 'shuffle';
}
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
export type StatusType = 'persistent' | 'regeneration' | 'slowed' | 'stunned';
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

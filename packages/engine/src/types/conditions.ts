/**
 * Conditions — boolean expressions for trigger guards and conditional effects.
 * 15 variants including And/Or/Not combinators for arbitrary composition.
 */
import type { ZoneType, Stat, Trait, CardTypeCode, ResourceType } from './common.js';

export type Condition =
  | HpThreshold
  | StatCompare
  | CardCount
  | ZoneIs
  | HasTrait
  | CostCheck
  | CardTypeCheck
  | ResourceCheck
  | IsAlive
  | TurnCount
  | IsTransformed
  | ControlsCharacter
  | CompareToOpponent
  | EventContext
  | TriggeringCardCost
  | AndCondition
  | OrCondition
  | NotCondition;

export interface HpThreshold {
  readonly type: 'hp_threshold';
  readonly comparison: 'less_than' | 'less_equal' | 'greater_than' | 'greater_equal' | 'equal';
  readonly value: number;
}
export interface StatCompare {
  readonly type: 'stat_compare';
  readonly stat: Stat;
  readonly comparison: 'less_than' | 'less_equal' | 'greater_than' | 'greater_equal' | 'equal';
  readonly value: number;
}
export interface CardCount {
  readonly type: 'card_count';
  readonly zone: 'hand' | 'discard' | 'battlefield' | 'resource_bank';
  readonly comparison: 'less_than' | 'less_equal' | 'greater_than' | 'greater_equal' | 'equal';
  readonly value: number;
  readonly tag?: string;
}
export interface ZoneIs {
  readonly type: 'zone_is';
  readonly zone: ZoneType;
}
export interface HasTrait {
  readonly type: 'has_trait';
  readonly trait: Trait;
}
export interface CostCheck {
  readonly type: 'cost_check';
  readonly comparison: 'less_equal' | 'greater_equal' | 'equal';
  readonly value: number;
}
export interface CardTypeCheck {
  readonly type: 'card_type_check';
  readonly cardType: CardTypeCode;
}
export interface ResourceCheck {
  readonly type: 'resource_check';
  readonly resourceType: ResourceType;
  readonly comparison: 'less_than' | 'less_equal' | 'greater_than' | 'greater_equal';
  readonly value: number;
}
export interface IsAlive {
  readonly type: 'is_alive';
}
export interface TurnCount {
  readonly type: 'turn_count';
  readonly action: 'equipment_played' | 'spell_cast' | 'character_deployed' | 'ability_activated';
  readonly comparison: 'less_than' | 'less_equal' | 'equal';
  readonly value: number;
}
export interface IsTransformed {
  readonly type: 'is_transformed';
}
export interface ControlsCharacter {
  readonly type: 'controls_character';
  readonly trait?: Trait;
  readonly tag?: string;
  readonly zone?: ZoneType;
}
/** Compare player metric to opponent (e.g. fewer characters on battlefield). */
export interface CompareToOpponent {
  readonly type: 'compare_to_opponent';
  readonly metric: 'battlefield_count' | 'hand_count';
  readonly comparison: 'less_than' | 'less_equal' | 'greater_than' | 'greater_equal' | 'equal';
}
/** Check event/turn context flags (e.g. used temporary resource this action). */
export interface EventContext {
  readonly type: 'event_context';
  readonly check: 'used_temporary_resource' | 'gained_temporary_resource_this_turn';
}
/** Reference the triggering card's cost for conditional effects. */
export interface TriggeringCardCost {
  readonly type: 'triggering_card_cost';
  readonly comparison: 'less_equal' | 'greater_equal' | 'equal';
  readonly relativeTo: 'triggering_spell';
}
export interface AndCondition {
  readonly type: 'and';
  readonly conditions: readonly Condition[];
}
export interface OrCondition {
  readonly type: 'or';
  readonly conditions: readonly Condition[];
}
export interface NotCondition {
  readonly type: 'not';
  readonly condition: Condition;
}

/**
 * Triggers — when an ability activates.
 * 23 variants covering all trigger patterns in the card database.
 *
 * `Activated` carries cost/cooldown directly rather than splitting into AbilityDSL.
 * `WhileCondition` requires a condition — for unconditional auras, use AuraAbilityDSL.
 */
import type { Side, ResourceCost, ResourceType, CardTypeCode, Trait } from './common.js';
import type { Condition } from './conditions.js';

export type Trigger =
  | OnDeploy
  | OnDestroy
  | OnTurnStart
  | OnTurnEnd
  | OnAttack
  | OnTakeDamage
  | OnDealDamage
  | OnDealLethalDamage
  | OnBlock
  | OnAllyDeployed
  | OnAllyDestroyed
  | OnSpellCast
  | OnSacrifice
  | OnHealed
  | OnEquipmentAttached
  | OnGainResource
  | OnStatModified
  | WhileCondition
  | Activated
  | OnCast
  | OnCounter
  | OnFlash
  | OnOverheal;

export interface OnDeploy {
  readonly type: 'on_deploy';
}
export interface OnDestroy {
  readonly type: 'on_destroy';
}
export interface OnTurnStart {
  readonly type: 'on_turn_start';
}
export interface OnTurnEnd {
  readonly type: 'on_turn_end';
}
export interface OnAttack {
  readonly type: 'on_attack';
}
export interface OnTakeDamage {
  readonly type: 'on_take_damage';
}
export interface OnDealLethalDamage {
  readonly type: 'on_deal_lethal_damage';
}
export interface OnDealDamage {
  readonly type: 'on_deal_damage';
}
export interface OnBlock {
  readonly type: 'on_block';
}
export interface OnAllyDeployed {
  readonly type: 'on_ally_deployed';
  readonly filter?: TriggerFilter;
}
export interface OnAllyDestroyed {
  readonly type: 'on_ally_destroyed';
  readonly side?: Side;
  readonly filter?: TriggerFilter;
}
export interface OnSpellCast {
  readonly type: 'on_spell_cast';
  readonly side?: Side;
  readonly filter?: TriggerFilter;
}
export interface OnSacrifice {
  readonly type: 'on_sacrifice';
}
export interface OnHealed {
  readonly type: 'on_healed';
}
export interface OnEquipmentAttached {
  readonly type: 'on_equipment_attached';
}
export interface OnGainResource {
  readonly type: 'on_gain_resource';
  readonly resourceType?: ResourceType;
}
/** When any character gains stats (buff). Biotech Engineer. */
export interface OnStatModified {
  readonly type: 'on_stat_modified';
  readonly side?: Side;
}
/** Conditional aura — condition is required. For unconditional auras, use AuraAbilityDSL directly. */
export interface WhileCondition {
  readonly type: 'while';
  readonly condition: Condition;
}
export interface Activated {
  readonly type: 'activated';
  readonly cost: ResourceCost;
  readonly cooldown?: number;
  readonly oncePerTurn?: boolean;
  readonly oncePerGame?: boolean;
}
export interface OnCast {
  readonly type: 'on_cast';
}
export interface OnCounter {
  readonly type: 'on_counter';
}
export interface OnFlash {
  readonly type: 'on_flash';
}
export interface OnOverheal {
  readonly type: 'on_overheal';
}

export interface TriggerFilter {
  readonly cardType?: CardTypeCode;
  readonly trait?: Trait;
  readonly tag?: string;
}

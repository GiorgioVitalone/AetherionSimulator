/**
 * Game Action Types — discriminated union of all UI-dispatchable actions.
 *
 * These use descriptive client-facing names (e.g., 'deploy_character')
 * which the GameFlowController maps to the engine's shorter action names
 * (e.g., 'deploy') before sending to the XState machine.
 */
import type { ZoneType, PlayerResponse } from '@aetherion-sim/engine';

// ── Individual Action Types ─────────────────────────────────────────────────

export interface DeployCharacterAction {
  readonly type: 'deploy_character';
  readonly cardInstanceId: string;
  readonly zone: ZoneType;
  readonly slotIndex: number;
  readonly xValue?: number;
}

export interface CastSpellAction {
  readonly type: 'cast_spell';
  readonly cardInstanceId: string;
  readonly targetId?: string;
}

export interface AttachEquipmentAction {
  readonly type: 'attach_equipment';
  readonly cardInstanceId: string;
  readonly targetInstanceId: string;
}

export interface MoveCharacterAction {
  readonly type: 'move_character';
  readonly cardInstanceId: string;
  readonly toZone: ZoneType;
  readonly slotIndex: number;
}

export interface ActivateAbilityAction {
  readonly type: 'activate_ability';
  readonly cardInstanceId: string;
  readonly abilityIndex: number;
}

export interface ActivateHeroAbilityAction {
  readonly type: 'activate_hero_ability';
  readonly abilityIndex: number;
}

export interface DeclareAttackAction {
  readonly type: 'declare_attack';
  readonly attackerInstanceId: string;
  readonly targetId: string | 'hero';
}

export interface DiscardForEnergyAction {
  readonly type: 'discard_for_energy';
  readonly cardInstanceId: string;
}

export interface DeclareTransformationAction {
  readonly type: 'declare_transformation';
}

export interface EndPhaseAction {
  readonly type: 'end_phase';
}

export interface MulliganDecisionAction {
  readonly type: 'mulligan_decision';
  readonly playerId: 0 | 1;
  readonly keep: boolean;
}

export interface PlayerResponseAction {
  readonly type: 'player_response';
  readonly response: PlayerResponse;
}

export interface ConcedeAction {
  readonly type: 'concede';
  readonly playerId: 0 | 1;
}

// ── Discriminated Union ─────────────────────────────────────────────────────

export type GameAction =
  | DeployCharacterAction
  | CastSpellAction
  | AttachEquipmentAction
  | MoveCharacterAction
  | ActivateAbilityAction
  | ActivateHeroAbilityAction
  | DeclareAttackAction
  | DiscardForEnergyAction
  | DeclareTransformationAction
  | EndPhaseAction
  | MulliganDecisionAction
  | PlayerResponseAction
  | ConcedeAction;

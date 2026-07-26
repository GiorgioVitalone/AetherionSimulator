/**
 * State Machine Types — context, events, and player actions for XState v5.
 */
import type { GameState, PendingChoice, PlayerResponse } from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';
import type { TransitionResult } from '../transitions/types.js';

// ── Machine Context ─────────────────────────────────────────────────────────

export interface GameMachineContext {
  readonly gameState: GameState;
  readonly pendingChoice: PendingChoice | null;
  /** Most recent authoritative command result, observable by harness callers. */
  readonly lastTransition: TransitionResult | null;
}

// ── Player Actions ──────────────────────────────────────────────────────────

export type PlayerAction =
  | DeployAction
  | CastSpellAction
  | AttachEquipmentAction
  | RemoveEquipmentAction
  | TransferEquipmentAction
  | MoveAction
  | ActivateAbilityAction
  | DeclareAttackAction
  | DiscardForEnergyAction
  | DeclareTransformAction
  | TapReserveAction;

export interface DeployAction {
  readonly type: 'deploy';
  readonly cardInstanceId: string;
  readonly zone: ZoneType;
  readonly slotIndex: number;
  /** Variable cost (X) chosen for an X-cost card. The caller pays this many extra
   * resources on top of the base cost; threaded to effects as `context.xPaid`. */
  readonly xValue?: number;
}

export interface CastSpellAction {
  readonly type: 'cast_spell';
  readonly cardInstanceId: string;
  /** Variable cost (X) chosen for an X-cost spell — see DeployAction.xValue. */
  readonly xValue?: number;
  /** Caller-chosen target instanceIds for the spell's effects (e.g. which allied
   * body to sacrifice, which enemy to remove). Validated against each effect's
   * legal options at resolution; an illegal/empty selection falls back to the
   * engine's auto-target. Absent means "let the engine auto-resolve". */
  readonly selectedTargetIds?: readonly string[];
}

export interface AttachEquipmentAction {
  readonly type: 'attach_equipment';
  readonly cardInstanceId: string;
  readonly targetInstanceId: string;
  /** Variable cost (X) chosen for an X-cost equipment — see DeployAction.xValue. */
  readonly xValue?: number;
}

export interface RemoveEquipmentAction {
  readonly type: 'remove_equipment';
  /** Instance id of the attached equipment to voluntarily discard (Rulebook 13). */
  readonly equipmentInstanceId: string;
}

export interface TransferEquipmentAction {
  readonly type: 'transfer_equipment';
  /** Instance id of the attached equipment to move (Rulebook 13). */
  readonly equipmentInstanceId: string;
  /** Eligible destination character to receive the equipment. */
  readonly targetInstanceId: string;
}

export interface MoveAction {
  readonly type: 'move';
  readonly cardInstanceId: string;
  readonly toZone: ZoneType;
}

export interface ActivateAbilityAction {
  readonly type: 'activate_ability';
  readonly cardInstanceId: string;
  readonly abilityIndex: number;
  /** Variable cost (X) chosen for an X-cost activated ability — see DeployAction.xValue. */
  readonly xValue?: number;
}

export interface DeclareAttackAction {
  readonly type: 'declare_attack';
  readonly attackerInstanceId: string;
  readonly targetId: string;
}

export interface DiscardForEnergyAction {
  readonly type: 'discard_for_energy';
  readonly cardInstanceId: string;
}

export interface DeclareTransformAction {
  readonly type: 'declare_transform';
}

/** Exhaust a ready Reserve character for +1 temporary resource of its type
 * (Rulebook 8 step 4 — a CHOICE; offered only under `config.reserveTapChoice`).
 * All the character's abilities are disabled until next Upkeep; under
 * `reserveTapStrain` it also suffers 1 direct damage. */
export interface TapReserveAction {
  readonly type: 'tap_reserve';
  readonly cardInstanceId: string;
}

// ── Machine Events ──────────────────────────────────────────────────────────

export type GameMachineEvent =
  | { readonly type: 'MULLIGAN_DECISION'; readonly playerId: 0 | 1; readonly keep: boolean }
  | { readonly type: 'PLAYER_ACTION'; readonly action: PlayerAction }
  | {
      readonly type: 'PLAYER_RESPONSE';
      readonly interactionId?: string;
      readonly playerId?: 0 | 1;
      readonly response: PlayerResponse;
    }
  | { readonly type: 'REACTIVE_ACTION'; readonly action: PlayerAction }
  | { readonly type: 'PRIORITY_PASS' }
  | { readonly type: 'END_PHASE' }
  | { readonly type: 'CONCEDE'; readonly playerId: 0 | 1 };

/**
 * State Machine Types — context, events, and player actions for XState v5.
 */
import type {
  GameState,
  PendingChoice,
  PlayerResponse,
} from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';

// ── Machine Context ─────────────────────────────────────────────────────────

export interface GameMachineContext {
  readonly gameState: GameState;
  readonly pendingChoice: PendingChoice | null;
}

// ── Player Actions ──────────────────────────────────────────────────────────

export type PlayerAction =
  | DeployAction
  | CastSpellAction
  | AttachEquipmentAction
  | MoveAction
  | ActivateAbilityAction
  | DeclareAttackAction
  | DiscardForEnergyAction
  | DeclareTransformAction;

export interface DeployAction {
  readonly type: 'deploy';
  readonly cardInstanceId: string;
  readonly zone: ZoneType;
  readonly slotIndex: number;
}

export interface CastSpellAction {
  readonly type: 'cast_spell';
  readonly cardInstanceId: string;
}

export interface AttachEquipmentAction {
  readonly type: 'attach_equipment';
  readonly cardInstanceId: string;
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

export interface DeclareTransformAction {
  readonly type: 'declare_transform';
}

// ── Machine Events ──────────────────────────────────────────────────────────

export type GameMachineEvent =
  | { readonly type: 'MULLIGAN_DECISION'; readonly playerId: 0 | 1; readonly keep: boolean }
  | { readonly type: 'PLAYER_ACTION'; readonly action: PlayerAction }
  | { readonly type: 'PLAYER_RESPONSE'; readonly response: PlayerResponse }
  | { readonly type: 'END_PHASE' }
  | { readonly type: 'CONCEDE'; readonly playerId: 0 | 1 };

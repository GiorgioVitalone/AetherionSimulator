import type {
  GameEvent,
  GameState,
  PendingChoice,
  PendingPriority,
  PlayerResponse,
} from '../types/game-state.js';
import type { PlayerAction } from '../state-machine/types.js';

export type RuleViolationCode =
  | 'game_over'
  | 'phase'
  | 'priority'
  | 'controller'
  | 'source_zone'
  | 'card_kind'
  | 'cost'
  | 'readiness'
  | 'timing'
  | 'target'
  | 'choice'
  | 'cooldown'
  | 'once_limit'
  | 'transformation'
  | 'stale_window'
  | 'malformed_action'
  | 'not_legal';

export interface RuleViolation {
  readonly code: RuleViolationCode;
  readonly path: string;
  readonly message: string;
}

export interface EngineFailure {
  readonly code: 'internal_error' | 'guard_exhaustion' | 'invariant_failure';
  readonly message: string;
}

export type PendingInteraction = PendingChoice | PendingPriority;

export type EngineCommand =
  | {
      readonly type: 'mulligan_decision';
      readonly interactionId: string;
      readonly playerId: 0 | 1;
      readonly keep: boolean;
    }
  | { readonly type: 'advance_phase'; readonly playerId: 0 | 1 }
  | { readonly type: 'concede'; readonly playerId: 0 | 1 }
  | { readonly type: 'player_action'; readonly action: PlayerAction }
  | {
      readonly type: 'reactive_action';
      readonly windowId: string;
      readonly action: PlayerAction;
    }
  | { readonly type: 'priority_pass'; readonly windowId: string }
  | {
      readonly type: 'choice_response';
      readonly interactionId: string;
      readonly playerId: 0 | 1;
      readonly response: PlayerResponse;
    };

export type TransitionResult =
  | {
      readonly status: 'resolved';
      readonly state: GameState;
      readonly events: readonly GameEvent[];
      readonly actionId: string;
    }
  | {
      readonly status: 'pending';
      readonly state: GameState;
      readonly events: readonly GameEvent[];
      readonly interaction: PendingInteraction;
      readonly actionId: string;
    }
  | {
      readonly status: 'rejected';
      readonly state: GameState;
      readonly violations: readonly RuleViolation[];
      readonly events: readonly GameEvent[];
      readonly actionId: string;
    }
  | {
      readonly status: 'failed';
      readonly state: GameState;
      readonly failure: EngineFailure;
      readonly actionId: string;
    };

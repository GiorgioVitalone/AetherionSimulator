/**
 * Action Flow Store — manages multi-step interaction state.
 *
 * Flow: idle → card_selected → awaiting_zone | awaiting_target → dispatch → idle
 *
 * Separate from ui-store because action flow has its own lifecycle
 * with cancel/reset semantics tied to game actions, not visual state.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ZoneType } from '@aetherion-sim/engine';

// ── Valid Slot (for deployment targets) ────────────────────────────────────

export interface ValidSlot {
  readonly zone: ZoneType;
  readonly slotIndex: number;
}

// ── Action Intent (what the player wants to do with a selected card) ──────

export type ActionIntent =
  | 'deploy'
  | 'cast_spell'
  | 'attach_equipment'
  | 'remove_equipment'
  | 'transfer_equipment'
  | 'move'
  | 'activate_ability'
  | 'attack'
  | 'discard_for_energy';

// ── Flow States ────────────────────────────────────────────────────────────

export type ActionFlowState =
  | { readonly step: 'idle' }
  | {
      readonly step: 'card_selected';
      readonly cardInstanceId: string;
      readonly possibleActions: readonly ActionIntent[];
    }
  | {
      readonly step: 'awaiting_x_value';
      readonly cardInstanceId: string;
      readonly minX: number;
      readonly maxX: number;
      readonly validSlots: readonly ValidSlot[];
    }
  | {
      readonly step: 'awaiting_zone';
      readonly cardInstanceId: string;
      readonly actionType: 'deploy' | 'move';
      readonly validSlots: readonly ValidSlot[];
      readonly xValue?: number;
    }
  | {
      readonly step: 'awaiting_target';
      readonly cardInstanceId: string;
      readonly actionType: ActionIntent;
      readonly validTargets: readonly string[];
    };

// ── Store Shape ────────────────────────────────────────────────────────────

interface ActionFlowStore {
  readonly flowState: ActionFlowState;

  readonly selectCardFromHand: (
    cardInstanceId: string,
    possibleActions: readonly ActionIntent[],
  ) => void;
  readonly selectBattlefieldCard: (
    cardInstanceId: string,
    possibleActions: readonly ActionIntent[],
  ) => void;
  readonly setAwaitingXValue: (
    cardInstanceId: string,
    minX: number,
    maxX: number,
    validSlots: readonly ValidSlot[],
  ) => void;
  readonly setAwaitingZone: (
    cardInstanceId: string,
    actionType: 'deploy' | 'move',
    validSlots: readonly ValidSlot[],
    xValue?: number,
  ) => void;
  readonly setAwaitingTarget: (
    cardInstanceId: string,
    actionType: ActionIntent,
    validTargets: readonly string[],
  ) => void;
  readonly cancel: () => void;
  readonly reset: () => void;
}

const IDLE: ActionFlowState = { step: 'idle' };

// ── Store Creation ─────────────────────────────────────────────────────────

export const useActionFlowStore = create<ActionFlowStore>()(
  devtools(
    (set) => ({
      flowState: IDLE,

      selectCardFromHand: (cardInstanceId, possibleActions) => {
        set({
          flowState: { step: 'card_selected', cardInstanceId, possibleActions },
        });
      },

      selectBattlefieldCard: (cardInstanceId, possibleActions) => {
        set({
          flowState: { step: 'card_selected', cardInstanceId, possibleActions },
        });
      },

      setAwaitingXValue: (cardInstanceId, minX, maxX, validSlots) => {
        set({
          flowState: { step: 'awaiting_x_value', cardInstanceId, minX, maxX, validSlots },
        });
      },

      setAwaitingZone: (cardInstanceId, actionType, validSlots, xValue) => {
        set({
          flowState: { step: 'awaiting_zone', cardInstanceId, actionType, validSlots, xValue },
        });
      },

      setAwaitingTarget: (cardInstanceId, actionType, validTargets) => {
        set({
          flowState: { step: 'awaiting_target', cardInstanceId, actionType, validTargets },
        });
      },

      cancel: () => set({ flowState: IDLE }),

      reset: () => set({ flowState: IDLE }),
    }),
    { name: 'ActionFlowStore' },
  ),
);

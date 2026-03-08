/**
 * UI Store — ephemeral UI state that's separate from game state.
 *
 * This store holds hover/selection state, animation queues, and view
 * preferences. It never touches the engine or game logic.
 */
import { create } from 'zustand';
import type { ZoneType } from '@aetherion-sim/engine';

// ── Animation Events ────────────────────────────────────────────────────────

export interface AnimationEvent {
  readonly id: string;
  readonly type: 'deploy' | 'attack' | 'damage' | 'heal' | 'destroy' | 'move' | 'spell';
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly value?: number;
}

// ── Store Shape ─────────────────────────────────────────────────────────────

interface UiStore {
  readonly selectedCardId: string | null;
  readonly hoveredCardId: string | null;
  readonly hoveredZone: { readonly zone: ZoneType; readonly slot: number } | null;
  readonly animationQueue: readonly AnimationEvent[];
  readonly showGameLog: boolean;
  readonly viewingPlayer: 0 | 1;

  readonly selectCard: (id: string | null) => void;
  readonly hoverCard: (id: string | null) => void;
  readonly hoverZone: (zone: ZoneType, slot: number) => void;
  readonly clearHoveredZone: () => void;
  readonly toggleGameLog: () => void;
  readonly setViewingPlayer: (id: 0 | 1) => void;
  readonly enqueueAnimation: (event: AnimationEvent) => void;
  readonly dequeueAnimation: () => void;
}

// ── Store Creation ──────────────────────────────────────────────────────────

export const useUiStore = create<UiStore>()((set) => ({
  selectedCardId: null,
  hoveredCardId: null,
  hoveredZone: null,
  animationQueue: [],
  showGameLog: false,
  viewingPlayer: 0,

  selectCard: (id) => set({ selectedCardId: id }),

  hoverCard: (id) => set({ hoveredCardId: id }),

  hoverZone: (zone, slot) => set({ hoveredZone: { zone, slot } }),

  clearHoveredZone: () => set({ hoveredZone: null }),

  toggleGameLog: () => set((s) => ({ showGameLog: !s.showGameLog })),

  setViewingPlayer: (id) => set({ viewingPlayer: id }),

  enqueueAnimation: (event) =>
    set((s) => ({ animationQueue: [...s.animationQueue, event] })),

  dequeueAnimation: () =>
    set((s) => ({ animationQueue: s.animationQueue.slice(1) })),
}));

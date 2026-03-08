/**
 * Game Store — Zustand store bridging the GameFlowController to React.
 *
 * The store holds the latest GameState snapshot (replaced wholesale by the
 * controller), computes derived data (available actions, pending choices),
 * and exposes a dispatch() function for UI components.
 *
 * The GameFlowController is stored as a module-level variable (not in the store)
 * because XState actors are not serializable.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type {
  GameState,
  PlayerState,
  GamePhase,
  CardInstance,
  HeroState,
  ZoneState,
  PendingChoice,
  AvailableActions,
  ResourceCard,
  TemporaryResource,
} from '@aetherion-sim/engine';
import { computeAvailableActions } from '@aetherion-sim/engine';
import type { GameAction } from './actions';
import type { GameConfig } from '@/features/game-setup/game-config';
import { GameFlowController } from '@/machines/game-flow';
import { createRegistry } from '@/features/game-setup/registry-adapter';
import { getAllCards } from '@/features/game-setup/deck-loader';

// ── Module-level controller reference (not serializable → not in store) ────

let gameFlowController: GameFlowController | null = null;

// ── Store Shape ─────────────────────────────────────────────────────────────

interface GameStore {
  // State (replaced wholesale by the controller)
  readonly state: GameState | null;
  readonly availableActions: AvailableActions | null;
  readonly pendingChoice: PendingChoice | null;
  readonly isStarted: boolean;

  // Internal: called by controller callback
  readonly _updateState: (state: GameState) => void;
  // Internal: called by UI (e.g. "Return to Menu")
  readonly _reset: () => void;

  // Public API (called by UI)
  readonly dispatch: (action: GameAction) => void;
  readonly startGame: (config: GameConfig) => void;
}

// ── Store Creation ──────────────────────────────────────────────────────────

export const useGameStore = create<GameStore>()(
  devtools(
    (set) => ({
      state: null,
      availableActions: null,
      pendingChoice: null,
      isStarted: false,

      _updateState: (gameState: GameState) => {
        const actions = computeAvailableActions(gameState);
        set({
          state: gameState,
          availableActions: actions,
          pendingChoice: gameState.pendingChoice,
          isStarted: true,
        });
      },

      _reset: () => {
        gameFlowController?.stop();
        gameFlowController = null;
        set({
          state: null,
          availableActions: null,
          pendingChoice: null,
          isStarted: false,
        });
      },

      dispatch: (action: GameAction) => {
        gameFlowController?.dispatch(action);
      },

      startGame: (config: GameConfig) => {
        // Stop any existing game
        gameFlowController?.stop();

        // Load all cards and create registry
        const allCards = getAllCards();
        if (allCards.length === 0) {
          throw new Error(
            'Card data not loaded. Call initCardData() before startGame().',
          );
        }
        const registryWithAbilities = createRegistry(allCards);

        // Use provided deck selections
        const player1Deck = config.player1.deck;
        const player2Deck = config.player2.deck;

        // Create and start controller
        const { _updateState } = useGameStore.getState();

        gameFlowController = new GameFlowController({
          player1Deck,
          player2Deck,
          registryWithAbilities,
          seed: config.seed,
          onStateChange: _updateState,
        });

        gameFlowController.start();
      },
    }),
    { name: 'GameStore' },
  ),
);

// ── Selectors ───────────────────────────────────────────────────────────────

export function selectActivePlayer(store: GameStore): PlayerState | null {
  if (!store.state) return null;
  return store.state.players[store.state.activePlayerIndex];
}

export function selectOpponent(store: GameStore): PlayerState | null {
  if (!store.state) return null;
  const oppIndex = store.state.activePlayerIndex === 0 ? 1 : 0;
  return store.state.players[oppIndex];
}

export function selectPhase(store: GameStore): GamePhase | null {
  return store.state?.phase ?? null;
}

export function selectTurnNumber(store: GameStore): number {
  return store.state?.turnNumber ?? 0;
}

export function selectWinner(store: GameStore): 0 | 1 | 'draw' | null {
  return store.state?.winner ?? null;
}

export function selectHand(store: GameStore): readonly CardInstance[] {
  const player = selectActivePlayer(store);
  return player?.hand ?? [];
}

export function selectZones(store: GameStore): ZoneState | null {
  const player = selectActivePlayer(store);
  return player?.zones ?? null;
}

export function selectHero(store: GameStore): HeroState | null {
  const player = selectActivePlayer(store);
  return player?.hero ?? null;
}

export function selectResourceBank(store: GameStore): readonly ResourceCard[] {
  const player = selectActivePlayer(store);
  return player?.resourceBank ?? [];
}

export function selectTemporaryResources(store: GameStore): readonly TemporaryResource[] {
  const player = selectActivePlayer(store);
  return player?.temporaryResources ?? [];
}

export function selectPendingChoice(store: GameStore): PendingChoice | null {
  return store.pendingChoice;
}

export function selectCanDeploy(store: GameStore): boolean {
  return (store.availableActions?.canDeploy.length ?? 0) > 0;
}

export function selectCanAttack(store: GameStore): boolean {
  return (store.availableActions?.canAttack.length ?? 0) > 0;
}

export function selectCanEndPhase(store: GameStore): boolean {
  return store.availableActions?.canEndPhase ?? false;
}

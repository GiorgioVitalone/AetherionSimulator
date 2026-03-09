/**
 * Game Flow Controller — orchestration layer between UI and engine.
 *
 * Architecture: Plain class (not a React hook). The Zustand store creates it
 * on startGame() and holds a module-level reference. XState runs headlessly
 * via createActor — no @xstate/react needed.
 *
 * Responsibilities:
 * 1. Bridge game config → engine createGame()
 * 2. Hydrate abilities into the initial state
 * 3. Create and manage the XState actor
 * 4. Map client GameActions to engine machine events
 * 5. Push state snapshots to the store via onStateChange callback
 */
import { createActor, type Actor } from 'xstate';
import type {
  GameState,
  DeckSelection,
  GameMachineEvent,
} from '@aetherion-sim/engine';
import {
  gameMachine,
  createGame,
} from '@aetherion-sim/engine';
import type { GameAction } from '@/stores/actions';
import type { RegistryWithAbilities } from '@/features/game-setup/registry-adapter';
import { hydrateAbilities } from '@/features/game-setup/hydrate-abilities';

// ── Config ──────────────────────────────────────────────────────────────────

export interface GameFlowControllerConfig {
  readonly player1Deck: DeckSelection;
  readonly player2Deck: DeckSelection;
  readonly registryWithAbilities: RegistryWithAbilities;
  readonly seed?: number;
  readonly onStateChange: (state: GameState) => void;
}

// ── Controller ──────────────────────────────────────────────────────────────

export class GameFlowController {
  private actor: Actor<typeof gameMachine> | null = null;
  private readonly config: GameFlowControllerConfig;

  constructor(config: GameFlowControllerConfig) {
    this.config = config;
  }

  /**
   * Initialize the game: create state, hydrate abilities, start the actor.
   */
  start(): void {
    const { player1Deck, player2Deck, registryWithAbilities, seed, onStateChange } = this.config;
    const { registry, getAbilities, getHeroAbilities } = registryWithAbilities;

    // 1. Create raw game state (abilities are empty [])
    const rawState = createGame(player1Deck, player2Deck, registry, seed);

    // 2. Hydrate abilities from registry
    const hydratedState = hydrateAbilities(rawState, getAbilities, getHeroAbilities);

    // 3. Create XState actor with hydrated state as input
    this.actor = createActor(gameMachine, {
      input: { gameState: hydratedState },
    });

    // 4. Subscribe to state changes — push snapshots to the store.
    //    XState v5: subscribe before start ensures the initial snapshot is
    //    delivered synchronously when start() is called — no manual push needed.
    this.actor.subscribe(snapshot => {
      onStateChange(snapshot.context.gameState);
    });

    // 5. Start the actor (emits initial snapshot to subscriber above)
    this.actor.start();
  }

  /**
   * Map a client GameAction to an engine machine event and dispatch it.
   */
  dispatch(action: GameAction): void {
    if (!this.actor) return;

    const event = mapActionToEvent(action);
    if (event) {
      this.actor.send(event);
    }
  }

  /**
   * Stop the XState actor and clean up.
   */
  stop(): void {
    this.actor?.stop();
    this.actor = null;
  }
}

// ── Action Mapping ──────────────────────────────────────────────────────────

function mapActionToEvent(action: GameAction): GameMachineEvent | null {
  switch (action.type) {
    case 'deploy_character':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'deploy',
          cardInstanceId: action.cardInstanceId,
          zone: action.zone,
          slotIndex: action.slotIndex,
        },
      };

    case 'cast_spell':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'cast_spell',
          cardInstanceId: action.cardInstanceId,
          targetId: action.targetId,
        },
      };

    case 'attach_equipment':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'attach_equipment',
          cardInstanceId: action.cardInstanceId,
          targetInstanceId: action.targetInstanceId,
        },
      };

    case 'move_character':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'move',
          cardInstanceId: action.cardInstanceId,
          toZone: action.toZone,
          slotIndex: action.slotIndex,
        },
      };

    case 'activate_ability':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'activate_ability',
          cardInstanceId: action.cardInstanceId,
          abilityIndex: action.abilityIndex,
        },
      };

    case 'activate_hero_ability':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'activate_hero_ability',
          abilityIndex: action.abilityIndex,
        },
      };

    case 'declare_attack':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'declare_attack',
          attackerInstanceId: action.attackerInstanceId,
          targetId: action.targetId,
        },
      };

    case 'discard_for_energy':
      return {
        type: 'PLAYER_ACTION',
        action: {
          type: 'discard_for_energy',
          cardInstanceId: action.cardInstanceId,
        },
      };

    case 'declare_transformation':
      return {
        type: 'PLAYER_ACTION',
        action: { type: 'declare_transform' },
      };

    case 'end_phase':
      return { type: 'END_PHASE' };

    case 'mulligan_decision':
      return {
        type: 'MULLIGAN_DECISION',
        playerId: action.playerId,
        keep: action.keep,
      };

    case 'player_response':
      return {
        type: 'PLAYER_RESPONSE',
        response: action.response,
      };

    case 'concede':
      return {
        type: 'CONCEDE',
        playerId: action.playerId,
      };
  }
}

/**
 * Game Setup — initializes a full GameState from two deck selections.
 * Handles deck loading, shuffling, initial draw, and mulligan flow.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  HeroState,
  ResourceCard,
  RngState,
} from '../types/game-state.js';
import type { ResourceCost, CardTypeCode, ResourceType } from '../types/common.js';
import { createEmptyZoneState } from '../zones/zone-manager.js';
import { createRng, shuffle, randomInt } from './rng.js';
import { normalizeTraits } from './trait-normalizer.js';
import { INITIAL_HAND_SIZE, MULLIGAN_HAND_SIZE } from '../types/game-state.js';
import { CURRENT_GAME_CONFIG } from '../rules/manifest.js';

// ── Card Definition (minimal interface for setup) ─────────────────────────────

export interface CardDefinition {
  readonly id: number;
  readonly name: string;
  readonly cardType: CardTypeCode;
  readonly cost: ResourceCost;
  readonly stats?: { readonly hp: number; readonly atk: number; readonly arm?: number };
  readonly traits?: readonly string[];
  readonly tags?: readonly string[];
  readonly alignment?: readonly string[];
  readonly xCostResource?: ResourceType;
  readonly resourceType?: 'mana' | 'energy';
}

export interface HeroDefinition {
  readonly id: number;
  readonly name: string;
  readonly lp: number;
  readonly alignment?: readonly string[];
}

export interface DeckSelection {
  readonly heroDefId: number;
  readonly mainDeckDefIds: readonly number[];
  readonly resourceDeckDefIds: readonly number[];
}

export interface CardDefinitionRegistry {
  readonly getCard: (id: number) => CardDefinition | undefined;
  readonly getHero: (id: number) => HeroDefinition | undefined;
}

export interface GameSetupOptions {
  readonly resourceDeckSize?: number;
  readonly strictResourceTypes?: boolean;
}

// ── Instance Counter ──────────────────────────────────────────────────────────

let instanceCounter = 0;

function nextInstanceId(): string {
  instanceCounter++;
  return `inst_${String(instanceCounter)}`;
}

export function resetSetupInstanceCounter(): void {
  instanceCounter = 0;
}

// ── Card Instance Creation ────────────────────────────────────────────────────

function createCardInstance(def: CardDefinition, owner: 0 | 1): CardInstance {
  const { traits, statusEffects, rushValue, recycleValue } = normalizeTraits(def.traits);
  return {
    ...(rushValue !== undefined ? { rushValue } : {}),
    ...(recycleValue !== undefined ? { recycleValue } : {}),
    instanceId: nextInstanceId(),
    cardDefId: def.id,
    name: def.name,
    cardType: def.cardType,
    currentHp: def.stats?.hp ?? 0,
    currentAtk: def.stats?.atk ?? 0,
    currentArm: def.stats?.arm ?? 0,
    baseHp: def.stats?.hp ?? 0,
    baseAtk: def.stats?.atk ?? 0,
    baseArm: def.stats?.arm ?? 0,
    exhausted: false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
    traits,
    grantedTraits: [],
    abilities: [],
    registeredTriggers: [],
    modifiers: [],
    statusEffects,
    equipment: null,
    isToken: false,
    tags: def.tags ?? [],
    cost: def.cost,
    ...(def.xCostResource !== undefined ? { xCostResource: def.xCostResource } : {}),
    alignment: def.alignment ?? [],
    owner,
  };
}

function createHeroState(def: HeroDefinition): HeroState {
  return {
    cardDefId: def.id,
    name: def.name,
    currentArm: 0,
    currentLp: def.lp,
    maxLp: def.lp,
    transformed: false,
    canTransformThisGame: true,
    transformedThisTurn: false,
    abilities: [],
    registeredTriggers: [],
  };
}

function createResourceCard(resourceType: 'mana' | 'energy'): ResourceCard {
  return {
    instanceId: nextInstanceId(),
    resourceType,
    exhausted: false,
  };
}

// ── Game Initialization ───────────────────────────────────────────────────────

export function createGame(
  player1: DeckSelection,
  player2: DeckSelection,
  registry: CardDefinitionRegistry,
  seed?: number,
  setupOptions?: GameSetupOptions,
): GameState {
  resetSetupInstanceCounter();
  const rng = createRng(seed ?? Date.now());

  const { player: p1, nextRng: rng1 } = buildPlayerState(player1, registry, 0, rng, setupOptions);
  const { player: p2, nextRng: rng2 } = buildPlayerState(player2, registry, 1, rng1, setupOptions);

  // Determine first player randomly
  const { value: firstPlayer, nextRng: rng3 } = randomInt(rng2, 0, 1);

  return {
    players: [p1, p2],
    activePlayerIndex: firstPlayer as 0 | 1,
    turnNumber: 1,
    phase: 'mulligan',
    stack: [],
    pendingChoice: {
      type: 'mulligan',
      playerId: 0,
      options: [
        { id: 'keep', label: 'Keep hand' },
        { id: 'mulligan', label: 'Mulligan (redraw 4 cards)' },
      ],
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose whether to keep your opening hand or mulligan.',
    },
    log: [],
    winner: null,
    rng: rng3,
    eventSequence: 0,
    turnState: {
      discardedForEnergy: false,
      firstPlayerFirstTurn: true,
    },
  };
}

/**
 * Canonical current-rules constructor.
 *
 * `createGame` remains the low-level/legacy-compatible constructor during the
 * public-API migration. New normal callers must use this constructor so rules
 * cannot silently fall back to absent configuration.
 */
export function createCurrentGame(
  player1: DeckSelection,
  player2: DeckSelection,
  registry: CardDefinitionRegistry,
  seed?: number,
): GameState {
  const state = createGame(player1, player2, registry, seed, {
    resourceDeckSize: CURRENT_GAME_CONFIG.resourceDeckSize,
    strictResourceTypes: true,
  });
  const choice = state.pendingChoice;
  if (choice === null || choice.type !== 'mulligan') {
    return {
      ...state,
      config: CURRENT_GAME_CONFIG,
      auraDerivation: { sourceKeys: [], contributionKeys: [] },
    };
  }
  const interactionId = [
    'mulligan',
    state.rng.seed,
    state.turnNumber,
    choice.playerId,
  ].join(':');
  return {
    ...state,
    config: CURRENT_GAME_CONFIG,
    auraDerivation: { sourceKeys: [], contributionKeys: [] },
    pendingChoice: {
      ...choice,
      interactionId,
      validationToken: interactionId,
      visibility: 'controller',
      optional: false,
    },
  };
}

function buildPlayerState(
  deck: DeckSelection,
  registry: CardDefinitionRegistry,
  owner: 0 | 1,
  rng: RngState,
  setupOptions?: GameSetupOptions,
): {
  readonly player: PlayerState;
  readonly nextRng: RngState;
} {
  // Load hero
  const heroDef = registry.getHero(deck.heroDefId);
  if (heroDef === undefined) {
    throw new Error(`Hero definition not found: ${String(deck.heroDefId)}`);
  }
  const hero = createHeroState(heroDef);

  // Load main deck cards
  const mainCards = deck.mainDeckDefIds.map((id) => {
    const def = registry.getCard(id);
    if (def === undefined) {
      throw new Error(`Card definition not found: ${String(id)}`);
    }
    return createCardInstance(def, owner);
  });

  // Load resource deck
  const resourceCards = deck.resourceDeckDefIds.map((id) => {
    const def = registry.getCard(id);
    if (def === undefined) {
      throw new Error(`Resource definition not found: ${String(id)}`);
    }
    if (def.cardType !== 'R') {
      throw new Error(`Definition ${String(id)} is not a Resource card`);
    }
    const resourceType =
      def.resourceType ??
      (setupOptions?.strictResourceTypes === true
        ? (() => {
            throw new Error(
              `Resource definition ${String(id)} is missing explicit resourceType`,
            );
          })()
        : guessResourceType(def));
    return createResourceCard(resourceType);
  });

  // Shuffle both decks
  const { result: shuffledMain, nextRng: rng1 } = shuffle(mainCards, rng);
  const { result: shuffledFullResource, nextRng: rng2 } = shuffle(resourceCards, rng1);
  // §13o rules variant: truncate the Resource Deck AFTER the shuffle (preserves
  // the deck's resource-type mix in expectation). Absent ⇒ full deck, unchanged.
  const size = setupOptions?.resourceDeckSize;
  const shuffledResource =
    size !== undefined && size > 0 && size < shuffledFullResource.length
      ? shuffledFullResource.slice(0, size)
      : shuffledFullResource;

  // Draw initial hand (5 cards)
  const handSize = Math.min(INITIAL_HAND_SIZE, shuffledMain.length);
  const hand = shuffledMain.slice(0, handSize);
  const remainingDeck = shuffledMain.slice(handSize);

  return {
    player: {
      hero,
      zones: createEmptyZoneState(),
      hand,
      mainDeck: remainingDeck,
      resourceDeck: shuffledResource,
      resourceBank: [],
      discardPile: [],
      exile: [],
      temporaryResources: [],
      turnCounters: {
        spellsCast: 0,
        equipmentPlayed: 0,
        charactersDeployed: 0,
        abilitiesActivated: 0,
      },
    },
    nextRng: rng2,
  };
}

function guessResourceType(def: CardDefinition): 'mana' | 'energy' {
  // If the card has a name suggesting energy, use energy
  const lowerName = def.name.toLowerCase();
  if (lowerName.includes('energy') || lowerName.includes('tech')) {
    return 'energy';
  }
  return 'mana';
}

// ── Mulligan ──────────────────────────────────────────────────────────────────

export function applyMulligan(state: GameState, playerId: 0 | 1, keepHand: boolean): GameState {
  if (keepHand) {
    return advanceMulligan(state, playerId);
  }

  const player = state.players[playerId];

  // Shuffle hand back into deck
  const { result: reshuffled, nextRng } = shuffle([...player.hand, ...player.mainDeck], state.rng);

  // Draw mulligan hand (4 cards)
  const handSize = Math.min(MULLIGAN_HAND_SIZE, reshuffled.length);
  const newHand = reshuffled.slice(0, handSize);
  const newDeck = reshuffled.slice(handSize);

  const newPlayer: PlayerState = {
    ...player,
    hand: newHand,
    mainDeck: newDeck,
  };

  const newPlayers = [...state.players] as [PlayerState, PlayerState];
  newPlayers[playerId] = newPlayer;

  return advanceMulligan({ ...state, players: newPlayers, rng: nextRng }, playerId);
}

function advanceMulligan(state: GameState, completedPlayerId: 0 | 1): GameState {
  if (completedPlayerId === 0) {
    // Player 1 still needs to mulligan
    return {
      ...state,
      pendingChoice: {
        type: 'mulligan',
        playerId: 1,
        options: [
          { id: 'keep', label: 'Keep hand' },
          { id: 'mulligan', label: 'Mulligan (redraw 4 cards)' },
        ],
        minSelections: 1,
        maxSelections: 1,
        context: 'Choose whether to keep your opening hand or mulligan.',
      },
    };
  }

  // The random setup winner chooses who goes first only after both mulligans.
  // The current profile exposes that decision; legacy profiles preserve their
  // historical behavior where the random winner silently becomes first player.
  if (state.config?.explicitFirstPlayerChoice === true) {
    const chooser = state.activePlayerIndex;
    const interactionId = [
      'choose-first-player',
      state.rng.seed,
      state.turnNumber,
      chooser,
    ].join(':');
    return {
      ...state,
      pendingChoice: {
        interactionId,
        validationToken: interactionId,
        type: 'choose_first_player',
        playerId: chooser,
        options: [
          { id: 'player_0', label: 'Player 1 goes first' },
          { id: 'player_1', label: 'Player 2 goes first' },
        ],
        minSelections: 1,
        maxSelections: 1,
        context: 'Choose which player goes first.',
        optional: false,
        visibility: 'public',
      },
    };
  }
  return chooseFirstPlayer(state, state.activePlayerIndex);
}

/** Resolve setup's first-player choice and the dependent second-player card. */
export function chooseFirstPlayer(
  state: GameState,
  firstPlayerId: 0 | 1,
): GameState {
  const ready: GameState = {
    ...state,
    activePlayerIndex: firstPlayerId,
    phase: 'upkeep',
    pendingChoice: null,
  };
  if (state.config?.secondPlayerOpeningCard !== true) return ready;

  const secondPlayerId: 0 | 1 = firstPlayerId === 0 ? 1 : 0;
  const secondPlayer = ready.players[secondPlayerId];
  const bonusCard = secondPlayer.mainDeck[0];
  if (bonusCard === undefined) return ready;
  const players = [...ready.players] as [PlayerState, PlayerState];
  players[secondPlayerId] = {
    ...secondPlayer,
    hand: [...secondPlayer.hand, bonusCard],
    mainDeck: secondPlayer.mainDeck.slice(1),
  };
  return { ...ready, players };
}

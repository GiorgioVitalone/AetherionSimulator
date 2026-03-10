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
} from '../types/game-state.js';
import type { ResourceCost, CardTypeCode } from '../types/common.js';
import { createEmptyZoneState } from '../zones/zone-manager.js';
import { createRng, shuffle, randomInt } from './rng.js';
import { INITIAL_HAND_SIZE, MULLIGAN_HAND_SIZE } from '../types/game-state.js';

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
  readonly artUrl?: string | null;
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

function createCardInstance(
  def: CardDefinition,
  owner: 0 | 1,
): CardInstance {
  return {
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
    traits: (def.traits ?? []) as CardInstance['traits'],
    grantedTraits: [],
    abilities: [],
    registeredTriggers: [],
    modifiers: [],
    statusEffects: [],
    equipment: null,
    isToken: false,
    tags: def.tags ?? [],
    cost: def.cost,
    alignment: def.alignment ?? [],
    artUrl: def.artUrl ?? null,
    owner,
  };
}

function createHeroState(def: HeroDefinition): HeroState {
  return {
    cardDefId: def.id,
    name: def.name,
    currentLp: def.lp,
    maxLp: def.lp,
    transformed: false,
    canTransformThisGame: true,
    transformedThisTurn: false,
    abilities: [],
    cooldowns: new Map(),
    registeredTriggers: [],
  };
}

function createResourceCard(
  resourceType: 'mana' | 'energy',
): ResourceCard {
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
): GameState {
  resetSetupInstanceCounter();
  const rng = createRng(seed ?? Date.now());

  const { player: p1, nextRng: rng1 } = buildPlayerState(
    player1,
    registry,
    0,
    rng,
  );
  const { player: p2, nextRng: rng2 } = buildPlayerState(
    player2,
    registry,
    1,
    rng1,
  );

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
    pendingResolution: null,
    log: [],
    winner: null,
    rng: rng3,
    turnState: {
      discardedForEnergy: false,
      firstPlayerFirstTurn: true,
    },
    scheduledEffects: [],
  };
}

function buildPlayerState(
  deck: DeckSelection,
  registry: CardDefinitionRegistry,
  owner: 0 | 1,
  rng: import('../types/game-state.js').RngState,
): {
  readonly player: PlayerState;
  readonly nextRng: import('../types/game-state.js').RngState;
} {
  // Load hero
  const heroDef = registry.getHero(deck.heroDefId);
  if (heroDef === undefined) {
    throw new Error(`Hero definition not found: ${String(deck.heroDefId)}`);
  }
  const hero = createHeroState(heroDef);

  // Load main deck cards
  const mainCards = deck.mainDeckDefIds.map(id => {
    const def = registry.getCard(id);
    if (def === undefined) {
      throw new Error(`Card definition not found: ${String(id)}`);
    }
    return createCardInstance(def, owner);
  });

  // Load resource deck
  const resourceCards = deck.resourceDeckDefIds.map(id => {
    // Determine resource type from card definition
    const def = registry.getCard(id);
    const resourceType =
      def !== undefined && def.cardType === 'R'
        ? guessResourceType(def)
        : 'mana';
    return createResourceCard(resourceType);
  });

  // Shuffle both decks
  const { result: shuffledMain, nextRng: rng1 } = shuffle(mainCards, rng);
  const { result: shuffledResource, nextRng: rng2 } = shuffle(
    resourceCards,
    rng1,
  );

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
      exileZone: [],
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

export function applyMulligan(
  state: GameState,
  playerId: 0 | 1,
  keepHand: boolean,
): GameState {
  if (keepHand) {
    return advanceMulligan(state, playerId);
  }

  const player = state.players[playerId]!;

  // Shuffle hand back into deck
  const { result: reshuffled, nextRng } = shuffle(
    [...player.hand, ...player.mainDeck],
    state.rng,
  );

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

  return advanceMulligan(
    { ...state, players: newPlayers, rng: nextRng },
    playerId,
  );
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

  // Both players done — transition to upkeep
  return {
    ...state,
    phase: 'upkeep',
    pendingChoice: null,
  };
}

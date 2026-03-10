/**
 * Game Setup — initializes a full GameState from two deck selections.
 * Handles deck loading, shuffling, initial draw, and mulligan flow.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  HeroState,
  HeroTransformState,
  ResourceCard,
} from '../types/game-state.js';
import type {
  CardTypeCode,
  PrintedResourceType,
  Rarity,
  ResourceCost,
} from '../types/common.js';
import type { AbilityDSL } from '../types/ability.js';
import { createEmptyZoneState } from '../zones/zone-manager.js';
import { createRng, shuffle, randomInt } from './rng.js';
import {
  INITIAL_HAND_SIZE,
  MULLIGAN_HAND_SIZE,
  RESOURCE_DECK_SIZE,
} from '../types/game-state.js';

// ── Card Definition (minimal interface for setup) ─────────────────────────────

export interface CardDefinition {
  readonly id: number;
  readonly name: string;
  readonly cardType: CardTypeCode;
  readonly rarity: Rarity;
  readonly cost: ResourceCost;
  readonly stats?: { readonly hp: number; readonly atk: number; readonly arm?: number };
  readonly traits?: readonly string[];
  readonly tags?: readonly string[];
  readonly alignment?: readonly string[];
  readonly resourceTypes?: readonly PrintedResourceType[];
  readonly resourceType?: PrintedResourceType;
  readonly artUrl?: string | null;
  readonly transformsInto?: number | null;
  readonly abilities?: readonly AbilityDSL[];
}

export interface HeroDefinition {
  readonly id: number;
  readonly name: string;
  readonly lp: number;
  readonly rarity: Rarity;
  readonly alignment?: readonly string[];
  readonly resourceTypes: readonly PrintedResourceType[];
  readonly transformsInto?: number | null;
  readonly abilities?: readonly AbilityDSL[];
}

export interface DeckSelection {
  readonly heroDefId: number;
  readonly mainDeckDefIds: readonly number[];
  readonly resourceDeckDefIds: readonly number[];
  readonly primaryAlignment?: string;
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
    rarity: def.rarity,
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
    abilities: def.abilities ?? [],
    abilityCooldowns: new Map(),
    activatedAbilityTurns: new Map(),
    registeredTriggers: [],
    modifiers: [],
    statusEffects: [],
    equipment: null,
    isToken: false,
    tags: def.tags ?? [],
    cost: def.cost,
    resourceTypes: def.resourceTypes ?? inferResourceTypes(def.cost),
    alignment: def.alignment ?? [],
    artUrl: def.artUrl ?? null,
    owner,
    abilitiesSuppressed: false,
    transferredThisTurn: false,
  };
}

function createHeroState(
  def: HeroDefinition,
  registry: CardDefinitionRegistry,
): HeroState {
  return {
    cardDefId: def.id,
    name: def.name,
    currentLp: def.lp,
    maxLp: def.lp,
    alignment: def.alignment ?? [],
    resourceTypes: def.resourceTypes,
    transformedCardDefId: def.transformsInto ?? null,
    transformDefinition: createHeroTransformState(def, registry),
    transformed: false,
    canTransformThisGame: true,
    transformedThisTurn: false,
    abilities: def.abilities ?? [],
    cooldowns: new Map(),
    activatedAbilityTurns: new Map(),
    usedUltimateAbilityIndices: [],
    modifiers: [],
    statusEffects: [],
    registeredTriggers: [],
  };
}

function createHeroTransformState(
  def: HeroDefinition,
  registry: CardDefinitionRegistry,
): HeroTransformState | null {
  if (def.transformsInto === undefined || def.transformsInto === null) {
    return null;
  }

  const transformedDef = registry.getHero(def.transformsInto);
  if (transformedDef === undefined) {
    return null;
  }

  return {
    cardDefId: transformedDef.id,
    name: transformedDef.name,
    maxLp: transformedDef.lp,
    alignment: transformedDef.alignment ?? [],
    resourceTypes: transformedDef.resourceTypes,
    abilities: transformedDef.abilities ?? [],
  };
}

function createResourceCard(
  resourceType: PrintedResourceType,
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
  validateDeckSelection(player1, registry);
  validateDeckSelection(player2, registry);

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

  const { value: firstPlayerChooser, nextRng: rng3 } = randomInt(rng2, 0, 1);

  return {
    players: [p1, p2],
    activePlayerIndex: 0,
    firstPlayerChooserId: firstPlayerChooser as 0 | 1,
    firstPlayerId: null,
    priorityPlayerId: null,
    turnNumber: 1,
    phase: 'mulligan',
    stack: [],
    responseState: null,
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
  const hero = createHeroState(heroDef, registry);

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
    const def = registry.getCard(id);
    const resourceType = def?.resourceType ?? 'mana';
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
      auraZone: [],
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
    phase: 'setup',
    pendingChoice: {
      type: 'choose_first_player',
      playerId: state.firstPlayerChooserId,
      options: [
        { id: 'player_0', label: 'Player 1 goes first' },
        { id: 'player_1', label: 'Player 2 goes first' },
      ],
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose which player takes the first turn.',
    },
  };
}

const COPY_LIMITS: Readonly<Record<Rarity, number>> = {
  Common: 3,
  Ethereal: 2,
  Mythic: 2,
  Legendary: 1,
};

function validateDeckSelection(
  deck: DeckSelection,
  registry: CardDefinitionRegistry,
): void {
  const heroDef = registry.getHero(deck.heroDefId);
  if (heroDef === undefined) {
    throw new Error(`Hero definition not found: ${String(deck.heroDefId)}`);
  }

  if (deck.mainDeckDefIds.length < 40 || deck.mainDeckDefIds.length > 60) {
    throw new Error('Main deck must contain between 40 and 60 cards.');
  }
  if (deck.resourceDeckDefIds.length !== RESOURCE_DECK_SIZE) {
    throw new Error(`Resource deck must contain exactly ${String(RESOURCE_DECK_SIZE)} cards.`);
  }

  const mainCards = deck.mainDeckDefIds.map(id => {
    const def = registry.getCard(id);
    if (def === undefined) {
      throw new Error(`Card definition not found: ${String(id)}`);
    }
    if (def.cardType === 'H' || def.cardType === 'T' || def.cardType === 'R') {
      throw new Error(`Main deck cannot include ${def.cardType} cards (${def.name}).`);
    }
    return def;
  });

  for (const id of deck.resourceDeckDefIds) {
    const def = registry.getCard(id);
    if (def === undefined) {
      throw new Error(`Card definition not found: ${String(id)}`);
    }
    if (def.cardType !== 'R') {
      throw new Error(`Resource deck can only include resource cards (${def.name}).`);
    }
    if (def.resourceType !== undefined && !heroDef.resourceTypes.includes(def.resourceType)) {
      throw new Error(`${def.name} does not match the Hero's resource type.`);
    }
  }

  const copyCounts = new Map<number, number>();
  for (const card of mainCards) {
    const nextCount = (copyCounts.get(card.id) ?? 0) + 1;
    copyCounts.set(card.id, nextCount);
    if (nextCount > COPY_LIMITS[card.rarity]) {
      throw new Error(`${card.name} exceeds the ${card.rarity} copy limit.`);
    }
  }

  const heroAlignments = heroDef.alignment ?? [];
  const primaryAlignment = inferPrimaryAlignment(deck, heroDef, mainCards);
  const secondaryAlignment = heroAlignments.find(alignment => alignment !== primaryAlignment) ?? null;

  for (const card of mainCards) {
    if (card.alignment !== undefined && card.alignment.length > 0) {
      const matchingAlignments = card.alignment.filter(alignment => heroAlignments.includes(alignment));
      if (matchingAlignments.length === 0) {
        throw new Error(`${card.name} does not match the Hero's alignment.`);
      }
      if (
        secondaryAlignment !== null &&
        matchingAlignments.includes(secondaryAlignment) &&
        !matchingAlignments.includes(primaryAlignment) &&
        (card.rarity === 'Mythic' || card.rarity === 'Legendary')
      ) {
        throw new Error(`${card.name} is too rare for the secondary alignment.`);
      }
    }

    if (
      card.resourceTypes !== undefined &&
      card.resourceTypes.some(resourceType => !heroDef.resourceTypes.includes(resourceType))
    ) {
      throw new Error(`${card.name} does not match the Hero's resource type.`);
    }
  }
}

function inferPrimaryAlignment(
  deck: DeckSelection,
  heroDef: HeroDefinition,
  mainCards: readonly CardDefinition[],
): string {
  const heroAlignments = heroDef.alignment ?? [];
  if (heroAlignments.length <= 1) {
    return heroAlignments[0] ?? '';
  }
  if (deck.primaryAlignment !== undefined && heroAlignments.includes(deck.primaryAlignment)) {
    return deck.primaryAlignment;
  }

  for (const candidate of heroAlignments) {
    const valid = mainCards.every(card => {
      if (card.alignment === undefined || card.alignment.length === 0 || card.alignment.includes(candidate)) {
        return true;
      }
      const intersectsHero = card.alignment.some(alignment => heroAlignments.includes(alignment));
      if (!intersectsHero) {
        return false;
      }
      return card.rarity === 'Common' || card.rarity === 'Ethereal';
    });
    if (valid) {
      return candidate;
    }
  }

  throw new Error('Deck does not satisfy dual-alignment restrictions.');
}

function inferResourceTypes(cost: ResourceCost): readonly PrintedResourceType[] {
  const resourceTypes: PrintedResourceType[] = [];
  if (cost.mana > 0 || cost.xMana === true) {
    resourceTypes.push('mana');
  }
  if (cost.energy > 0 || cost.xEnergy === true) {
    resourceTypes.push('energy');
  }
  return resourceTypes;
}

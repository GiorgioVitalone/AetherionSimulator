/**
 * Test helpers — factory functions for creating mock game objects.
 */
import type {
  CardInstance,
  GameState,
  HeroState,
  PlayerState,
  ZoneState,
} from '../../src/types/game-state.js';
import type { CardTypeCode, ResourceCost, Trait } from '../../src/types/common.js';

let instanceCounter = 0;

export function resetInstanceCounter(): void {
  instanceCounter = 0;
}

export function mockCard(overrides?: Partial<CardInstance>): CardInstance {
  instanceCounter++;
  return {
    instanceId: `card_${String(instanceCounter)}`,
    cardDefId: instanceCounter,
    name: `Test Card ${String(instanceCounter)}`,
    cardType: 'C' as CardTypeCode,
    currentHp: 3,
    currentAtk: 2,
    currentArm: 0,
    baseHp: 3,
    baseAtk: 2,
    baseArm: 0,
    exhausted: false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
    traits: [],
    grantedTraits: [],
    abilities: [],
    registeredTriggers: [],
    modifiers: [],
    statusEffects: [],
    equipment: null,
    isToken: false,
    tags: [],
    cost: { mana: 1, energy: 0, flexible: 0 },
    alignment: ['Onyx'],
    artUrl: null,
    owner: 0,
    ...overrides,
  };
}

export function mockCardWithTraits(
  traits: readonly Trait[],
  overrides?: Partial<CardInstance>,
): CardInstance {
  return mockCard({ traits: [...traits], ...overrides });
}

export function mockHero(overrides?: Partial<HeroState>): HeroState {
  return {
    cardDefId: 100,
    name: 'Test Hero',
    currentLp: 25,
    maxLp: 25,
    transformed: false,
    canTransformThisGame: true,
    transformedThisTurn: false,
    abilities: [],
    cooldowns: new Map(),
    registeredTriggers: [],
    ...overrides,
  };
}

export function emptyZones(): ZoneState {
  return {
    reserve: [null, null],
    frontline: [null, null, null],
    highGround: [null, null],
  };
}

export function zonesWithCards(placements: {
  reserve?: readonly (CardInstance | null)[];
  frontline?: readonly (CardInstance | null)[];
  highGround?: readonly (CardInstance | null)[];
}): ZoneState {
  return {
    reserve: placements.reserve ?? [null, null],
    frontline: placements.frontline ?? [null, null, null],
    highGround: placements.highGround ?? [null, null],
  };
}

export const ZERO_COST: ResourceCost = { mana: 0, energy: 0, flexible: 0 };

export function mockGameState(overrides?: Partial<GameState>): GameState {
  return {
    players: [mockPlayerState(0), mockPlayerState(1)],
    activePlayerIndex: 0,
    turnNumber: 1,
    phase: 'action',
    stack: [],
    pendingChoice: null,
    pendingResolution: null,
    log: [],
    winner: null,
    rng: { seed: 42, counter: 0 },
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
    scheduledEffects: [],
    ...overrides,
  };
}

export function mockPlayerState(owner: 0 | 1, overrides?: Partial<PlayerState>): PlayerState {
  return {
    hero: mockHero(),
    zones: emptyZones(),
    hand: [],
    mainDeck: [],
    resourceDeck: [],
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
    ...overrides,
  };
}

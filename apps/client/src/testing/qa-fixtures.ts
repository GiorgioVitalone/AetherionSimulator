import type { SimCard } from '@aetherion-sim/cards';
import type { GameState, PendingChoice } from '@aetherion-sim/engine';
import {
  computeAvailableActions,
  createGame,
} from '@aetherion-sim/engine';
import { buildStarterDeck } from '@/features/game-setup/deck-loader';
import { hydrateAbilities } from '@/features/game-setup/hydrate-abilities';
import { createRegistry } from '@/features/game-setup/registry-adapter';
import { useActionFlowStore } from '@/stores/action-flow-store';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';

export type QaFixtureId =
  | 'transform-ready'
  | 'response-window'
  | 'aura-zone'
  | 'animation-preview'
  | 'game-over';

declare global {
  interface Window {
    __AETHERION_QA_FIXTURE__?: QaFixtureId;
  }
}

export function readQaFixtureId(): QaFixtureId | null {
  const fixtureFromSearch = new URLSearchParams(window.location.search).get('qaFixture');
  const fixtureId = fixtureFromSearch ?? window.__AETHERION_QA_FIXTURE__;
  return fixtureId === 'transform-ready' ||
      fixtureId === 'response-window' ||
      fixtureId === 'aura-zone' ||
      fixtureId === 'animation-preview' ||
      fixtureId === 'game-over'
    ? fixtureId
    : null;
}

export function applyQaFixture(
  fixtureId: QaFixtureId,
  cards: readonly SimCard[],
): void {
  const state = buildFixtureState(fixtureId, cards);

  useActionFlowStore.setState({ flowState: { step: 'idle' } });
  useUiStore.setState({
    selectedCardId: null,
    hoveredCardId: null,
    hoveredZone: null,
    animationQueue: [],
    showGameLog: false,
    viewingPlayer: 0,
  });
  useGameStore.setState({
    state,
    availableActions: computeAvailableActions(state),
    pendingChoice: state.pendingChoice,
    isStarted: true,
  });
}

function buildFixtureState(
  fixtureId: QaFixtureId,
  cards: readonly SimCard[],
): GameState {
  const registryWithAbilities = createRegistry(cards);
  const hydrate = (state: GameState) =>
    hydrateAbilities(state, registryWithAbilities.getAbilities, registryWithAbilities.getHeroAbilities);

  switch (fixtureId) {
    case 'transform-ready':
      return buildTransformReadyState(hydrate(createFixtureGame(cards, 'Radiant', 'Onyx', 2)));
    case 'response-window':
      return buildResponseWindowState(hydrate(createFixtureGame(cards, 'Verdant', 'Sapphire', 2)));
    case 'aura-zone':
      return buildAuraZoneState(hydrate(createFixtureGame(cards, 'Radiant', 'Onyx', 3)), cards);
    case 'animation-preview':
      return buildAnimationPreviewState(hydrate(createFixtureGame(cards, 'Radiant', 'Onyx', 4)));
    case 'game-over':
      return buildGameOverState(hydrate(createFixtureGame(cards, 'Verdant', 'Radiant', 1)));
  }
}

function createFixtureGame(
  cards: readonly SimCard[],
  player1Faction: string,
  player2Faction: string,
  seed: number,
): GameState {
  const registryWithAbilities = createRegistry(cards);
  return createGame(
    buildStarterDeck(player1Faction),
    buildStarterDeck(player2Faction),
    registryWithAbilities.registry,
    seed,
  );
}

function buildTransformReadyState(state: GameState): GameState {
  const players = [...state.players] as [GameState['players'][0], GameState['players'][1]];
  players[0] = {
    ...players[0],
    hero: {
      ...players[0]!.hero,
      currentLp: 10,
      canTransformThisGame: true,
      transformed: false,
      transformedThisTurn: false,
    },
  };

  return {
    ...state,
    players,
    activePlayerIndex: 0,
    firstPlayerId: 0,
    turnNumber: 4,
    phase: 'transform',
    pendingChoice: null,
    priorityPlayerId: null,
    responseState: null,
    winner: null,
    turnState: {
      ...state.turnState,
      firstPlayerFirstTurn: false,
    },
  };
}

function buildResponseWindowState(state: GameState): GameState {
  const respondingCard = state.players[1]!.hand.find(card => card.name === 'Mana Leak')
    ?? state.players[1]!.hand[0]!;
  const pendingChoice: PendingChoice = {
    type: 'response_window',
    playerId: 1,
    options: [
      {
        id: respondingCard.instanceId,
        label: `${respondingCard.name} (Flash)`,
        instanceId: respondingCard.instanceId,
        sourceType: 'card',
      },
      { id: 'pass', label: 'Pass (no response)' },
    ],
    minSelections: 1,
    maxSelections: 1,
    context: 'You may respond with a Counter, Flash, or response ability.',
    responseContext: {
      respondingPlayerId: 1,
      stackItemId: 'fixture_stack_item',
    },
  };

  return {
    ...state,
    activePlayerIndex: 0,
    firstPlayerId: 0,
    turnNumber: 3,
    phase: 'strategy',
    pendingChoice,
    priorityPlayerId: 1,
    responseState: {
      initiatorPlayerId: 0,
      passesInRow: 0,
      bufferedEvents: [],
    },
    turnState: {
      ...state.turnState,
      firstPlayerFirstTurn: false,
    },
  };
}

function buildAuraZoneState(state: GameState, cards: readonly SimCard[]): GameState {
  const auraSource = cards.find((card) =>
    card.cardType === 'S' &&
    card.abilities.some((ability) => hasAuraDsl(ability.dsl)),
  ) ?? cards.find((card) => card.cardType === 'S');

  const baseSpell = state.players[0]!.hand.find((card) => card.cardType === 'S')
    ?? state.players[0]!.mainDeck.find((card) => card.cardType === 'S');

  if (!auraSource || !baseSpell) {
    return state;
  }

  const auraCard = {
    ...baseSpell,
    instanceId: 'fixture_aura_spell',
    cardDefId: auraSource.id,
    name: auraSource.name,
    cardType: auraSource.cardType,
    rarity: auraSource.rarity,
    currentHp: auraSource.stats?.hp ?? 0,
    currentAtk: auraSource.stats?.atk ?? 0,
    currentArm: auraSource.stats?.arm ?? 0,
    baseHp: auraSource.stats?.hp ?? 0,
    baseAtk: auraSource.stats?.atk ?? 0,
    baseArm: auraSource.stats?.arm ?? 0,
    traits: auraSource.traits as typeof baseSpell.traits,
    cost: { ...auraSource.cost },
    resourceTypes: [...baseSpell.resourceTypes],
    alignment: auraSource.alignment as typeof baseSpell.alignment,
    artUrl: auraSource.artUrl,
    equipment: null,
  };

  const players = [...state.players] as [GameState['players'][0], GameState['players'][1]];
  players[0] = {
    ...players[0],
    auraZone: [auraCard],
  };

  return {
    ...state,
    players,
    activePlayerIndex: 0,
    firstPlayerId: 0,
    turnNumber: 5,
    phase: 'strategy',
    pendingChoice: null,
    priorityPlayerId: null,
    responseState: null,
    winner: null,
    turnState: {
      ...state.turnState,
      firstPlayerFirstTurn: false,
    },
  };
}

function buildAnimationPreviewState(state: GameState): GameState {
  return {
    ...state,
    activePlayerIndex: 0,
    firstPlayerId: 0,
    turnNumber: 6,
    phase: 'strategy',
    pendingChoice: null,
    priorityPlayerId: null,
    responseState: null,
    winner: null,
    turnState: {
      ...state.turnState,
      firstPlayerFirstTurn: false,
    },
  };
}

function buildGameOverState(state: GameState): GameState {
  return {
    ...state,
    winner: 0,
    phase: 'game_over',
    pendingChoice: null,
    priorityPlayerId: null,
    responseState: null,
    turnNumber: 7,
    turnState: {
      ...state.turnState,
      firstPlayerFirstTurn: false,
    },
  };
}

function hasAuraDsl(dsl: unknown): boolean {
  return typeof dsl === 'object' && dsl !== null && 'type' in dsl && (dsl as { readonly type?: string }).type === 'aura';
}

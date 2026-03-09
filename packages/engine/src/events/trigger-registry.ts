/**
 * Trigger Registry — register/unregister card triggers in game state.
 * When a card enters play, its triggered abilities are registered.
 * When it leaves play, they are unregistered.
 */
import type {
  CardInstance,
  GameState,
  RegisteredTrigger,
} from '../types/game-state.js';
import type { TriggeredAbilityDSL } from '../types/ability.js';

let registrationCounter = 0;

export function resetRegistrationCounter(): void {
  registrationCounter = 0;
}

function extractTriggeredAbilities(
  abilitiesOwner: { readonly abilities: readonly unknown[] },
): readonly { ability: TriggeredAbilityDSL; index: number }[] {
  const result: { ability: TriggeredAbilityDSL; index: number }[] = [];
  for (let i = 0; i < abilitiesOwner.abilities.length; i++) {
    const ability = abilitiesOwner.abilities[i];
    if (
      ability !== undefined &&
      ability !== null &&
      typeof ability === 'object' &&
      'type' in ability &&
      ability.type === 'triggered'
    ) {
      result.push({ ability: ability as TriggeredAbilityDSL, index: i });
    }
  }
  return result;
}

function createRegisteredTrigger(
  sourceInstanceId: string,
  ownerPlayerId: 0 | 1,
  ability: TriggeredAbilityDSL,
  abilityIndex: number,
): RegisteredTrigger {
  registrationCounter++;
  return {
    id: `trigger_${String(registrationCounter)}`,
    sourceInstanceId,
    ownerPlayerId,
    trigger: ability.trigger,
    effects: ability.effects,
    condition: ability.condition,
    abilityIndex,
  };
}

/**
 * Register all triggered abilities from a card entering play.
 * Replaces the card's registeredTriggers array to avoid duplicate registration.
 */
export function registerCardTriggers(
  state: GameState,
  cardInstanceId: string,
): GameState {
  return updateCardTriggers(state, cardInstanceId, card => {
    const triggered = extractTriggeredAbilities(card);
    const newTriggers = triggered.map(({ ability, index }) =>
      createRegisteredTrigger(card.instanceId, card.owner, ability, index),
    );
    return {
      ...card,
      registeredTriggers: newTriggers,
    };
  });
}

export function registerHeroTriggers(
  state: GameState,
  playerId: 0 | 1,
): GameState {
  const player = state.players[playerId];
  if (player === undefined) return state;

  const triggered = extractTriggeredAbilities(player.hero);
  const newTriggers = triggered.map(({ ability, index }) =>
    createRegisteredTrigger(`hero_${String(playerId)}`, playerId, ability, index),
  );

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  newPlayers[playerId] = {
    ...player,
    hero: {
      ...player.hero,
      registeredTriggers: newTriggers,
    },
  };
  return { ...state, players: newPlayers };
}

export function registerInitialTriggers(state: GameState): GameState {
  resetRegistrationCounter();

  let currentState = state;
  currentState = registerHeroTriggers(currentState, 0);
  currentState = registerHeroTriggers(currentState, 1);

  for (const player of currentState.players) {
    for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
      for (const slot of zone) {
        if (slot !== null) {
          currentState = registerCardTriggers(currentState, slot.instanceId);
        }
      }
    }
  }

  return currentState;
}

/**
 * Unregister all triggers owned by a card (when it leaves play).
 */
export function unregisterCardTriggers(
  state: GameState,
  cardInstanceId: string,
): GameState {
  return updateCardTriggers(state, cardInstanceId, card => ({
    ...card,
    registeredTriggers: [],
  }));
}

/**
 * Collect all registered triggers from all cards on the battlefield.
 */
export function getAllRegisteredTriggers(
  state: GameState,
): readonly RegisteredTrigger[] {
  const triggers: RegisteredTrigger[] = [];
  for (const player of state.players) {
    // Hero triggers
    triggers.push(...player.hero.registeredTriggers);
    // Zone card triggers
    for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
      for (const slot of zone) {
        if (slot !== null) {
          triggers.push(...slot.registeredTriggers);
        }
      }
    }
  }
  return triggers;
}

// ── Internal helper ──────────────────────────────────────────────────────────

function updateCardTriggers(
  state: GameState,
  instanceId: string,
  updater: (card: CardInstance) => CardInstance,
): GameState {
  return {
    ...state,
    players: state.players.map(player => ({
      ...player,
      zones: {
        reserve: player.zones.reserve.map(c =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
        frontline: player.zones.frontline.map(c =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
        highGround: player.zones.highGround.map(c =>
          c?.instanceId === instanceId ? updater(c) : c,
        ),
      },
    })) as unknown as readonly [typeof state.players[0], typeof state.players[1]],
  };
}

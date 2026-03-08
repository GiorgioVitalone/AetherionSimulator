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
  card: CardInstance,
): readonly { ability: TriggeredAbilityDSL; index: number }[] {
  const result: { ability: TriggeredAbilityDSL; index: number }[] = [];
  for (let i = 0; i < card.abilities.length; i++) {
    const ability = card.abilities[i];
    if (ability !== undefined && ability.type === 'triggered') {
      result.push({ ability, index: i });
    }
  }
  return result;
}

function createRegisteredTrigger(
  card: CardInstance,
  ability: TriggeredAbilityDSL,
  abilityIndex: number,
): RegisteredTrigger {
  registrationCounter++;
  return {
    id: `trigger_${String(registrationCounter)}`,
    sourceInstanceId: card.instanceId,
    ownerPlayerId: card.owner,
    trigger: ability.trigger,
    effects: ability.effects,
    condition: ability.condition,
    abilityIndex,
  };
}

/**
 * Register all triggered abilities from a card entering play.
 * Adds RegisteredTrigger entries to the card's registeredTriggers array.
 */
export function registerCardTriggers(
  state: GameState,
  cardInstanceId: string,
): GameState {
  return updateCardTriggers(state, cardInstanceId, card => {
    const triggered = extractTriggeredAbilities(card);
    const newTriggers = triggered.map(({ ability, index }) =>
      createRegisteredTrigger(card, ability, index),
    );
    return {
      ...card,
      registeredTriggers: [...card.registeredTriggers, ...newTriggers],
    };
  });
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

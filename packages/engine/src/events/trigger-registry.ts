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
  abilities: readonly unknown[],
): readonly {
  readonly ability: TriggeredAbilityDSL;
  readonly index: number;
  readonly resolveAfterChain?: boolean;
}[] {
  const result: { ability: TriggeredAbilityDSL; index: number }[] = [];
  for (let i = 0; i < abilities.length; i++) {
    const ability = abilities[i];
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

function extractCardTriggeredAbilities(
  card: CardInstance,
): readonly {
  readonly ability: TriggeredAbilityDSL;
  readonly index: number;
  readonly resolveAfterChain?: boolean;
}[] {
  const baseTriggered = extractTriggeredAbilities(card.abilities);
  const grantedTriggered = card.grantedAbilities.flatMap((entry, index) => {
    if (entry.ability.type !== 'triggered') {
      return [];
    }
    return [{
      ability: entry.ability,
      index: card.abilities.length + index,
      resolveAfterChain: entry.resolveAfterChain,
    }];
  });
  return [...baseTriggered, ...grantedTriggered];
}

function createRegisteredTrigger(
  sourceInstanceId: string,
  ownerPlayerId: 0 | 1,
  ability: TriggeredAbilityDSL,
  abilityIndex: number,
  resolveAfterChain?: boolean,
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
    resolveAfterChain,
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
    const triggered = extractCardTriggeredAbilities(card);
    const newTriggers = triggered.map(({ ability, index, resolveAfterChain }) =>
      createRegisteredTrigger(card.instanceId, card.owner, ability, index, resolveAfterChain),
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

  const triggered = extractTriggeredAbilities(player.hero.abilities);
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
  return rebuildRegisteredTriggers(state);
}

export function rebuildRegisteredTriggers(state: GameState): GameState {
  resetRegistrationCounter();

  const players = state.players.map((player, playerId) => {
    const heroTriggered = extractTriggeredAbilities(player.hero.abilities);
    const hero = {
      ...player.hero,
      registeredTriggers: heroTriggered.map(({ ability, index }) =>
        createRegisteredTrigger(`hero_${String(playerId)}`, playerId as 0 | 1, ability, index),
      ),
    };

    const rebuildCard = (card: CardInstance): CardInstance => {
      const equipment = card.equipment === null
        ? null
        : rebuildCard(card.equipment);
      const triggered = extractCardTriggeredAbilities({ ...card, equipment });
      return {
        ...card,
        equipment,
        registeredTriggers: triggered.map(({ ability, index, resolveAfterChain }) =>
          createRegisteredTrigger(card.instanceId, card.owner, ability, index, resolveAfterChain),
        ),
      };
    };

    return {
      ...player,
      hero,
      auraZone: player.auraZone.map(rebuildCard),
      zones: {
        reserve: player.zones.reserve.map(card => card === null ? null : rebuildCard(card)),
        frontline: player.zones.frontline.map(card => card === null ? null : rebuildCard(card)),
        highGround: player.zones.highGround.map(card => card === null ? null : rebuildCard(card)),
      },
    };
  }) as unknown as readonly [typeof state.players[0], typeof state.players[1]];

  return { ...state, players };
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
    for (const auraCard of player.auraZone) {
      triggers.push(...auraCard.registeredTriggers);
      if (auraCard.equipment !== null) {
        triggers.push(...auraCard.equipment.registeredTriggers);
      }
    }
    // Zone card triggers
    for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
      for (const slot of zone) {
        if (slot !== null) {
          triggers.push(...slot.registeredTriggers);
          if (slot.equipment !== null) {
            triggers.push(...slot.equipment.registeredTriggers);
          }
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
      auraZone: player.auraZone.map(card =>
        card.instanceId === instanceId ? updater(card) : card,
      ),
      zones: {
        reserve: player.zones.reserve.map(c =>
          c?.instanceId === instanceId
            ? updater(c)
            : c?.equipment?.instanceId === instanceId
              ? { ...c, equipment: updater(c.equipment) }
              : c,
        ),
        frontline: player.zones.frontline.map(c =>
          c?.instanceId === instanceId
            ? updater(c)
            : c?.equipment?.instanceId === instanceId
              ? { ...c, equipment: updater(c.equipment) }
              : c,
        ),
        highGround: player.zones.highGround.map(c =>
          c?.instanceId === instanceId
            ? updater(c)
            : c?.equipment?.instanceId === instanceId
              ? { ...c, equipment: updater(c.equipment) }
              : c,
        ),
      },
    })) as unknown as readonly [typeof state.players[0], typeof state.players[1]],
  };
}

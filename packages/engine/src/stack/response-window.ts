import type {
  CardInstance,
  ChoiceOption,
  EffectResult,
  GameState,
  PendingChoice,
} from '../types/index.js';
import { canAfford } from '../actions/cost-checker.js';
import { getAllCards } from '../zones/zone-manager.js';
import { resolveStack } from './stack-resolver.js';

export function openResponseWindow(
  state: GameState,
  stackItemId: string,
): EffectResult {
  const respondingPlayerId = state.activePlayerIndex === 0 ? 1 : 0;
  return buildResponseWindow(state, respondingPlayerId as 0 | 1, stackItemId);
}

export function beginResponseWindow(
  state: GameState,
  initiatorPlayerId: 0 | 1,
): EffectResult {
  const firstResponder = initiatorPlayerId === 0 ? 1 : 0;
  return advanceResponseWindow(
    {
      ...state,
      pendingChoice: null,
      priorityPlayerId: firstResponder as 0 | 1,
      responseState: {
        initiatorPlayerId,
        passesInRow: 0,
        bufferedEvents: state.responseState?.bufferedEvents ?? [],
      },
    },
    firstResponder as 0 | 1,
    0,
  );
}

export function advanceResponseWindow(
  state: GameState,
  nextPlayerId: 0 | 1,
  passesInRow: number,
): EffectResult {
  const topStackItem = state.stack[state.stack.length - 1];
  const nextState: GameState = {
    ...state,
    pendingChoice: null,
    priorityPlayerId: nextPlayerId,
    responseState: {
      initiatorPlayerId: state.responseState?.initiatorPlayerId ?? nextPlayerId,
      passesInRow,
      bufferedEvents: state.responseState?.bufferedEvents ?? [],
    },
  };

  if (topStackItem === undefined || passesInRow >= 2) {
    const resolved = resolveStack({
      ...nextState,
      pendingChoice: null,
      priorityPlayerId: null,
      responseState: null,
    });
    return {
      newState: {
        ...resolved.state,
        pendingChoice: resolved.state.pendingChoice,
        priorityPlayerId: null,
        responseState: null,
      },
      events: resolved.events,
      pendingChoice: resolved.state.pendingChoice ?? undefined,
    };
  }

  const responses = computeAvailableResponses(nextState, nextPlayerId);
  if (responses.length === 0) {
    const otherPlayerId = nextPlayerId === 0 ? 1 : 0;
    return advanceResponseWindow(nextState, otherPlayerId as 0 | 1, passesInRow + 1);
  }

  return buildResponseWindow(nextState, nextPlayerId, topStackItem.id, responses);
}

export function computeAvailableResponses(
  state: GameState,
  playerId: 0 | 1,
): readonly ChoiceOption[] {
  const player = state.players[playerId]!;
  const options: ChoiceOption[] = [];

  for (const card of player.hand) {
    if (card.cardType !== 'S') continue;
    if (!canAfford(player, card.cost)) continue;
    if (!isResponseSpell(card)) continue;

    options.push({
      id: card.instanceId,
      label: `${card.name} (${describeResponseCard(card)})`,
      instanceId: card.instanceId,
      sourceType: 'card',
    });
  }

  for (const card of getAllCards(player.zones)) {
    if (card.exhausted || card.summoningSick || card.abilitiesSuppressed) continue;

    for (let i = 0; i < card.abilities.length; i++) {
      const ability = card.abilities[i]!;
      if (
        ability.type !== 'triggered' ||
        ability.trigger.type !== 'activated' ||
        !containsCounterSpell(ability.effects)
      ) continue;
      if (card.abilityCooldowns.get(i) !== undefined && card.abilityCooldowns.get(i)! > 0) continue;
      if (card.activatedAbilityTurns.get(i) === state.turnNumber) continue;
      if (!canAfford(player, ability.trigger.cost)) continue;

      options.push({
        id: `card_ability:${card.instanceId}:${String(i)}`,
        label: `${card.name} (Ability)`,
        instanceId: card.instanceId,
        sourceType: 'card_ability',
        abilityIndex: i,
      });
    }
  }

  const hero = player.hero;
  for (let i = 0; i < hero.abilities.length; i++) {
    const ability = hero.abilities[i]!;
    if (
      ability.type !== 'triggered' ||
      ability.trigger.type !== 'activated' ||
      !containsCounterSpell(ability.effects)
    ) continue;
    if (hero.cooldowns.get(i) !== undefined && hero.cooldowns.get(i)! > 0) continue;
    if (hero.activatedAbilityTurns.get(i) === state.turnNumber) continue;
    if (ability.trigger.oncePerGame === true && hero.usedUltimateAbilityIndices.includes(i)) continue;
    if (hero.transformedThisTurn && ability.trigger.oncePerGame === true) continue;
    if (!canAfford(player, ability.trigger.cost)) continue;

    options.push({
      id: `hero_ability:${String(i)}`,
      label: `Hero Ability ${String(i + 1)}`,
      sourceType: 'hero_ability',
      abilityIndex: i,
    });
  }

  return options;
}

function buildResponseWindow(
  state: GameState,
  playerId: 0 | 1,
  stackItemId: string,
  options = computeAvailableResponses(state, playerId),
): EffectResult {
  if (options.length === 0) {
    return { newState: state, events: [] };
  }

  const choice: PendingChoice = {
    type: 'response_window',
    playerId,
    options: [
      ...options,
      { id: 'pass', label: 'Pass (no response)' },
    ],
    minSelections: 1,
    maxSelections: 1,
    context: 'You may respond with a Counter, Flash, or response ability.',
    responseContext: {
      respondingPlayerId: playerId,
      stackItemId,
    },
  };

  return {
    newState: {
      ...state,
      pendingChoice: choice,
      priorityPlayerId: playerId,
    },
    events: [],
    pendingChoice: choice,
  };
}

function isResponseSpell(card: CardInstance): boolean {
  return card.abilities.some(
    ability =>
      ability.type === 'triggered' &&
      (ability.trigger.type === 'on_counter' || ability.trigger.type === 'on_flash'),
  );
}

function describeResponseCard(card: CardInstance): string {
  const hasCounter = card.abilities.some(
    ability => ability.type === 'triggered' && ability.trigger.type === 'on_counter',
  );
  return hasCounter ? 'Counter' : 'Flash';
}

function containsCounterSpell(effects: readonly import('../types/effects.js').Effect[]): boolean {
  for (const effect of effects) {
    if (effect.type === 'counter_spell') return true;
    if (effect.type === 'composite' && containsCounterSpell(effect.effects)) return true;
    if (effect.type === 'conditional') {
      if (containsCounterSpell(effect.ifTrue)) return true;
      if (effect.ifFalse !== undefined && containsCounterSpell(effect.ifFalse)) return true;
    }
    if (effect.type === 'choose_one') {
      for (const option of effect.options) {
        if (containsCounterSpell(option.effects)) return true;
      }
    }
  }
  return false;
}

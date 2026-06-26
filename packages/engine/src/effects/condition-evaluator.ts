/**
 * Condition Evaluator — evaluates DSL Condition against GameState.
 */
import type { Condition } from '../types/conditions.js';
import type { GameState, EffectContext, CardInstance } from '../types/game-state.js';
import { findCard, getAllCards, getCardsInZone } from '../zones/zone-manager.js';

export function evaluateCondition(
  state: GameState,
  condition: Condition,
  context: EffectContext,
): boolean {
  switch (condition.type) {
    case 'hp_threshold':
      return evaluateHpThreshold(state, condition, context);
    case 'stat_compare':
      return evaluateStatCompare(state, condition, context);
    case 'card_count':
      return evaluateCardCount(state, condition, context);
    case 'zone_is':
      return evaluateZoneIs(state, condition, context);
    case 'has_trait':
      return evaluateHasTrait(state, condition, context);
    case 'cost_check':
      return evaluateCostCheck(state, condition, context);
    case 'card_type_check':
      return evaluateCardTypeCheck(state, condition, context);
    case 'resource_check':
      return evaluateResourceCheck(state, condition, context);
    case 'is_alive':
      return evaluateIsAlive(state, context);
    case 'turn_count':
      return evaluateTurnCount(state, condition, context);
    case 'is_transformed':
      return state.players[context.controllerId]!.hero.transformed;
    case 'controls_character':
      return evaluateControlsCharacter(state, condition, context);
    case 'compare_to_opponent':
      return evaluateCompareToOpponent(state, condition, context);
    case 'event_context':
      return evaluateEventContext(state, condition, context);
    case 'triggering_card_cost':
      return evaluateTriggeringCardCost(condition, context);
    case 'and':
      return condition.conditions.every(c => evaluateCondition(state, c, context));
    case 'or':
      return condition.conditions.some(c => evaluateCondition(state, c, context));
    case 'not':
      return !evaluateCondition(state, condition.condition, context);
  }
}

/**
 * Event-context flags threaded onto the EffectContext / TurnState by the runtime.
 * `used_temporary_resource` — the action that fired this trigger (e.g. a deploy)
 * paid with a Temporary Resource (RIA-09 Symbiotic Expansion). Read per-event from
 * context. `gained_temporary_resource_this_turn` — the controller gained a Temporary
 * Resource earlier this turn (RIA-09 Biotech Harvest); read from TurnState.
 */
function evaluateEventContext(
  state: GameState,
  cond: Extract<Condition, { type: 'event_context' }>,
  context: EffectContext,
): boolean {
  if (cond.check === 'used_temporary_resource') {
    return context.usedTemporaryResource === true;
  }
  return state.turnState.gainedTemporaryResource?.[context.controllerId] === true;
}

/**
 * Compare the triggering card's cost (threaded onto the context by dispatch) to the
 * reference. `relativeTo: triggering_spell` references the spell whose cast fired the
 * ability — which IS the triggering card — so the comparison is against itself; the
 * net effect is that the ability is gated only on a triggering card being present
 * (Lyria Archmage Arcane Convergence: previously a permanent-false stub). Returns
 * false when no triggering card is known.
 */
function evaluateTriggeringCardCost(
  cond: Extract<Condition, { type: 'triggering_card_cost' }>,
  context: EffectContext,
): boolean {
  if (context.triggeringCardCost === undefined) return false;
  return compare(context.triggeringCardCost, cond.comparison, context.triggeringCardCost);
}

function compare(
  actual: number,
  comparison: string,
  value: number,
): boolean {
  switch (comparison) {
    case 'less_than': return actual < value;
    case 'less_equal': return actual <= value;
    case 'greater_than': return actual > value;
    case 'greater_equal': return actual >= value;
    case 'equal': return actual === value;
    default: return false;
  }
}

function getSourceCard(state: GameState, context: EffectContext): CardInstance | null {
  for (const player of state.players) {
    const loc = findCard(player.zones, context.sourceInstanceId);
    if (loc !== null) return loc.card;
  }
  return null;
}

function evaluateHpThreshold(
  state: GameState,
  cond: Extract<Condition, { type: 'hp_threshold' }>,
  context: EffectContext,
): boolean {
  const card = getSourceCard(state, context);
  if (card === null) return false;
  return compare(card.currentHp, cond.comparison, cond.value);
}

function evaluateStatCompare(
  state: GameState,
  cond: Extract<Condition, { type: 'stat_compare' }>,
  context: EffectContext,
): boolean {
  const card = getSourceCard(state, context);
  if (card === null) return false;
  const statValue = cond.stat === 'atk' ? card.currentAtk
    : cond.stat === 'hp' ? card.currentHp
    : card.currentArm;
  return compare(statValue, cond.comparison, cond.value);
}

function evaluateCardCount(
  state: GameState,
  cond: Extract<Condition, { type: 'card_count' }>,
  context: EffectContext,
): boolean {
  const player = state.players[context.controllerId]!;
  let count: number;
  if (cond.tag !== undefined) {
    // Tag-filtered counting — iterate cards instead of using .length
    switch (cond.zone) {
      case 'hand':
        count = player.hand.filter(c => c.tags.includes(cond.tag!)).length;
        break;
      case 'discard':
        count = player.discardPile.filter(c => c.tags.includes(cond.tag!)).length;
        break;
      case 'battlefield':
        count = getAllCards(player.zones).filter(c => c.tags.includes(cond.tag!)).length;
        break;
      case 'resource_bank':
        count = player.resourceBank.length; // Resources don't have tags
        break;
    }
  } else {
    switch (cond.zone) {
      case 'hand': count = player.hand.length; break;
      case 'discard': count = player.discardPile.length; break;
      case 'resource_bank': count = player.resourceBank.length; break;
      case 'battlefield': count = getAllCards(player.zones).length; break;
    }
  }
  return compare(count, cond.comparison, cond.value);
}

function evaluateZoneIs(
  state: GameState,
  cond: Extract<Condition, { type: 'zone_is' }>,
  context: EffectContext,
): boolean {
  for (const player of state.players) {
    const loc = findCard(player.zones, context.sourceInstanceId);
    if (loc !== null) return loc.zone === cond.zone;
  }
  return false;
}

function evaluateHasTrait(
  state: GameState,
  cond: Extract<Condition, { type: 'has_trait' }>,
  context: EffectContext,
): boolean {
  const card = getSourceCard(state, context);
  if (card === null) return false;
  return card.traits.includes(cond.trait) ||
    card.grantedTraits.some(g => g.trait === cond.trait);
}

function evaluateCostCheck(
  state: GameState,
  cond: Extract<Condition, { type: 'cost_check' }>,
  context: EffectContext,
): boolean {
  const card = getSourceCard(state, context);
  if (card === null) return false;
  const total = card.cost.mana + card.cost.energy + card.cost.flexible;
  return compare(total, cond.comparison, cond.value);
}

function evaluateCardTypeCheck(
  state: GameState,
  cond: Extract<Condition, { type: 'card_type_check' }>,
  context: EffectContext,
): boolean {
  const card = getSourceCard(state, context);
  if (card === null) return false;
  return card.cardType === cond.cardType;
}

function evaluateResourceCheck(
  state: GameState,
  cond: Extract<Condition, { type: 'resource_check' }>,
  context: EffectContext,
): boolean {
  const player = state.players[context.controllerId]!;
  const available = player.resourceBank.filter(
    r => !r.exhausted && (cond.resourceType === 'flexible' || r.resourceType === cond.resourceType),
  ).length;
  return compare(available, cond.comparison, cond.value);
}

function evaluateIsAlive(state: GameState, context: EffectContext): boolean {
  return getSourceCard(state, context) !== null;
}

function evaluateTurnCount(
  state: GameState,
  cond: Extract<Condition, { type: 'turn_count' }>,
  context: EffectContext,
): boolean {
  const counters = state.players[context.controllerId]!.turnCounters;
  let count: number;
  switch (cond.action) {
    case 'spell_cast': count = counters.spellsCast; break;
    case 'equipment_played': count = counters.equipmentPlayed; break;
    case 'character_deployed': count = counters.charactersDeployed; break;
    case 'ability_activated': count = counters.abilitiesActivated; break;
  }
  return compare(count, cond.comparison, cond.value);
}

function evaluateCompareToOpponent(
  state: GameState,
  cond: Extract<Condition, { type: 'compare_to_opponent' }>,
  context: EffectContext,
): boolean {
  const player = state.players[context.controllerId]!;
  const opponentIdx = context.controllerId === 0 ? 1 : 0;
  const opponent = state.players[opponentIdx]!;
  let playerValue: number;
  let opponentValue: number;
  switch (cond.metric) {
    case 'battlefield_count':
      playerValue = getAllCards(player.zones).length;
      opponentValue = getAllCards(opponent.zones).length;
      break;
    case 'hand_count':
      playerValue = player.hand.length;
      opponentValue = opponent.hand.length;
      break;
  }
  return compare(playerValue, cond.comparison, opponentValue);
}

function evaluateControlsCharacter(
  state: GameState,
  cond: Extract<Condition, { type: 'controls_character' }>,
  context: EffectContext,
): boolean {
  const player = state.players[context.controllerId]!;
  const cards = cond.zone !== undefined
    ? getCardsInZone(player.zones, cond.zone)
    : getAllCards(player.zones);

  return cards.some(c => {
    if (cond.trait !== undefined && !c.traits.includes(cond.trait)) return false;
    if (cond.tag !== undefined && !c.tags.includes(cond.tag)) return false;
    return true;
  });
}

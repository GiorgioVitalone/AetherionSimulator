/**
 * Replacement effects — register and consult event-replacement hooks.
 *
 * A `replacement` effect registers an ActiveReplacement on its source card. The
 * damage/destruction pipeline consults a target card's active replacements before
 * HP is reduced / the card is destroyed:
 *   - on_would_take_damage: reduce (or prevent) incoming damage by `reduction`.
 *   - on_would_be_destroyed: run `instead` effects in place of destruction.
 *
 * Registration is pure; consultation helpers are pure read/compute. Executing the
 * `instead` effects of a destruction replacement is driven by the interpreter
 * (which owns executeEffect), so that logic lives in interpreter.ts.
 */
import type { Effect } from '../types/effects.js';
import type {
  GameState,
  CardInstance,
  ActiveReplacement,
  EffectContext,
  EffectResult,
} from '../types/game-state.js';
import { updateCardInState, findCardInState } from './state-helpers.js';

export function executeReplacement(
  state: GameState,
  effect: Extract<Effect, { type: 'replacement' }>,
  context: EffectContext,
): EffectResult {
  const source = findCardInState(state, context.sourceInstanceId);
  if (source === null) return { newState: state, events: [] };

  const index = (source.activeReplacements ?? []).length;
  const registration: ActiveReplacement = {
    id: `replacement_${context.sourceInstanceId}_${String(index)}`,
    sourceInstanceId: context.sourceInstanceId,
    replaces: effect.replaces,
    instead: effect.instead,
    oncePerTurn: effect.oncePerTurn ?? false,
    usedThisTurn: false,
  };

  const newState = updateCardInState(state, context.sourceInstanceId, card => ({
    ...card,
    activeReplacements: [...(card.activeReplacements ?? []), registration],
  }));
  return { newState, events: [] };
}

/** Result of consulting a card's damage replacements against an incoming amount. */
export interface DamageReplacementResult {
  readonly amount: number;
  readonly consumedIds: readonly string[];
}

/** Compute the post-replacement damage amount for a card, honoring oncePerTurn
 * (skips replacements already used this turn). Pure — does not mutate state. */
export function applyDamageReplacements(
  card: CardInstance,
  amount: number,
): DamageReplacementResult {
  const consumedIds: string[] = [];
  let current = amount;
  for (const repl of card.activeReplacements ?? []) {
    if (repl.replaces.type !== 'on_would_take_damage') continue;
    if (repl.oncePerTurn && repl.usedThisTurn) continue;
    const reduction = repl.replaces.reduction ?? current; // no reduction value ⇒ prevent all
    current = Math.max(0, current - reduction);
    consumedIds.push(repl.id);
  }
  return { amount: current, consumedIds };
}

/** Find the first applicable "would be destroyed" replacement on a card, if any. */
export function findDestructionReplacement(
  card: CardInstance,
): ActiveReplacement | null {
  for (const repl of card.activeReplacements ?? []) {
    if (repl.replaces.type !== 'on_would_be_destroyed') continue;
    if (repl.oncePerTurn && repl.usedThisTurn) continue;
    return repl;
  }
  return null;
}

/** Mark the given replacement ids as used this turn on a card. Pure. */
export function markReplacementsUsed(
  state: GameState,
  instanceId: string,
  ids: readonly string[],
): GameState {
  if (ids.length === 0) return state;
  const idSet = new Set(ids);
  return updateCardInState(state, instanceId, card => ({
    ...card,
    activeReplacements: (card.activeReplacements ?? []).map(r =>
      idSet.has(r.id) ? { ...r, usedThisTurn: true } : r,
    ),
  }));
}

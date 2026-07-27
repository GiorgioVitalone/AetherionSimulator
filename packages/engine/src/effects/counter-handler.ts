/**
 * Counter-spell handler — implements the minimal stack/response model for the
 * Counter keyword (Rulebook Section 14, Reactions and Priority).
 *
 * MODEL / SIMPLIFICATION: The engine tracks an in-progress chain in
 * GameState.stack (StackItem[]). A spell that is cast is pushed onto the stack
 * as a `spell` StackItem before it resolves. `counter_spell` negates a targeted
 * spell stack item by removing it from the stack so it never resolves (LIFO
 * chain resolution then simply skips it). This implements the smallest correct
 * model: a spell is queued, and a Counter can negate it before resolution.
 *
 * The stack resolver owns the priority-pass loop. An affordable `unlessPay`
 * clause becomes an explicit current-rules interaction for the targeted item's
 * controller and actually spends the resources. Historical/non-observable
 * profiles retain their original affordability-only auto-pay for replay
 * compatibility.
 */
import type { Effect } from '../types/effects.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  StackItem,
} from '../types/game-state.js';
import { resolveTargets } from './target-resolver.js';
import {
  canAfford,
  payCost,
} from '../actions/cost-checker.js';

export function executeCounterSpell(
  state: GameState,
  effect: Extract<Effect, { type: 'counter_spell' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) {
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };
  }

  const targetIds = new Set(resolved.targetIds);
  if (targetIds.size === 0) return { newState: state, events: [] };
  const targetedItems = state.stack.filter((item) => targetIds.has(item.id));
  if (
    effect.unlessPay !== undefined &&
    targetedItems.length === 1 &&
    canAfford(
      state.players[targetedItems[0]!.controllerId],
      effect.unlessPay,
    )
  ) {
    const targetedItem = targetedItems[0]!;
    const answer = context.selectedOptionIds?.[0];
    if (
      answer === undefined &&
      state.config?.observableInteractions === true &&
      state.config.explicitEffectChoices === true
    ) {
      return {
        newState: state,
        events: [],
        pendingChoice: {
          type: 'pay_counter_tax',
          playerId: targetedItem.controllerId,
          options: [
            { id: 'pay', label: 'Pay the additional cost' },
            { id: 'decline', label: 'Do not pay' },
          ],
          minSelections: 1,
          maxSelections: 1,
          context: 'Pay the additional cost to prevent this stack item from being countered.',
          optional: false,
          visibility: 'public',
          resolutionContext: {
            ...context,
            selectedTargets: [targetedItem.id],
          },
        },
      };
    }
    if (answer === 'pay') {
      const players = [...state.players] as [
        GameState['players'][0],
        GameState['players'][1],
      ];
      players[targetedItem.controllerId] = payCost(
        players[targetedItem.controllerId],
        effect.unlessPay,
      );
      return {
        newState: { ...state, players },
        events: [],
      };
    }
    if (answer === undefined) {
      return { newState: state, events: [] };
    }
  }

  const events: GameEvent[] = [];
  const remaining: StackItem[] = [];
  const players = [...state.players] as [GameState['players'][0], GameState['players'][1]];
  for (const item of state.stack) {
    if (targetIds.has(item.id)) {
      if (state.config?.transactionalDeclarations === true) {
        events.push({
          type: 'STACK_ITEM_COUNTERED',
          stackItemId: item.id,
          stackItemType: item.type,
          sourceInstanceId: item.sourceInstanceId,
          controllerPlayerId: item.controllerId,
        });
      }
      if (
        item.type === 'spell' ||
        state.config?.transactionalDeclarations !== true
      ) {
        events.push({
          type: 'SPELL_COUNTERED',
          cardInstanceId: item.sourceInstanceId,
          playerId: item.controllerId,
        });
      }
      if (item.declaredCard !== undefined) {
        const player = players[item.controllerId];
        // A declared equipment card records its intended holder while it is on
        // the stack. Once countered it becomes an ordinary unattached discard
        // card, so the attachment relation must be cleared.
        const discardedCard = {
          ...item.declaredCard,
          holderInstanceId: undefined,
        };
        players[item.controllerId] = {
          ...player,
          discardPile: [...player.discardPile, discardedCard],
        };
        events.push({
          type: 'EQUIPMENT_COUNTERED',
          equipmentId: item.declaredCard.instanceId,
          stackItemId: item.id,
          playerId: item.controllerId,
        });
        events.push({
          type: 'EQUIPMENT_DISCARDED',
          equipmentId: item.declaredCard.instanceId,
          cardDefId: item.declaredCard.cardDefId,
          playerId: item.controllerId,
          reason: 'countered',
        });
      }
      continue; // negated — drop from the stack
    }
    remaining.push(item);
  }

  return { newState: { ...state, players, stack: remaining }, events };
}

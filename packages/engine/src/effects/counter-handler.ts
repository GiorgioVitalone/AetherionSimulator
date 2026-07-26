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
 * We do NOT implement the full interactive response-window/priority-pass loop
 * (offering each player a window to add links): the caller is responsible for
 * placing spells on the stack and driving resolution. The `unlessPay` clause
 * (e.g. "counter unless its controller pays 2") is modeled non-interactively:
 * if the spell's controller can afford the cost from their unexhausted resource
 * bank, they are assumed to pay and the spell is NOT countered; otherwise it is
 * countered. Resources are not actually deducted here (the pay decision is the
 * caller's to commit), matching the rule that spent resources are not refunded.
 */
import type { Effect } from '../types/effects.js';
import type { ResourceCost } from '../types/common.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  StackItem,
} from '../types/game-state.js';
import { resolveTargets } from './target-resolver.js';

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

  const events: GameEvent[] = [];
  const remaining: StackItem[] = [];
  const players = [...state.players] as [GameState['players'][0], GameState['players'][1]];
  for (const item of state.stack) {
    if (targetIds.has(item.id) && shouldCounter(state, item, effect.unlessPay)) {
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

/**
 * Decide whether a targeted spell is countered. With no `unlessPay`, it is
 * always countered. With `unlessPay`, the controller avoids the counter if they
 * can afford the cost from their unexhausted resource bank.
 */
function shouldCounter(
  state: GameState,
  item: StackItem,
  unlessPay: ResourceCost | undefined,
): boolean {
  if (unlessPay === undefined) return true;
  return !canAfford(state, item.controllerId, unlessPay);
}

function canAfford(state: GameState, playerId: 0 | 1, cost: ResourceCost): boolean {
  const bank = state.players[playerId].resourceBank.filter(r => !r.exhausted);
  const mana = bank.filter(r => r.resourceType === 'mana').length;
  const energy = bank.filter(r => r.resourceType === 'energy').length;
  if (mana < cost.mana) return false;
  if (energy < cost.energy) return false;
  const leftover = (mana - cost.mana) + (energy - cost.energy);
  return leftover >= cost.flexible;
}

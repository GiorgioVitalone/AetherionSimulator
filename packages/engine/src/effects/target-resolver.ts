/**
 * Target Resolver — resolves DSL TargetExpr to concrete instanceIds.
 * Returns a PendingChoice when player must select targets.
 */
import type { TargetExpr } from '../types/targets.js';
import type {
  GameState,
  EffectContext,
  PendingChoice,
  CardInstance,
} from '../types/game-state.js';
import { getAllCards, getCardsInZone } from '../zones/zone-manager.js';
import { evaluateAmount } from './amount-evaluator.js';
import {
  cardHasActiveTrait,
  isProtectedFromEnemyTargeting,
} from '../state/runtime-card-helpers.js';

export type ResolvedTargets =
  | { readonly resolved: true; readonly targetIds: readonly string[] }
  | { readonly resolved: false; readonly pendingChoice: PendingChoice };

export function resolveTargets(
  state: GameState,
  target: TargetExpr,
  context: EffectContext,
): ResolvedTargets {
  switch (target.type) {
    case 'self':
      return { resolved: true, targetIds: [context.sourceInstanceId] };

    case 'owner_hero':
      return { resolved: true, targetIds: [`hero_${String(context.controllerId)}`] };

    case 'hero':
      return resolveHeroTarget(target, context);

    case 'equipped_character':
      return resolveEquippedCharacter(state, context);

    case 'source_character':
      return { resolved: true, targetIds: [context.sourceInstanceId] };

    case 'all_characters':
      return resolveAllCharacters(state, target, context);

    case 'all_characters_in_zone':
      return resolveAllInZone(state, target, context);

    case 'target_character':
      return resolveTargetCharacter(state, target, context);

    case 'up_to':
      return resolveUpTo(state, target, context);

    case 'each_player':
      return { resolved: true, targetIds: ['hero_0', 'hero_1'] };

    case 'player':
      return resolvePlayerTarget(target, context);

    case 'target_spell':
      return resolveTargetSpell(state, context);

    case 'target_equipment':
      return resolveTargetEquipment(state, target, context);

    case 'target_card_in_discard':
      return resolveTargetCardInDiscard(state, target, context);

    case 'adjacent_to_self':
    case 'copy_of':
    case 'random':
      // Simplified: return empty for now, full implementation in later steps
      return { resolved: true, targetIds: [] };
  }
}

function resolveHeroTarget(
  target: Extract<TargetExpr, { type: 'hero' }>,
  context: EffectContext,
): ResolvedTargets {
  const id = target.side === 'allied'
    ? `hero_${String(context.controllerId)}`
    : target.side === 'enemy'
      ? `hero_${String(context.controllerId === 0 ? 1 : 0)}`
      : `hero_${String(context.controllerId)}`;
  return { resolved: true, targetIds: [id] };
}

function resolveEquippedCharacter(
  state: GameState,
  context: EffectContext,
): ResolvedTargets {
  // Find the card this equipment is attached to
  for (const player of state.players) {
    const allCards = getAllCards(player.zones);
    for (const card of allCards) {
      if (card.equipment?.instanceId === context.sourceInstanceId) {
        return { resolved: true, targetIds: [card.instanceId] };
      }
    }
  }
  return { resolved: true, targetIds: [] };
}

function resolveAllCharacters(
  state: GameState,
  target: Extract<TargetExpr, { type: 'all_characters' }>,
  context: EffectContext,
): ResolvedTargets {
  const cards = getCardsBySide(state, target.side, context);
  const filtered = applyFilter(cards, target.filter);
  return { resolved: true, targetIds: filtered.map(c => c.instanceId) };
}

function resolveAllInZone(
  state: GameState,
  target: Extract<TargetExpr, { type: 'all_characters_in_zone' }>,
  context: EffectContext,
): ResolvedTargets {
  const players = getPlayersBySide(state, target.side, context);
  const cards = players.flatMap(p => getCardsInZone(p.zones, target.zone));
  const filtered = applyFilter(cards, target.filter);
  return { resolved: true, targetIds: filtered.map(c => c.instanceId) };
}

function resolveTargetCharacter(
  state: GameState,
  target: Extract<TargetExpr, { type: 'target_character' }>,
  context: EffectContext,
): ResolvedTargets {
  // If targets already selected via PendingChoice response, use those
  if (context.selectedTargets !== undefined) {
    return { resolved: true, targetIds: context.selectedTargets };
  }
  const cards = getCardsBySide(state, target.side, context);
  const filtered = applyFilter(cards, target.filter);
  if (filtered.length === 0) {
    return { resolved: true, targetIds: [] };
  }
  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: filtered.map(c => ({ id: c.instanceId, label: c.name, instanceId: c.instanceId })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose a target character',
    },
  };
}

function resolveUpTo(
  state: GameState,
  target: Extract<TargetExpr, { type: 'up_to' }>,
  context: EffectContext,
): ResolvedTargets {
  // If targets already selected via PendingChoice response, use those
  if (context.selectedTargets !== undefined) {
    return { resolved: true, targetIds: context.selectedTargets };
  }
  const cards = getCardsBySide(state, target.side, context);
  const filtered = applyFilter(cards, target.filter, context);
  if (filtered.length === 0) {
    return { resolved: true, targetIds: [] };
  }
  const count = typeof target.count === 'number'
    ? target.count
    : evaluateAmount(state, target.count, context);
  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: filtered.map(c => ({ id: c.instanceId, label: c.name, instanceId: c.instanceId })),
      minSelections: 0,
      maxSelections: Math.min(count, filtered.length),
      context: `Choose up to ${String(count)} targets`,
    },
  };
}

function resolvePlayerTarget(
  target: Extract<TargetExpr, { type: 'player' }>,
  context: EffectContext,
): ResolvedTargets {
  const id = target.side === 'allied'
    ? `hero_${String(context.controllerId)}`
    : target.side === 'enemy'
      ? `hero_${String(context.controllerId === 0 ? 1 : 0)}`
      : `hero_${String(context.controllerId)}`;
  return { resolved: true, targetIds: [id] };
}

function resolveTargetSpell(
  state: GameState,
  context: EffectContext,
): ResolvedTargets {
  if (context.selectedTargets !== undefined && context.selectedTargets.length > 0) {
    return { resolved: true, targetIds: context.selectedTargets };
  }

  const target = [...state.stack]
    .reverse()
    .find(item => item.countered !== true);
  if (target === undefined) {
    return { resolved: true, targetIds: [] };
  }

  return { resolved: true, targetIds: [target.id] };
}

function resolveTargetEquipment(
  state: GameState,
  target: Extract<TargetExpr, { type: 'target_equipment' }>,
  context: EffectContext,
): ResolvedTargets {
  if (context.selectedTargets !== undefined) {
    return { resolved: true, targetIds: context.selectedTargets };
  }

  const players = getPlayersBySide(state, target.side, context);
  const equipmentCards = players.flatMap(player =>
    getAllCards(player.zones)
      .flatMap(card => card.equipment === null ? [] : [card.equipment]),
  );

  if (equipmentCards.length === 0) {
    return { resolved: true, targetIds: [] };
  }

  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: equipmentCards.map(card => ({ id: card.instanceId, label: card.name, instanceId: card.instanceId })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose target equipment',
    },
  };
}

function resolveTargetCardInDiscard(
  state: GameState,
  target: Extract<TargetExpr, { type: 'target_card_in_discard' }>,
  context: EffectContext,
): ResolvedTargets {
  if (context.selectedTargets !== undefined) {
    return { resolved: true, targetIds: context.selectedTargets };
  }

  const players = getPlayersBySide(state, target.side, context);
  const cards = players.flatMap(player => player.discardPile);
  const filtered = applyFilter(cards, target.filter);
  if (filtered.length === 0) {
    return { resolved: true, targetIds: [] };
  }

  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: filtered.map(card => ({ id: card.instanceId, label: card.name, instanceId: card.instanceId })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose a card in discard',
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCardsBySide(
  state: GameState,
  side: 'allied' | 'enemy' | 'any',
  context: EffectContext,
): readonly CardInstance[] {
  const players = getPlayersBySide(state, side, context);
  return players.flatMap(p => getAllCards(p.zones));
}

function getPlayersBySide(
  state: GameState,
  side: 'allied' | 'enemy' | 'any',
  context: EffectContext,
): readonly (typeof state.players[0])[] {
  switch (side) {
    case 'allied': return [state.players[context.controllerId]!];
    case 'enemy': return [state.players[context.controllerId === 0 ? 1 : 0]!];
    case 'any': return [...state.players];
  }
}

export function applyFilter(
  cards: readonly CardInstance[],
  filter: { trait?: string; maxCost?: number; minCost?: number; maxHp?: number; maxAtk?: number; cardType?: string; tag?: string; excludeSelf?: boolean } | undefined,
  context?: EffectContext,
): readonly CardInstance[] {
  if (filter === undefined) return cards;
  return cards.filter(c => {
    if (filter.excludeSelf === true && context !== undefined && c.instanceId === context.sourceInstanceId) return false;
    if (context !== undefined && c.owner !== context.controllerId && isProtectedFromEnemyTargeting(c)) return false;
    if (filter.trait !== undefined && !cardHasActiveTrait(c, filter.trait as never)) return false;
    if (filter.tag !== undefined && !c.tags.includes(filter.tag)) return false;
    if (filter.cardType !== undefined && c.cardType !== filter.cardType) return false;
    const totalCost = c.cost.mana + c.cost.energy + c.cost.flexible;
    if (filter.maxCost !== undefined && totalCost > filter.maxCost) return false;
    if (filter.minCost !== undefined && totalCost < filter.minCost) return false;
    if (filter.maxHp !== undefined && c.currentHp > filter.maxHp) return false;
    if (filter.maxAtk !== undefined && c.currentAtk > filter.maxAtk) return false;
    return true;
  });
}

/**
 * Target Resolver — resolves DSL TargetExpr to concrete instanceIds.
 * Returns a PendingChoice when player must select targets.
 */
import type { TargetExpr } from '../types/targets.js';
import type { ZoneType } from '../types/common.js';
import type { GameState, EffectContext, PendingChoice, CardInstance } from '../types/game-state.js';
import { getAllCards, getCardsInZone, findCard } from '../zones/zone-manager.js';
import { evaluateAmount } from './amount-evaluator.js';

export type ResolvedTargets =
  | { readonly resolved: true; readonly targetIds: readonly string[] }
  | { readonly resolved: false; readonly pendingChoice: PendingChoice };

export function resolveTargets(
  state: GameState,
  target: TargetExpr,
  context: EffectContext,
): ResolvedTargets {
  // If targets already selected via PendingChoice response, use those
  if (context.selectedTargets !== undefined) {
    return { resolved: true, targetIds: context.selectedTargets };
  }

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

    case 'target_card_in_discard':
      return resolveCardInDiscard(state, target, context);

    case 'target_spell':
      return resolveTargetSpell(state, context);

    case 'target_equipment':
      return resolveTargetEquipment(state, target, context);

    case 'adjacent_to_self':
      return resolveAdjacentToSelf(state, context);

    case 'copy_of':
      // Resolve the base target — the copy effect duplicates whatever it picks.
      return resolveTargets(state, target.base, context);

    case 'random':
      // The RNG pre-pass (rng-prepass.ts) resolves `random` to specific instanceIds
      // via the seeded RNG and supplies them as context.selectedTargets, handled at
      // the top of this function. Reaching here means no pre-pass ran; return empty.
      return { resolved: true, targetIds: [] };
  }
}

/** Equipment attached to characters of the given side. Equipment is an attachment,
 * so we surface each holder's equipment instance id. */
function resolveTargetEquipment(
  state: GameState,
  target: Extract<TargetExpr, { type: 'target_equipment' }>,
  context: EffectContext,
): ResolvedTargets {
  const cards = getCardsBySide(state, target.side, context);
  const equipmentIds = cards
    .map((c) => c.equipment?.instanceId)
    .filter((id): id is string => id !== undefined);
  if (equipmentIds.length === 0) return { resolved: true, targetIds: [] };
  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: equipmentIds.map((id) => ({ id, label: id })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose a piece of equipment',
    },
  };
}

/** Characters in zones adjacent to the source's current zone (Rulebook adjacency:
 * reserve↔frontline↔high_ground), on the source's side. */
function resolveAdjacentToSelf(state: GameState, context: EffectContext): ResolvedTargets {
  for (const player of state.players) {
    const loc = findCard(player.zones, context.sourceInstanceId);
    if (loc === null) continue;
    const adjacentZones = ADJACENT_ZONES[loc.zone];
    const ids = adjacentZones
      .flatMap((z) => getCardsInZone(player.zones, z))
      .map((c) => c.instanceId);
    return { resolved: true, targetIds: ids };
  }
  return { resolved: true, targetIds: [] };
}

const ADJACENT_ZONES: Record<ZoneType, readonly ZoneType[]> = {
  reserve: ['frontline'],
  frontline: ['reserve', 'high_ground'],
  high_ground: ['frontline'],
};

/**
 * Resolve a counterable spell on the stack. Per Rulebook 14, a Counter targets
 * a spell currently on the chain; the topmost (last-in) enemy spell is the
 * natural response target, so we offer enemy-controlled spell stack items
 * (newest first). Returns a select_targets choice, or empty when none exist.
 */
function resolveTargetSpell(state: GameState, context: EffectContext): ResolvedTargets {
  const enemyId = context.controllerId === 0 ? 1 : 0;
  const spells = [...state.stack]
    .reverse()
    .filter((item) => item.type === 'spell' && item.controllerId === enemyId);
  if (spells.length === 0) {
    return { resolved: true, targetIds: [] };
  }
  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: spells.map((item) => ({ id: item.id, label: item.id })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose a spell on the stack to counter',
    },
  };
}

function resolveCardInDiscard(
  state: GameState,
  target: Extract<TargetExpr, { type: 'target_card_in_discard' }>,
  context: EffectContext,
): ResolvedTargets {
  const players = getPlayersBySide(state, target.side, context);
  const cards = players.flatMap((p) => p.discardPile);
  const filtered = applyFilter(cards, target.filter, context);
  if (filtered.length === 0) {
    return { resolved: true, targetIds: [] };
  }
  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: filtered.map((c) => ({ id: c.instanceId, label: c.name })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose a card from the discard pile',
    },
  };
}

function resolveHeroTarget(
  target: Extract<TargetExpr, { type: 'hero' }>,
  context: EffectContext,
): ResolvedTargets {
  const id =
    target.side === 'allied'
      ? `hero_${String(context.controllerId)}`
      : target.side === 'enemy'
        ? `hero_${String(context.controllerId === 0 ? 1 : 0)}`
        : `hero_${String(context.controllerId)}`;
  return { resolved: true, targetIds: [id] };
}

function resolveEquippedCharacter(state: GameState, context: EffectContext): ResolvedTargets {
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
  return { resolved: true, targetIds: filtered.map((c) => c.instanceId) };
}

function resolveAllInZone(
  state: GameState,
  target: Extract<TargetExpr, { type: 'all_characters_in_zone' }>,
  context: EffectContext,
): ResolvedTargets {
  const players = getPlayersBySide(state, target.side, context);
  const inZone = players.flatMap((p) => getCardsInZone(p.zones, target.zone));
  const cards = excludeUntargetable(inZone, context.controllerId);
  const filtered = applyFilter(cards, target.filter);
  return { resolved: true, targetIds: filtered.map((c) => c.instanceId) };
}

function resolveTargetCharacter(
  state: GameState,
  target: Extract<TargetExpr, { type: 'target_character' }>,
  context: EffectContext,
): ResolvedTargets {
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
      options: filtered.map((c) => ({ id: c.instanceId, label: c.name })),
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
  const cards = getCardsBySide(state, target.side, context);
  const filtered = applyFilter(cards, target.filter, context);
  if (filtered.length === 0) {
    return { resolved: true, targetIds: [] };
  }
  const count =
    typeof target.count === 'number' ? target.count : evaluateAmount(state, target.count, context);
  return {
    resolved: false,
    pendingChoice: {
      type: 'select_targets',
      playerId: context.controllerId,
      options: filtered.map((c) => ({ id: c.instanceId, label: c.name })),
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
  const id =
    target.side === 'allied'
      ? `hero_${String(context.controllerId)}`
      : target.side === 'enemy'
        ? `hero_${String(context.controllerId === 0 ? 1 : 0)}`
        : `hero_${String(context.controllerId)}`;
  return { resolved: true, targetIds: [id] };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCardsBySide(
  state: GameState,
  side: 'allied' | 'enemy' | 'any',
  context: EffectContext,
): readonly CardInstance[] {
  const players = getPlayersBySide(state, side, context);
  return excludeUntargetable(
    players.flatMap((p) => getAllCards(p.zones)),
    context.controllerId,
  );
}

/**
 * Exclude enemy characters the controller cannot legally target:
 *  - Hexproof: cannot be targeted by the opponent's spells or abilities (engine
 *    status; Rulebook protection family).
 *  - Stealth: "cannot be targeted by the opponent's spells or abilities until it
 *    attacks or uses an activated ability" (Rulebook 16) — excluded only while it
 *    has NOT yet acted.
 * Both remain targetable by their own controller's effects, so only cards owned by
 * the OTHER player are filtered.
 */
export function excludeUntargetable(
  cards: readonly CardInstance[],
  controllerId: 0 | 1,
): readonly CardInstance[] {
  return cards.filter((c) => c.owner === controllerId || !isUntargetableByOpponent(c));
}

function isUntargetableByOpponent(card: CardInstance): boolean {
  if (card.statusEffects.some((s) => s.statusType === 'hexproof')) return true;
  const hasStealth =
    card.traits.includes('stealth') || card.grantedTraits.some((g) => g.trait === 'stealth');
  return hasStealth && card.hasActed !== true;
}

function getPlayersBySide(
  state: GameState,
  side: 'allied' | 'enemy' | 'any',
  context: EffectContext,
): readonly (typeof state.players)[0][] {
  switch (side) {
    case 'allied':
      return [state.players[context.controllerId]];
    case 'enemy':
      return [state.players[context.controllerId === 0 ? 1 : 0]];
    case 'any':
      return [...state.players];
  }
}

export interface ApplyFilterSpec {
  readonly trait?: string;
  readonly maxCost?: number;
  readonly minCost?: number;
  readonly maxHp?: number;
  readonly maxAtk?: number;
  readonly cardType?: string;
  readonly tag?: string;
  readonly excludeSelf?: boolean;
  readonly costRelativeTo?: {
    readonly reference: 'destroyed_card' | 'cast_spell';
    readonly offset: number;
  };
}

export function applyFilter(
  cards: readonly CardInstance[],
  filter: ApplyFilterSpec | undefined,
  context?: EffectContext,
  referenceCost?: number,
): readonly CardInstance[] {
  if (filter === undefined) return cards;
  // costRelativeTo constrains total cost to (referenceCost + offset). When the
  // reference can't be resolved (no referenceCost supplied) the constraint is a
  // no-op rather than silently excluding everything.
  const relativeMax =
    filter.costRelativeTo !== undefined && referenceCost !== undefined
      ? referenceCost + filter.costRelativeTo.offset
      : undefined;
  return cards.filter((c) => {
    if (
      filter.excludeSelf === true &&
      context !== undefined &&
      c.instanceId === context.sourceInstanceId
    )
      return false;
    if (filter.trait !== undefined && !c.traits.includes(filter.trait as never)) return false;
    if (filter.tag !== undefined && !c.tags.includes(filter.tag)) return false;
    if (filter.cardType !== undefined && c.cardType !== filter.cardType) return false;
    const totalCost = c.cost.mana + c.cost.energy + c.cost.flexible;
    if (filter.maxCost !== undefined && totalCost > filter.maxCost) return false;
    if (filter.minCost !== undefined && totalCost < filter.minCost) return false;
    if (relativeMax !== undefined && totalCost > relativeMax) return false;
    if (filter.maxHp !== undefined && c.currentHp > filter.maxHp) return false;
    if (filter.maxAtk !== undefined && c.currentAtk > filter.maxAtk) return false;
    return true;
  });
}

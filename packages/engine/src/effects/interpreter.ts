/**
 * Effect Interpreter — the core AST walker.
 * Dispatches Effect types to primitive handlers.
 */
import type { Effect } from '../types/effects.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  CardInstance,
  ResourceCard,
} from '../types/game-state.js';
import { resolveTargets } from './target-resolver.js';
import { evaluateAmount } from './amount-evaluator.js';
import { evaluateCondition } from './condition-evaluator.js';
import { findCard, removeFromZone, deployToZone } from '../zones/zone-manager.js';
import { ZONE_SLOTS } from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';
import {
  updateCardInState,
  findCardInState,
  removeCardFromState,
  resetCard,
  destroyCard,
} from '../state/index.js';
import { registerScheduledEffect } from './scheduled-processor.js';
import { counterStackItem } from '../stack/stack-resolver.js';
import { canAfford, payCost } from '../actions/cost-checker.js';

function unchanged(state: GameState): EffectResult {
  return { newState: state, events: [] };
}

export function executeEffect(
  state: GameState,
  effect: Effect,
  context: EffectContext,
): EffectResult {
  switch (effect.type) {
    case 'deal_damage': return executeDealDamage(state, effect, context);
    case 'heal': return executeHeal(state, effect, context);
    case 'modify_stats': return executeModifyStats(state, effect, context);
    case 'draw_cards': return executeDrawCards(state, effect, context);
    case 'deploy_token': return executeDeployToken(state, effect, context);
    case 'destroy': return executeDestroy(state, effect, context);
    case 'bounce': return executeBounce(state, effect, context);
    case 'sacrifice': return executeSacrifice(state, effect, context);
    case 'gain_resource': return executeGainResource(state, effect, context);
    case 'grant_trait': return executeGrantTrait(state, effect, context);
    case 'apply_status': return executeApplyStatus(state, effect, context);
    case 'discard': return executeDiscard(state, effect, context);
    case 'move': return executeMove(state, effect, context);
    case 'composite': return executeComposite(state, effect, context);
    case 'conditional': return executeConditional(state, effect, context);
    case 'choose_one': return executeChooseOne(state, effect, context);
    case 'scheduled': {
      const newState = registerScheduledEffect(state, effect, context);
      return { newState, events: [] };
    }
    case 'counter_spell':
      return executeCounterSpell(state, effect, context);
    // Phase 2 primitives — stub for now
    case 'scry':
    case 'return_from_discard':
    case 'cost_reduction':
    case 'grant_ability':
    case 'replacement':
    case 'cleanse':
    case 'search_deck':
    case 'shuffle_into_deck':
    case 'copy_card':
    case 'deploy_from_deck':
    case 'attach_as_equipment':
      return unchanged(state);
  }
}

// ── P1 Primitives ────────────────────────────────────────────────────────────

function executeDealDamage(
  state: GameState,
  effect: Extract<Effect, { type: 'deal_damage' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const amount = evaluateAmount(state, effect.amount, context);
  const events: GameEvent[] = [];
  let currentState = state;

  for (const targetId of resolved.targetIds) {
    if (targetId.startsWith('hero_')) {
      const playerId = Number(targetId.split('_')[1]) as 0 | 1;
      const hero = currentState.players[playerId]!.hero;
      const newLp = Math.max(0, hero.currentLp - amount);
      events.push({ type: 'HERO_DAMAGED', playerId, amount, sourceId: context.sourceInstanceId });
      const newPlayers = [...currentState.players] as [typeof currentState.players[0], typeof currentState.players[1]];
      newPlayers[playerId] = { ...currentState.players[playerId]!, hero: { ...hero, currentLp: newLp } };
      currentState = { ...currentState, players: newPlayers };
      if (newLp <= 0) {
        const opponentId = (playerId === 0 ? 1 : 0) as 0 | 1;
        currentState = { ...currentState, winner: opponentId };
      }
    } else {
      const targetCard = findCardInState(currentState, targetId);
      if (targetCard === null) {
        continue;
      }
      const actualDamage = Math.max(0, amount - targetCard.currentArm);
      events.push({ type: 'DAMAGE_DEALT', sourceId: context.sourceInstanceId, targetId, amount: actualDamage });
      currentState = updateCardInState(currentState, targetId, c => ({
        ...c, currentHp: c.currentHp - actualDamage,
      }));
      // Check destruction
      const cardCheck = findCardInState(currentState, targetId);
      if (cardCheck !== null && cardCheck.currentHp <= 0) {
        const destruction = destroyCard(currentState, targetId, 'effect');
        currentState = destruction.state;
        events.push(...destruction.events);
      }
    }
  }

  return { newState: currentState, events };
}

function executeHeal(
  state: GameState,
  effect: Extract<Effect, { type: 'heal' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const amount = evaluateAmount(state, effect.amount, context);
  const events: GameEvent[] = [];
  let currentState = state;

  for (const targetId of resolved.targetIds) {
    if (targetId.startsWith('hero_')) {
      const playerId = Number(targetId.split('_')[1]) as 0 | 1;
      const hero = currentState.players[playerId]!.hero;
      const healed = Math.min(amount, hero.maxLp - hero.currentLp);
      if (healed > 0) {
        events.push({ type: 'HERO_HEALED', playerId, amount: healed });
        const newPlayers = [...currentState.players] as [typeof currentState.players[0], typeof currentState.players[1]];
        newPlayers[playerId] = { ...currentState.players[playerId]!, hero: { ...hero, currentLp: hero.currentLp + healed } };
        currentState = { ...currentState, players: newPlayers };
      }
    } else {
      currentState = updateCardInState(currentState, targetId, c => {
        const healed = Math.min(amount, c.baseHp - c.currentHp);
        if (healed > 0) events.push({ type: 'CHARACTER_HEALED', cardInstanceId: targetId, amount: healed });
        const excess = amount - (c.baseHp - c.currentHp);
        if (excess > 0) events.push({ type: 'CHARACTER_OVERHEALED', cardInstanceId: targetId, excess });
        return { ...c, currentHp: Math.min(c.baseHp, c.currentHp + amount) };
      });
    }
  }

  return { newState: currentState, events };
}

function executeModifyStats(
  state: GameState,
  effect: Extract<Effect, { type: 'modify_stats' }>,
  context: EffectContext,
): EffectResult {
  // Dynamic modifier requires runtime evaluation — stub for now
  if (effect.dynamicModifier !== undefined) return unchanged(state);

  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;

  const modifiedTargets: string[] = [];
  for (const targetId of resolved.targetIds) {
    events.push({ type: 'STAT_MODIFIED', cardInstanceId: targetId, modifier: effect.modifier });
    currentState = updateCardInState(currentState, targetId, c => ({
      ...c,
      currentAtk: c.currentAtk + (effect.modifier.atk ?? 0),
      currentHp: Math.max(0, c.currentHp + (effect.modifier.hp ?? 0)),
      currentArm: c.currentArm + (effect.modifier.arm ?? 0),
    }));
    modifiedTargets.push(targetId);
  }

  // Stat-reduction destruction check: if HP reduced to 0, destroy
  for (const targetId of modifiedTargets) {
    const card = findCardInState(currentState, targetId);
    if (card !== null && card.currentHp <= 0) {
      const destruction = destroyCard(currentState, targetId, 'effect');
      currentState = destruction.state;
      events.push(...destruction.events);
    }
  }

  return { newState: currentState, events };
}

function executeDrawCards(
  state: GameState,
  effect: Extract<Effect, { type: 'draw_cards' }>,
  context: EffectContext,
): EffectResult {
  const count = evaluateAmount(state, effect.count, context);
  const playerIdx = effect.player === 'enemy'
    ? (context.controllerId === 0 ? 1 : 0) as 0 | 1
    : context.controllerId;

  const player = state.players[playerIdx]!;
  if (count > player.mainDeck.length) {
    return {
      newState: {
        ...state,
        winner: (playerIdx === 0 ? 1 : 0) as 0 | 1,
      },
      events: [],
    };
  }
  const drawCount = Math.min(count, player.mainDeck.length);
  if (drawCount === 0) return unchanged(state);

  const drawn = player.mainDeck.slice(0, drawCount);
  const remaining = player.mainDeck.slice(drawCount);

  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  newPlayers[playerIdx] = {
    ...player,
    hand: [...player.hand, ...drawn],
    mainDeck: remaining,
  };

  return {
    newState: { ...state, players: newPlayers },
    events: [{ type: 'CARD_DRAWN', playerId: playerIdx, count: drawCount }],
  };
}

function executeDeployToken(
  state: GameState,
  effect: Extract<Effect, { type: 'deploy_token' }>,
  context: EffectContext,
): EffectResult {
  const zone: ZoneType = effect.zone ?? 'frontline';
  const events: GameEvent[] = [];
  let currentState = state;

  const count = effect.inEachEmpty === true
    ? ZONE_SLOTS[zone]
    : (effect.count ?? 1);

  for (let i = 0; i < count; i++) {
    const player = currentState.players[context.controllerId]!;
    const zoneArr = zone === 'reserve' ? player.zones.reserve
      : zone === 'frontline' ? player.zones.frontline
      : player.zones.highGround;
    const openSlot = zoneArr.findIndex(s => s === null);
    if (openSlot === -1) break;

    const tokenId = currentState.rng.counter + 1;
    currentState = { ...currentState, rng: { ...currentState.rng, counter: tokenId } };
    const token: CardInstance = {
      instanceId: `token_${String(tokenId)}`,
      cardDefId: 0,
      name: effect.token.name,
      cardType: 'C',
      rarity: 'Common',
      currentHp: effect.token.hp,
      currentAtk: effect.token.atk,
      currentArm: effect.token.arm ?? 0,
      baseHp: effect.token.hp,
      baseAtk: effect.token.atk,
      baseArm: effect.token.arm ?? 0,
      exhausted: true,
      summoningSick: true,
      movedThisTurn: false,
      attackedThisTurn: false,
      traits: [...(effect.token.traits ?? [])],
      grantedTraits: [],
      abilities: [],
      abilityCooldowns: new Map(),
      activatedAbilityTurns: new Map(),
      registeredTriggers: [],
      modifiers: [],
      statusEffects: [],
      equipment: null,
      isToken: true,
      tags: [...(effect.token.tags ?? [])],
      cost: { mana: 0, energy: 0, flexible: 0 },
      resourceTypes: ['mana'],
      alignment: [],
      artUrl: null,
      owner: context.controllerId,
      abilitiesSuppressed: false,
      transferredThisTurn: false,
    };

    const newZones = deployToZone(player.zones, token, zone, openSlot);
    const newPlayers = [...currentState.players] as [typeof currentState.players[0], typeof currentState.players[1]];
    newPlayers[context.controllerId] = { ...player, zones: newZones };
    currentState = { ...currentState, players: newPlayers };
    events.push({ type: 'CARD_DEPLOYED', cardInstanceId: token.instanceId, zone, playerId: context.controllerId });
  }

  return { newState: currentState, events };
}

function executeDestroy(
  state: GameState,
  effect: Extract<Effect, { type: 'destroy' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    const destruction = destroyCard(currentState, targetId, 'effect');
    currentState = destruction.state;
    events.push(...destruction.events);
  }
  return { newState: currentState, events };
}

function executeBounce(
  state: GameState,
  effect: Extract<Effect, { type: 'bounce' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    const card = findCardInState(currentState, targetId);
    if (card === null) continue;
    events.push({ type: 'CARD_BOUNCED', cardInstanceId: targetId });
    currentState = removeCardFromState(currentState, targetId);
    if (!card.isToken) {
      // Return to owner's hand (and remove from discard pile where removeCardFromState put it)
      const ownerState = currentState.players[card.owner]!;
      // If the card had equipment, send it to discard separately
      const equipmentToDiscard = card.equipment !== null ? [card.equipment] : [];
      const newPlayers = [...currentState.players] as [typeof currentState.players[0], typeof currentState.players[1]];
      newPlayers[card.owner] = {
        ...ownerState,
        discardPile: [
          ...ownerState.discardPile.filter(c => c.instanceId !== card.instanceId),
          ...equipmentToDiscard,
        ],
        hand: [...ownerState.hand, resetCard(card)],
      };
      currentState = { ...currentState, players: newPlayers };
      if (card.equipment !== null) {
        events.push({ type: 'CARD_DESTROYED', cardInstanceId: card.equipment.instanceId, cause: 'effect', playerId: card.owner });
      }
    }
    // Tokens are removed from game when bounced
  }
  return { newState: currentState, events };
}

function executeSacrifice(
  state: GameState,
  effect: Extract<Effect, { type: 'sacrifice' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    events.push({ type: 'CARD_SACRIFICED', cardInstanceId: targetId });
    const destruction = destroyCard(currentState, targetId, 'sacrifice');
    currentState = destruction.state;
    events.push(...destruction.events);
  }
  return { newState: currentState, events };
}

function executeGainResource(
  state: GameState,
  effect: Extract<Effect, { type: 'gain_resource' }>,
  context: EffectContext,
): EffectResult {
  const player = state.players[context.controllerId]!;
  const newPlayers = [...state.players] as [typeof state.players[0], typeof state.players[1]];

  if (effect.temporary === true) {
    newPlayers[context.controllerId] = {
      ...player,
      temporaryResources: [
        ...player.temporaryResources,
        { resourceType: effect.resourceType, amount: effect.amount },
      ],
    };
  } else {
    // Permanent: add ResourceCards to the bank
    const newCards: ResourceCard[] = [];
    for (let i = 0; i < effect.amount; i++) {
      const cardId = state.rng.counter + i + 1;
      newCards.push({
        instanceId: `res_gained_${String(cardId)}`,
        resourceType: effect.resourceType,
        exhausted: false,
      });
    }
    newPlayers[context.controllerId] = {
      ...player,
      resourceBank: [...player.resourceBank, ...newCards],
    };
  }

  return {
    newState: { ...state, players: newPlayers, rng: { ...state.rng, counter: state.rng.counter + effect.amount } },
    events: [{
      type: 'RESOURCE_GAINED',
      playerId: context.controllerId,
      resourceType: effect.resourceType,
      amount: effect.amount,
    }],
  };
}

function executeGrantTrait(
  state: GameState,
  effect: Extract<Effect, { type: 'grant_trait' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updateCardInState(currentState, targetId, c => ({
      ...c,
      grantedTraits: [
        ...c.grantedTraits,
        {
          trait: effect.trait,
          sourceInstanceId: context.sourceInstanceId,
          duration: effect.duration.type === 'permanent'
            ? { type: 'permanent' as const }
            : effect.duration.type === 'until_end_of_turn'
              ? { type: 'until_end_of_turn' as const }
              : { type: 'permanent' as const },
        },
      ],
    }));
  }
  return { newState: currentState, events: [] };
}

function executeApplyStatus(
  state: GameState,
  effect: Extract<Effect, { type: 'apply_status' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updateCardInState(currentState, targetId, c => ({
      ...c,
      statusEffects: mergeStatusEffect(
        c.statusEffects,
        {
          statusType: effect.status,
          value: effect.value ?? 1,
          remainingTurns: effect.durationTurns ?? null,
        },
      ),
    }));
  }
  return { newState: currentState, events: [] };
}

function mergeStatusEffect(
  statuses: readonly CardInstance['statusEffects'][number][],
  nextStatus: CardInstance['statusEffects'][number],
): readonly CardInstance['statusEffects'][number][] {
  const existing = statuses.find(status => status.statusType === nextStatus.statusType);
  if (existing === undefined) {
    return [...statuses, nextStatus];
  }

  if (nextStatus.statusType === 'persistent' || nextStatus.statusType === 'regeneration') {
    if (nextStatus.value <= existing.value) {
      return statuses;
    }
  }

  return [
    ...statuses.filter(status => status.statusType !== nextStatus.statusType),
    {
      ...existing,
      ...nextStatus,
      remainingTurns: existing.remainingTurns === null
        ? nextStatus.remainingTurns
        : Math.max(existing.remainingTurns, nextStatus.remainingTurns ?? 0),
    },
  ];
}

function executeDiscard(
  state: GameState,
  effect: Extract<Effect, { type: 'discard' }>,
  context: EffectContext,
): EffectResult {
  // Resolve target player from effect.target
  const targetPlayerId = 'side' in effect.target && effect.target.side === 'enemy'
    ? (context.controllerId === 0 ? 1 : 0) as 0 | 1
    : context.controllerId;

  const player = state.players[targetPlayerId]!;
  if (player.hand.length === 0) return unchanged(state);

  return {
    newState: state,
    events: [],
    pendingChoice: {
      type: 'choose_discard',
      playerId: targetPlayerId,
      options: player.hand.map(c => ({ id: c.instanceId, label: c.name, instanceId: c.instanceId })),
      minSelections: Math.min(effect.count, player.hand.length),
      maxSelections: Math.min(effect.count, player.hand.length),
      context: `Discard ${String(effect.count)} card(s)`,
    },
  };
}

function executeMove(
  state: GameState,
  effect: Extract<Effect, { type: 'move' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  if (effect.destination === 'any' || effect.destination === 'adjacent_to_current') {
    // Requires player choice — not yet implemented
    return unchanged(state);
  }

  const events: GameEvent[] = [];
  let currentState = state;

  for (const targetId of resolved.targetIds) {
    for (let pi = 0; pi < 2; pi++) {
      const player = currentState.players[pi]!;
      const location = findCard(player.zones, targetId);
      if (location === null) continue;

      const fromZone = location.zone;
      const toZone = effect.destination;
      if (fromZone === toZone) break;

      const { zones: clearedZones } = removeFromZone(player.zones, targetId);
      const movedCard: CardInstance = { ...location.card, movedThisTurn: true };
      try {
        const newZones = deployToZone(clearedZones, movedCard, toZone);
        const newPlayers = [...currentState.players] as [typeof currentState.players[0], typeof currentState.players[1]];
        newPlayers[pi] = { ...player, zones: newZones };
        currentState = { ...currentState, players: newPlayers };
        events.push({ type: 'CARD_MOVED', cardInstanceId: targetId, fromZone, toZone });
      } catch {
        // No open slot in destination — skip
      }
      break;
    }
  }

  return { newState: currentState, events };
}

// ── Compound Effects ─────────────────────────────────────────────────────────

function executeComposite(
  state: GameState,
  effect: Extract<Effect, { type: 'composite' }>,
  context: EffectContext,
): EffectResult {
  let currentState = state;
  const allEvents: GameEvent[] = [];

  for (const subEffect of effect.effects) {
    const result = executeEffect(currentState, subEffect, context);
    currentState = result.newState;
    allEvents.push(...result.events);
    if (result.pendingChoice !== undefined) {
      return { newState: currentState, events: allEvents, pendingChoice: result.pendingChoice };
    }
  }

  return { newState: currentState, events: allEvents };
}

function executeConditional(
  state: GameState,
  effect: Extract<Effect, { type: 'conditional' }>,
  context: EffectContext,
): EffectResult {
  const conditionMet = evaluateCondition(state, effect.condition, context);
  const effects = conditionMet ? effect.ifTrue : (effect.ifFalse ?? []);

  let currentState = state;
  const allEvents: GameEvent[] = [];
  for (const subEffect of effects) {
    const result = executeEffect(currentState, subEffect, context);
    currentState = result.newState;
    allEvents.push(...result.events);
    if (result.pendingChoice !== undefined) {
      return { newState: currentState, events: allEvents, pendingChoice: result.pendingChoice };
    }
  }

  return { newState: currentState, events: allEvents };
}

function executeChooseOne(
  state: GameState,
  effect: Extract<Effect, { type: 'choose_one' }>,
  context: EffectContext,
): EffectResult {
  return {
    newState: state,
    events: [],
    pendingChoice: {
      type: 'choose_one',
      playerId: context.controllerId,
      options: effect.options.map((opt, i) => ({
        id: String(i),
        label: opt.label,
      })),
      minSelections: 1,
      maxSelections: 1,
      context: 'Choose one option',
    },
  };
}

function executeCounterSpell(
  state: GameState,
  effect: Extract<Effect, { type: 'counter_spell' }>,
  context: EffectContext,
): EffectResult {
  const targetItem = resolveCounterTargetItem(state, effect, context);
  if ('pendingChoice' in targetItem) {
    return {
      newState: state,
      events: [],
      pendingChoice: targetItem.pendingChoice,
    };
  }
  if (targetItem.item === null) {
    return unchanged(state);
  }

  if (effect.unlessPay !== undefined) {
    const targetPlayer = state.players[targetItem.item.controllerId]!;
    if (canAfford(targetPlayer, effect.unlessPay)) {
      return {
        newState: state,
        events: [],
        pendingChoice: {
          type: 'pay_unless',
          playerId: targetItem.item.controllerId,
          options: [
            { id: 'pay', label: `Pay ${formatCost(effect.unlessPay)}` },
            { id: 'dont_pay', label: 'Do not pay' },
          ],
          minSelections: 1,
          maxSelections: 1,
          context: 'Pay to prevent this spell from being countered.',
        },
      };
    }
  }

  return applyCounterToStackItem(state, targetItem.item.id, targetItem.item.sourceInstanceId);
}

export function resumeCounterSpellEffect(
  state: GameState,
  effect: Extract<Effect, { type: 'counter_spell' }>,
  context: EffectContext,
  selectedOptionId: string | undefined,
): EffectResult {
  const targetItem = resolveCounterTargetItem(state, effect, context);
  if ('pendingChoice' in targetItem || targetItem.item === null) {
    return unchanged(state);
  }

  if (selectedOptionId === 'pay' && effect.unlessPay !== undefined) {
    const player = state.players[targetItem.item.controllerId]!;
    if (canAfford(player, effect.unlessPay)) {
      return {
        newState: setPlayer(state, targetItem.item.controllerId, payCost(player, effect.unlessPay)),
        events: [],
      };
    }
  }

  return applyCounterToStackItem(state, targetItem.item.id, targetItem.item.sourceInstanceId);
}

function resolveCounterTargetItem(
  state: GameState,
  effect: Extract<Effect, { type: 'counter_spell' }>,
  context: EffectContext,
): { readonly item: GameState['stack'][number] | null } | { readonly pendingChoice: EffectResult['pendingChoice'] } {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved) {
    return { pendingChoice: resolved.pendingChoice };
  }

  const targetItemId = resolved.targetIds[0];
  if (targetItemId === undefined) {
    return { item: null };
  }

  const targetItem = state.stack.find(item => item.id === targetItemId && item.countered !== true);
  return { item: targetItem ?? null };
}

function applyCounterToStackItem(
  state: GameState,
  stackItemId: string,
  sourceInstanceId: string,
): EffectResult {
  return {
    newState: counterStackItem(state, stackItemId),
    events: [{ type: 'SPELL_COUNTERED', cardInstanceId: sourceInstanceId }],
  };
}

function formatCost(cost: Extract<Effect, { type: 'counter_spell' }>['unlessPay']): string {
  if (cost === undefined) return '0';
  const parts = [
    cost.mana > 0 ? `${String(cost.mana)}M` : '',
    cost.energy > 0 ? `${String(cost.energy)}E` : '',
    cost.flexible > 0 ? `${String(cost.flexible)}F` : '',
  ].filter(Boolean);
  return parts.join(' ') || '0';
}

function setPlayer(
  state: GameState,
  playerId: 0 | 1,
  player: typeof state.players[0],
): GameState {
  const players = [...state.players] as [typeof state.players[0], typeof state.players[1]];
  players[playerId] = player;
  return { ...state, players };
}


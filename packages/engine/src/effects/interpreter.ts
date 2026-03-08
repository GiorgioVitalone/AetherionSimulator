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
} from '../types/game-state.js';
import { resolveTargets } from './target-resolver.js';
import { evaluateAmount } from './amount-evaluator.js';
import { evaluateCondition } from './condition-evaluator.js';
import { findCard, removeFromZone, deployToZone } from '../zones/zone-manager.js';
import { ZONE_SLOTS } from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';

function unchanged(state: GameState): EffectResult {
  return { newState: state, events: [] };
}

function updateCardInState(
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
    // Phase 2 primitives — stub for now
    case 'scry':
    case 'counter_spell':
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
    case 'scheduled':
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
      if (newLp <= 0) currentState = { ...currentState, winner: context.controllerId };
    } else {
      events.push({ type: 'DAMAGE_DEALT', sourceId: context.sourceInstanceId, targetId, amount });
      currentState = updateCardInState(currentState, targetId, c => ({
        ...c, currentHp: c.currentHp - amount,
      }));
      // Check destruction
      const cardCheck = findCardInState(currentState, targetId);
      if (cardCheck !== null && cardCheck.currentHp <= 0) {
        events.push({ type: 'CARD_DESTROYED', cardInstanceId: targetId, cause: 'effect' });
        currentState = removeCardFromState(currentState, targetId);
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

  for (const targetId of resolved.targetIds) {
    events.push({ type: 'STAT_MODIFIED', cardInstanceId: targetId, modifier: effect.modifier });
    currentState = updateCardInState(currentState, targetId, c => ({
      ...c,
      currentAtk: c.currentAtk + (effect.modifier.atk ?? 0),
      currentHp: c.currentHp + (effect.modifier.hp ?? 0),
      currentArm: c.currentArm + (effect.modifier.arm ?? 0),
    }));
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
  let tokenCounter = 0;

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

    tokenCounter++;
    const token: CardInstance = {
      instanceId: `token_${context.sourceInstanceId}_${String(tokenCounter)}`,
      cardDefId: 0,
      name: effect.token.name,
      cardType: 'C',
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
      registeredTriggers: [],
      modifiers: [],
      statusEffects: [],
      equipment: null,
      isToken: true,
      tags: [...(effect.token.tags ?? [])],
      cost: { mana: 0, energy: 0, flexible: 0 },
      alignment: [],
      owner: context.controllerId,
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
    events.push({ type: 'CARD_DESTROYED', cardInstanceId: targetId, cause: 'effect' });
    currentState = removeCardFromState(currentState, targetId);
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
      // Return to owner's hand
      const newPlayers = [...currentState.players] as [typeof currentState.players[0], typeof currentState.players[1]];
      newPlayers[card.owner] = {
        ...currentState.players[card.owner]!,
        hand: [...currentState.players[card.owner]!.hand, resetCard(card)],
      };
      currentState = { ...currentState, players: newPlayers };
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
    events.push({ type: 'CARD_DESTROYED', cardInstanceId: targetId, cause: 'sacrifice' });
    currentState = removeCardFromState(currentState, targetId);
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
  }

  return {
    newState: { ...state, players: newPlayers },
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
      statusEffects: [
        ...c.statusEffects,
        {
          statusType: effect.status,
          value: effect.value ?? 1,
          remainingTurns: effect.durationTurns ?? null,
        },
      ],
    }));
  }
  return { newState: currentState, events: [] };
}

function executeDiscard(
  state: GameState,
  _effect: Extract<Effect, { type: 'discard' }>,
  context: EffectContext,
): EffectResult {
  // Requires player choice — return PendingChoice
  const player = state.players[context.controllerId]!;
  if (player.hand.length === 0) return unchanged(state);

  return {
    newState: state,
    events: [],
    pendingChoice: {
      type: 'choose_discard',
      playerId: context.controllerId,
      options: player.hand.map(c => ({ id: c.instanceId, label: c.name })),
      minSelections: Math.min(_effect.count, player.hand.length),
      maxSelections: Math.min(_effect.count, player.hand.length),
      context: `Discard ${String(_effect.count)} card(s)`,
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

  // Simplified: just track the move event
  const events: GameEvent[] = [];
  for (const targetId of resolved.targetIds) {
    if (effect.destination !== 'any' && effect.destination !== 'adjacent_to_current') {
      events.push({
        type: 'CARD_MOVED',
        cardInstanceId: targetId,
        fromZone: 'frontline', // simplified
        toZone: effect.destination,
      });
    }
  }
  return { newState: state, events };
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function findCardInState(state: GameState, instanceId: string): CardInstance | null {
  for (const player of state.players) {
    const loc = findCard(player.zones, instanceId);
    if (loc !== null) return loc.card;
  }
  return null;
}

function removeCardFromState(state: GameState, instanceId: string): GameState {
  const newPlayers = state.players.map(player => {
    const { zones, removed } = removeFromZone(player.zones, instanceId);
    return {
      ...player,
      zones,
      discardPile: removed !== null && !removed.isToken
        ? [...player.discardPile, removed]
        : player.discardPile,
    };
  }) as unknown as readonly [typeof state.players[0], typeof state.players[1]];
  return { ...state, players: newPlayers };
}

function resetCard(card: CardInstance): CardInstance {
  return {
    ...card,
    currentHp: card.baseHp,
    currentAtk: card.baseAtk,
    currentArm: card.baseArm,
    exhausted: false,
    summoningSick: false,
    movedThisTurn: false,
    attackedThisTurn: false,
    grantedTraits: [],
    modifiers: [],
    statusEffects: [],
    registeredTriggers: [],
    equipment: null,
  };
}

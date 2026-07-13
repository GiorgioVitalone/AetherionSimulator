/**
 * Effect Interpreter — the core AST walker.
 * Dispatches Effect types to primitive handlers.
 */
import type { Effect } from '../types/effects.js';
import type { Duration } from '../types/durations.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  CardInstance,
  PlayerState,
  ResourceCard,
  RegisteredTrigger,
  ActiveModifier,
  GrantedDuration,
  ZoneState,
} from '../types/game-state.js';
import type { TriggeredAbilityDSL } from '../types/ability.js';
import { resolveTargets } from './target-resolver.js';
import { evaluateAmount, evaluateDynamicStat } from './amount-evaluator.js';
import type { StatModifier } from '../types/common.js';
import { evaluateCondition } from './condition-evaluator.js';
import { findCard, removeFromZone, deployToZone, getZoneArray } from '../zones/zone-manager.js';
import { updateCardInState, findCardInState, removeCardFromState } from './state-helpers.js';
import { isExiledOnDestruction } from './destruction-destination.js';
import {
  executeReturnFromDiscard,
  executeSearchDeck,
  executeShuffleIntoDeck,
  executeCleanse,
  executeDeployFromDeck,
  executeCopyCard,
} from './discard-deck-handlers.js';
import { executeScry } from './scry-handler.js';
import { executeCounterSpell } from './counter-handler.js';
import { triggerRateLimits } from '../events/trigger-registry.js';
import {
  executeReplacement,
  applyDamageReplacements,
  findDestructionReplacement,
  markReplacementsUsed,
} from './replacement-handler.js';
import { executeCostReduction } from './cost-reduction-handler.js';
import { executeScheduled } from './scheduled-handler.js';
import { executeAttachAsEquipment } from './attach-handler.js';
import { rngPrepass } from './rng-prepass.js';
import type { ActiveReplacement } from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';

function unchanged(state: GameState): EffectResult {
  return { newState: state, events: [] };
}

export function executeEffect(
  state: GameState,
  effect: Effect,
  context: EffectContext,
): EffectResult {
  // DIAGNOSTIC ABLATION: no-op any effect type the config disables (e.g. to
  // neutralize value-loop/recursion mechanics generically). Default: no-op set
  // is absent => normal resolution.
  if (state.config?.disableEffectTypes?.includes(effect.type) === true) {
    return unchanged(state);
  }
  // RNG pre-pass: roll `dice` amounts and resolve `random` targets once via the
  // seeded RNG (advancing the counter on `state`), threading the results onto the
  // context so the handlers consume them deterministically.
  const prepped = rngPrepass(state, effect, context);
  state = prepped.state;
  context = prepped.context;
  switch (effect.type) {
    case 'deal_damage':
      return executeDealDamage(state, effect, context);
    case 'heal':
      return executeHeal(state, effect, context);
    case 'modify_stats':
      return executeModifyStats(state, effect, context);
    case 'draw_cards':
      return executeDrawCards(state, effect, context);
    case 'deploy_token':
      return executeDeployToken(state, effect, context);
    case 'destroy':
      return executeDestroy(state, effect, context);
    case 'bounce':
      return executeBounce(state, effect, context);
    case 'sacrifice':
      return executeSacrifice(state, effect, context);
    case 'gain_resource':
      return executeGainResource(state, effect, context);
    case 'grant_trait':
      return executeGrantTrait(state, effect, context);
    case 'apply_status':
      return executeApplyStatus(state, effect, context);
    case 'discard':
      return executeDiscard(state, effect, context);
    case 'move':
      return executeMove(state, effect, context);
    case 'composite':
      return executeComposite(state, effect, context);
    case 'conditional':
      return executeConditional(state, effect, context);
    case 'choose_one':
      return executeChooseOne(state, effect, context);
    case 'return_from_discard':
      return executeReturnFromDiscard(state, effect, context);
    case 'scry':
      return executeScry(state, effect, context);
    case 'search_deck':
      return executeSearchDeck(state, effect, context);
    case 'shuffle_into_deck':
      return executeShuffleIntoDeck(state, effect, context);
    case 'cleanse':
      return executeCleanse(state, effect, context);
    case 'deploy_from_deck':
      return executeDeployFromDeck(state, effect, context);
    case 'copy_card':
      return executeCopyCard(state, effect, context);
    case 'grant_ability':
      return executeGrantAbility(state, effect, context);
    case 'counter_spell':
      return executeCounterSpell(state, effect, context);
    case 'replacement':
      return executeReplacement(state, effect, context);
    case 'cost_reduction':
      return executeCostReduction(state, effect, context);
    case 'scheduled':
      return executeScheduled(state, effect, context);
    case 'attach_as_equipment':
      return executeAttachAsEquipment(state, effect, context);
  }
}

// ── P1 Primitives ────────────────────────────────────────────────────────────

function executeDealDamage(
  state: GameState,
  effect: Extract<Effect, { type: 'deal_damage' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const amount = evaluateAmount(state, effect.amount, context);
  const events: GameEvent[] = [];
  let currentState = state;

  // DIAGNOSTIC ABLATION (default absent ⇒ no-op): config.disableHeroReachBySeat
  // makes the controlling seat unable to reduce the ENEMY Hero's LP via a direct
  // damage effect. Self-targeted hero damage (the controller's own hero) is
  // unaffected. Default (absent / both false) leaves this path byte-identical.
  const heroReachDisabled =
    currentState.config?.disableHeroReachBySeat?.[context.controllerId] === true;

  for (const targetId of resolved.targetIds) {
    if (targetId.startsWith('hero_')) {
      const playerId = Number(targetId.split('_')[1]) as 0 | 1;
      if (heroReachDisabled && playerId !== context.controllerId) continue;
      const hero = currentState.players[playerId].hero;
      const newLp = Math.max(0, hero.currentLp - amount);
      events.push({ type: 'HERO_DAMAGED', playerId, amount, sourceId: context.sourceInstanceId });
      const newPlayers = [...currentState.players] as [
        (typeof currentState.players)[0],
        (typeof currentState.players)[1],
      ];
      newPlayers[playerId] = {
        ...currentState.players[playerId],
        hero: { ...hero, currentLp: newLp },
      };
      currentState = { ...currentState, players: newPlayers };
      if (newLp <= 0) {
        const opponentId = playerId === 0 ? 1 : 0;
        currentState = { ...currentState, winner: opponentId };
      }
    } else {
      const target = findCardInState(currentState, targetId);
      if (target === null) continue;
      // Replacement hook: reduce/prevent incoming damage before HP is reduced.
      const dmg = applyDamageReplacements(target, amount);
      currentState = markReplacementsUsed(currentState, targetId, dmg.consumedIds);
      events.push({
        type: 'DAMAGE_DEALT',
        sourceId: context.sourceInstanceId,
        targetId,
        amount: dmg.amount,
      });
      currentState = updateCardInState(currentState, targetId, (c) => ({
        ...c,
        currentHp: c.currentHp - dmg.amount,
      }));
      // Check destruction (subject to "would be destroyed" replacement).
      const cardCheck = findCardInState(currentState, targetId);
      if (cardCheck !== null && cardCheck.currentHp <= 0) {
        const destruction = destroyOrReplace(currentState, cardCheck, 'effect', context);
        currentState = destruction.newState;
        events.push(...destruction.events);
      }
    }
  }

  return { newState: currentState, events };
}

/**
 * Destroy a card, or run its "would be destroyed" replacement instead.
 * Returns the new state plus the events produced. Pure.
 */
function destroyOrReplace(
  state: GameState,
  card: CardInstance,
  cause: 'combat' | 'effect' | 'sacrifice',
  context: EffectContext,
): EffectResult {
  const replacement = findDestructionReplacement(card);
  if (replacement === null) {
    const destroyed: GameEvent = {
      type: 'CARD_DESTROYED',
      cardInstanceId: card.instanceId,
      cardDefId: card.cardDefId,
      cause,
      playerId: card.owner,
    };
    // A Volatile non-token unit is destroyed (Last Breath still fires) but its body
    // is exiled rather than discarded — emit CARD_EXILED for the destination.
    const events: GameEvent[] =
      !card.isToken && isExiledOnDestruction(card)
        ? [
            destroyed,
            {
              type: 'CARD_EXILED',
              cardInstanceId: card.instanceId,
              cardDefId: card.cardDefId,
              playerId: card.owner,
            },
          ]
        : [destroyed];
    // The holder's equipment follows it to the discard pile (Rulebook 13). Emit its
    // own CARD_DESTROYED so discard-recursion watchers can see it (mirrors bounce).
    if (card.equipment !== null) {
      events.push({
        type: 'CARD_DESTROYED',
        cardInstanceId: card.equipment.instanceId,
        cardDefId: card.equipment.cardDefId,
        cause: 'effect',
        playerId: card.owner,
      });
    }
    return { newState: removeCardFromState(state, card.instanceId), events };
  }
  return runDestructionReplacement(state, card, replacement, context);
}

/** Mark the replacement used, then run its `instead` effects in place of destruction. */
function runDestructionReplacement(
  state: GameState,
  card: CardInstance,
  replacement: ActiveReplacement,
  context: EffectContext,
): EffectResult {
  let currentState = markReplacementsUsed(state, card.instanceId, [replacement.id]);
  const events: GameEvent[] = [];
  const insteadContext: EffectContext = { ...context, sourceInstanceId: card.instanceId };
  for (const subEffect of replacement.instead) {
    const result = executeEffect(currentState, subEffect, insteadContext);
    currentState = result.newState;
    events.push(...result.events);
  }
  return { newState: currentState, events };
}

function executeHeal(
  state: GameState,
  effect: Extract<Effect, { type: 'heal' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  // DIAGNOSTIC ABLATION: scale every heal by config.healScale (default 1).
  const scale = state.config?.healScale ?? 1;
  const amount = Math.round(evaluateAmount(state, effect.amount, context) * scale);
  const events: GameEvent[] = [];
  let currentState = state;

  // DIAGNOSTIC INSTRUMENTATION (no-op for game logic): tag each realized heal with
  // its SOURCE instance id (`hero_<defId>` for hero abilities, else the card id) so
  // an offline read can split realized healing by source. Optional event field.
  const srcId = context.sourceInstanceId;

  // EC-005 (config.disableHeroHealing): nullify any heal whose realized target is a
  // HERO; character healing below is untouched. Default OFF ⇒ this branch is skipped
  // and the heal path is byte-identical to the v10 baseline.
  const disableHeroHealing = currentState.config?.disableHeroHealing === true;
  const diag = currentState.config?.diag;

  for (const targetId of resolved.targetIds) {
    if (targetId.startsWith('hero_')) {
      const playerId = Number(targetId.split('_')[1]) as 0 | 1;
      const hero = currentState.players[playerId].hero;
      if (disableHeroHealing) {
        // Tally the LP the rule removed (capped by live headroom), then no-op the heal.
        if (diag?.heroHealRemoved) {
          diag.heroHealRemoved[playerId] += Math.min(amount, hero.maxLp - hero.currentLp);
        }
        continue;
      }
      const healed = Math.min(amount, hero.maxLp - hero.currentLp);
      if (healed > 0) {
        events.push({ type: 'HERO_HEALED', playerId, amount: healed, sourceId: srcId });
        const newPlayers = [...currentState.players] as [
          (typeof currentState.players)[0],
          (typeof currentState.players)[1],
        ];
        newPlayers[playerId] = {
          ...currentState.players[playerId],
          hero: { ...hero, currentLp: hero.currentLp + healed },
        };
        currentState = { ...currentState, players: newPlayers };
      }
    } else {
      // DESIGN-SWEEP (config.noOverheal): healing already clamps currentHp to baseHp;
      // when set, also suppress the CHARACTER_OVERHEALED signal so no `on_overheal`
      // trigger pays off. Default OFF ⇒ the overheal event still fires (no-op).
      const noOverheal = currentState.config?.noOverheal === true;
      currentState = updateCardInState(currentState, targetId, (c) => {
        const healed = Math.min(amount, c.baseHp - c.currentHp);
        if (healed > 0)
          events.push({
            type: 'CHARACTER_HEALED',
            cardInstanceId: targetId,
            amount: healed,
            sourceId: srcId,
          });
        const excess = amount - (c.baseHp - c.currentHp);
        if (excess > 0 && !noOverheal)
          events.push({ type: 'CHARACTER_OVERHEALED', cardInstanceId: targetId, excess });
        return { ...c, currentHp: Math.min(c.baseHp, c.currentHp + amount) };
      });
    }
  }

  return { newState: currentState, events };
}

function combineStatMods(a: StatModifier, b: StatModifier): StatModifier {
  return {
    atk: (a.atk ?? 0) + (b.atk ?? 0),
    hp: (a.hp ?? 0) + (b.hp ?? 0),
    arm: (a.arm ?? 0) + (b.arm ?? 0),
  };
}

// Timed modify_stats record an ActiveModifier tagged with a turn/upkeep boundary
// so the state machine can strip them (and undo their stat contribution) when the
// boundary is reached. Permanent/instant/while_in_play/for_combat durations apply
// straight to current stats and never expire here. Returns the tracking duration
// to record, or null to skip tracking.
function timedDuration(d: Duration): ActiveModifier['duration'] | null {
  if (d.type === 'until_end_of_turn') return { type: 'until_end_of_turn' };
  if (d.type === 'until_next_upkeep') return { type: 'until_next_upkeep' };
  return null;
}

function executeModifyStats(
  state: GameState,
  effect: Extract<Effect, { type: 'modify_stats' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  const tracked = timedDuration(effect.duration);

  // DIAGNOSTIC ABLATION (default absent ⇒ no-op): config.ablateBulwark zeroes the
  // ARM component of any `until_next_upkeep` modify_stats — uniquely Seraphina's
  // "Protector's Bulwark" +1 frontline ARM (the only such ARM buff in the field;
  // the Valkyrie transform's until_next_upkeep mod is ATK-only and is untouched).
  if (
    state.config?.ablateBulwark === true &&
    effect.duration.type === 'until_next_upkeep' &&
    (effect.modifier.arm ?? 0) !== 0
  ) {
    effect = { ...effect, modifier: { ...effect.modifier, arm: 0 } };
  }

  for (const targetId of resolved.targetIds) {
    // Dynamic modifiers depend on the target's live stats / live game state, so
    // they are resolved per target rather than from the static `modifier`.
    const dyn =
      effect.dynamicModifier !== undefined
        ? dynamicModForTarget(currentState, effect.dynamicModifier, targetId, context)
        : {};
    const total = combineStatMods(effect.modifier, dyn);
    const owner = findCardInState(currentState, targetId)?.owner;
    events.push({
      type: 'STAT_MODIFIED',
      cardInstanceId: targetId,
      modifier: total,
      ...(owner !== undefined ? { playerId: owner } : {}),
    });
    currentState = updateCardInState(currentState, targetId, (c) => ({
      ...c,
      currentAtk: c.currentAtk + (total.atk ?? 0),
      currentHp: c.currentHp + (total.hp ?? 0),
      currentArm: c.currentArm + (total.arm ?? 0),
      modifiers:
        tracked === null
          ? c.modifiers
          : [
              ...c.modifiers,
              {
                id: `mod_${context.sourceInstanceId}_${targetId}_${String(c.modifiers.length)}`,
                sourceInstanceId: context.sourceInstanceId,
                modifier: total,
                duration: tracked,
              },
            ],
    }));
  }

  return { newState: currentState, events };
}

function dynamicModForTarget(
  state: GameState,
  dynamic: NonNullable<Extract<Effect, { type: 'modify_stats' }>['dynamicModifier']>,
  targetId: string,
  context: EffectContext,
): StatModifier {
  const target = findCardInState(state, targetId);
  if (target === null) return {};
  return evaluateDynamicStat(state, dynamic, target, context);
}

function executeDrawCards(
  state: GameState,
  effect: Extract<Effect, { type: 'draw_cards' }>,
  context: EffectContext,
): EffectResult {
  const count = evaluateAmount(state, effect.count, context);
  const playerIdx =
    effect.player === 'enemy' ? (context.controllerId === 0 ? 1 : 0) : context.controllerId;

  const player = state.players[playerIdx];
  const drawCount = Math.min(count, player.mainDeck.length);
  if (drawCount === 0) return unchanged(state);

  const drawn = player.mainDeck.slice(0, drawCount);
  const remaining = player.mainDeck.slice(drawCount);

  const newPlayers = [...state.players] as [(typeof state.players)[0], (typeof state.players)[1]];
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

  // `inEachEmpty` fills every empty slot: bound iterations by the live zone-array
  // length (the deploy loop already breaks once no open slot remains). Identical to
  // ZONE_SLOTS under the default 3/2 board; respects a zone-capacity override.
  const count =
    effect.inEachEmpty === true
      ? getZoneArray(state.players[context.controllerId].zones, zone).length
      : effect.count;

  for (let i = 0; i < count; i++) {
    const player = currentState.players[context.controllerId];
    const zoneArr =
      zone === 'reserve'
        ? player.zones.reserve
        : zone === 'frontline'
          ? player.zones.frontline
          : player.zones.highGround;
    const openSlot = zoneArr.findIndex((s) => s === null);
    if (openSlot === -1) break;

    const tokenId = currentState.rng.counter + 1;
    currentState = { ...currentState, rng: { ...currentState.rng, counter: tokenId } };
    const token: CardInstance = {
      instanceId: `token_${String(tokenId)}`,
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
    const newPlayers = [...currentState.players] as [
      (typeof currentState.players)[0],
      (typeof currentState.players)[1],
    ];
    newPlayers[context.controllerId] = { ...player, zones: newZones };
    currentState = { ...currentState, players: newPlayers };
    events.push({
      type: 'CARD_DEPLOYED',
      cardInstanceId: token.instanceId,
      cardDefId: token.cardDefId,
      zone,
      playerId: context.controllerId,
    });
  }

  return { newState: currentState, events };
}

function executeDestroy(
  state: GameState,
  effect: Extract<Effect, { type: 'destroy' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    const card = findCardInState(currentState, targetId);
    if (card === null) continue;
    const destruction = destroyOrReplace(currentState, card, 'effect', context);
    currentState = destruction.newState;
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
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    const card = findCardInState(currentState, targetId);
    if (card === null) continue;
    events.push({
      type: 'CARD_BOUNCED',
      cardInstanceId: targetId,
      cardDefId: card.cardDefId,
      playerId: card.owner,
    });
    // removeCardFromState sends the holder (and, separately, its detached equipment)
    // to the discard pile. For a bounce the holder belongs in HAND, not discard, so
    // pull it back out; the detached equipment stays in discard (Rulebook 13).
    currentState = removeCardFromState(currentState, targetId);
    if (!card.isToken) {
      const ownerState = currentState.players[card.owner];
      const newPlayers = [...currentState.players] as [
        (typeof currentState.players)[0],
        (typeof currentState.players)[1],
      ];
      newPlayers[card.owner] = {
        ...ownerState,
        discardPile: ownerState.discardPile.filter((c) => c.instanceId !== card.instanceId),
        hand: [...ownerState.hand, resetCard(card)],
      };
      currentState = { ...currentState, players: newPlayers };
      if (card.equipment !== null) {
        events.push({
          type: 'CARD_DESTROYED',
          cardInstanceId: card.equipment.instanceId,
          cardDefId: card.equipment.cardDefId,
          cause: 'effect',
          playerId: card.owner,
        });
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
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    const card = findCardInState(currentState, targetId);
    if (card === null) continue;
    events.push({ type: 'CARD_SACRIFICED', cardInstanceId: targetId, cardDefId: card.cardDefId });
    events.push({
      type: 'CARD_DESTROYED',
      cardInstanceId: targetId,
      cardDefId: card.cardDefId,
      cause: 'sacrifice',
      playerId: card.owner,
    });
    if (!card.isToken && isExiledOnDestruction(card)) {
      events.push({
        type: 'CARD_EXILED',
        cardInstanceId: targetId,
        cardDefId: card.cardDefId,
        playerId: card.owner,
      });
    }
    currentState = removeCardFromState(currentState, targetId);
  }
  return { newState: currentState, events };
}

function executeGainResource(
  state: GameState,
  effect: Extract<Effect, { type: 'gain_resource' }>,
  context: EffectContext,
): EffectResult {
  const player = state.players[context.controllerId];
  const newPlayers = [...state.players] as [(typeof state.players)[0], (typeof state.players)[1]];

  if (effect.temporary === true) {
    newPlayers[context.controllerId] = {
      ...player,
      temporaryResources: [
        ...player.temporaryResources,
        { resourceType: effect.resourceType, amount: effect.amount },
      ],
    };
    // Flag this player as having gained a Temporary Resource this turn so the
    // `event_context: gained_temporary_resource_this_turn` Condition (RIA-09
    // Biotech Harvest) reads true. Reset at the player's turn start.
    const prior = state.turnState.gainedTemporaryResource ?? [false, false];
    const flags: [boolean, boolean] = [prior[0], prior[1]];
    flags[context.controllerId] = true;
    return {
      newState: {
        ...state,
        players: newPlayers,
        turnState: { ...state.turnState, gainedTemporaryResource: flags },
      },
      events: [
        {
          type: 'RESOURCE_GAINED',
          playerId: context.controllerId,
          resourceType: effect.resourceType,
          amount: effect.amount,
        },
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
    newState: {
      ...state,
      players: newPlayers,
      rng: { ...state.rng, counter: state.rng.counter + effect.amount },
    },
    events: [
      {
        type: 'RESOURCE_GAINED',
        playerId: context.controllerId,
        resourceType: effect.resourceType,
        amount: effect.amount,
      },
    ],
  };
}

function executeGrantTrait(
  state: GameState,
  effect: Extract<Effect, { type: 'grant_trait' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const duration = grantedTraitDuration(effect.duration, context.sourceInstanceId);
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updateCardInState(currentState, targetId, (c) => ({
      ...c,
      grantedTraits: [
        ...c.grantedTraits,
        { trait: effect.trait, sourceInstanceId: context.sourceInstanceId, duration },
      ],
    }));
  }
  return { newState: currentState, events: [] };
}

// Map a grant_trait Duration onto the trait's tracking GrantedDuration (Rulebook 16).
// until_end_of_turn / until_next_upkeep expire at their boundary (stripped by the
// state machine). for_combat has no combat-end tick, so it collapses to the nearest
// expiring boundary, end of turn. while_in_play ties to the granting source so it is
// removed when that source leaves. permanent/instant persist.
function grantedTraitDuration(d: Duration, sourceId: string): GrantedDuration {
  switch (d.type) {
    case 'until_end_of_turn':
    case 'for_combat':
      return { type: 'until_end_of_turn' };
    case 'until_next_upkeep':
      return { type: 'until_next_upkeep' };
    case 'while_in_play':
      return { type: 'while_in_play', sourceId };
    case 'permanent':
    case 'instant':
      return { type: 'permanent' };
    default: {
      const _exhaustive: never = d;
      return _exhaustive;
    }
  }
}

function executeGrantAbility(
  state: GameState,
  effect: Extract<Effect, { type: 'grant_ability' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updateCardInState(currentState, targetId, (card) =>
      grantAbilityToCard(card, effect.ability, context.sourceInstanceId),
    );
  }
  return { newState: currentState, events: [] };
}

/**
 * Append a granted triggered ability to a card and register its trigger so the
 * dispatch runtime fires it (e.g. an equipped character's "on destroy" ability).
 * The trigger id is derived deterministically from source + target + index.
 */
function grantAbilityToCard(
  card: CardInstance,
  ref: Extract<Effect, { type: 'grant_ability' }>['ability'],
  sourceInstanceId: string,
): CardInstance {
  const ability: TriggeredAbilityDSL = {
    type: 'triggered',
    trigger: ref.trigger,
    effects: ref.effects,
    condition: ref.condition,
  };
  const abilityIndex = card.abilities.length;
  const registered: RegisteredTrigger = {
    id: `granted_${sourceInstanceId}_${card.instanceId}_${String(abilityIndex)}`,
    sourceInstanceId: card.instanceId,
    ownerPlayerId: card.owner,
    trigger: ref.trigger,
    effects: ref.effects,
    condition: ref.condition,
    abilityIndex,
    ...triggerRateLimits(ability),
  };
  return {
    ...card,
    abilities: [...card.abilities, ability],
    registeredTriggers: [...card.registeredTriggers, registered],
  };
}

function executeApplyStatus(
  state: GameState,
  effect: Extract<Effect, { type: 'apply_status' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updateCardInState(currentState, targetId, (c) => ({
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
  effect: Extract<Effect, { type: 'discard' }>,
  context: EffectContext,
): EffectResult {
  // `random` target: the RNG pre-pass already picked specific cards (selectedTargets)
  // — discard them directly, no player choice (Ruinous Imp: opponent discards a
  // random card).
  if (effect.target.type === 'random') {
    return discardSpecificCards(state, context.selectedTargets ?? []);
  }

  // `each_player`: BOTH players discard (Soulflay Necromancer). The non-active
  // discard is resolved deterministically (first `count` cards) so the symmetric
  // effect actually hits the opponent; the active player's choice is offered as a
  // PendingChoice. Resolved-active discards arrive via selectedTargets.
  if (effect.target.type === 'each_player') {
    return discardEachPlayer(state, effect, context);
  }

  const targetPlayerId =
    'side' in effect.target && effect.target.side === 'enemy'
      ? context.controllerId === 0
        ? 1
        : 0
      : context.controllerId;
  const player = state.players[targetPlayerId];
  if (player.hand.length === 0) return unchanged(state);
  if (context.selectedTargets !== undefined) {
    return discardSpecificCards(state, context.selectedTargets);
  }
  return {
    newState: state,
    events: [],
    pendingChoice: {
      type: 'choose_discard',
      playerId: targetPlayerId,
      options: player.hand.map((c) => ({ id: c.instanceId, label: c.name })),
      minSelections: Math.min(effect.count, player.hand.length),
      maxSelections: Math.min(effect.count, player.hand.length),
      context: `Discard ${String(effect.count)} card(s)`,
    },
  };
}

/** Both players discard `count` cards (Soulflay Necromancer). The opponent's cards
 * are taken deterministically (first `count`); the controller is offered a choice
 * (its selection arrives via selectedTargets on re-entry). */
function discardEachPlayer(
  state: GameState,
  effect: Extract<Effect, { type: 'discard' }>,
  context: EffectContext,
): EffectResult {
  // Re-entry (the controller's choice was resolved): discard only those cards. The
  // opponent was already discarded on the first pass.
  if (context.selectedTargets !== undefined) {
    return discardSpecificCards(state, context.selectedTargets);
  }
  const opponentId = context.controllerId === 0 ? 1 : 0;
  const opponent = state.players[opponentId];
  const oppPicks = opponent.hand.slice(0, effect.count).map((c) => c.instanceId);
  const afterOpp = discardSpecificCards(state, oppPicks);

  const controller = afterOpp.newState.players[context.controllerId];
  if (controller.hand.length === 0) return afterOpp;
  return {
    newState: afterOpp.newState,
    events: afterOpp.events,
    pendingChoice: {
      type: 'choose_discard',
      playerId: context.controllerId,
      options: controller.hand.map((c) => ({ id: c.instanceId, label: c.name })),
      minSelections: Math.min(effect.count, controller.hand.length),
      maxSelections: Math.min(effect.count, controller.hand.length),
      context: `Discard ${String(effect.count)} card(s)`,
    },
  };
}

/** Move specific cards from their owners' hands to their discard piles. Used by the
 * `random` discard path (cards already selected by the RNG pre-pass). */
function discardSpecificCards(state: GameState, cardIds: readonly string[]): EffectResult {
  let currentState = state;
  const events: GameEvent[] = [];
  for (const cardId of cardIds) {
    for (let pi = 0; pi < 2; pi++) {
      const player = currentState.players[pi]!;
      const card = player.hand.find((c) => c.instanceId === cardId);
      if (card === undefined) continue;
      const newPlayers = [...currentState.players] as [
        (typeof currentState.players)[0],
        (typeof currentState.players)[1],
      ];
      newPlayers[pi] = {
        ...player,
        hand: player.hand.filter((c) => c.instanceId !== cardId),
        discardPile: [...player.discardPile, card],
      };
      currentState = { ...currentState, players: newPlayers };
      events.push({
        type: 'CARD_DISCARDED',
        cardInstanceId: cardId,
        cardDefId: card.cardDefId,
        playerId: pi as 0 | 1,
      });
      // Recycle X: drawing X on discard-from-hand (Rulebook 16). Inert for every
      // current card (none carries the recycle trait), so this is a no-op default.
      const recycle = recycleDraw(currentState, card, pi as 0 | 1);
      currentState = recycle.newState;
      events.push(...recycle.events);
      break;
    }
  }
  return { newState: currentState, events };
}

/** Apply a discarded card's Recycle X: its owner draws X from the top of their main
 * deck (capped by deck size). Returns the card's events untouched when it has no
 * recycle trait/value, so existing decks are byte-identical. */
function recycleDraw(state: GameState, card: CardInstance, playerId: 0 | 1): EffectResult {
  const x = card.traits.includes('recycle') ? (card.recycleValue ?? 1) : 0;
  if (x <= 0) return { newState: state, events: [] };

  const player = state.players[playerId];
  const count = Math.min(x, player.mainDeck.length);
  if (count === 0) return { newState: state, events: [] };

  const drawn = player.mainDeck.slice(0, count);
  const newPlayers = [...state.players] as [PlayerState, PlayerState];
  newPlayers[playerId] = {
    ...player,
    mainDeck: player.mainDeck.slice(count),
    hand: [...player.hand, ...drawn],
  };
  return {
    newState: { ...state, players: newPlayers },
    events: [{ type: 'CARD_DRAWN', playerId, count }],
  };
}

const MOVE_ADJACENT: Record<ZoneType, readonly ZoneType[]> = {
  reserve: ['frontline'],
  frontline: ['reserve', 'high_ground'],
  high_ground: ['frontline'],
};

const ALL_ZONES: readonly ZoneType[] = ['reserve', 'frontline', 'high_ground'];

/** Resolve the concrete destination zone for a move whose authored destination is
 * `any` or `adjacent_to_current`: the first candidate zone (other than the current)
 * that has an open slot. Returns null when none is available. */
function resolveMoveDestination(
  zones: ZoneState,
  fromZone: ZoneType,
  destination: ZoneType | 'any' | 'adjacent_to_current',
): ZoneType | null {
  if (destination !== 'any' && destination !== 'adjacent_to_current') return destination;
  const candidates =
    destination === 'adjacent_to_current'
      ? MOVE_ADJACENT[fromZone]
      : ALL_ZONES.filter((z) => z !== fromZone);
  for (const z of candidates) {
    const arr =
      z === 'reserve' ? zones.reserve : z === 'frontline' ? zones.frontline : zones.highGround;
    if (arr.some((s) => s === null)) return z;
  }
  return null;
}

function executeMove(
  state: GameState,
  effect: Extract<Effect, { type: 'move' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;

  for (const targetId of resolved.targetIds) {
    for (let pi = 0; pi < 2; pi++) {
      const player = currentState.players[pi]!;
      const location = findCard(player.zones, targetId);
      if (location === null) continue;

      const fromZone = location.zone;
      const toZone = resolveMoveDestination(player.zones, fromZone, effect.destination);
      if (toZone === null || fromZone === toZone) break;

      const { zones: clearedZones } = removeFromZone(player.zones, targetId);
      const movedCard: CardInstance = { ...location.card, movedThisTurn: true };
      try {
        const newZones = deployToZone(clearedZones, movedCard, toZone);
        const newPlayers = [...currentState.players] as [
          (typeof currentState.players)[0],
          (typeof currentState.players)[1],
        ];
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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

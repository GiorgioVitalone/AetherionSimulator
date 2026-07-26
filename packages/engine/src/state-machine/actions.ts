/**
 * State Machine Actions — pure functions that produce new GameState.
 * Each action is called from XState assign() to update machine context.
 */
import type {
  GameState,
  PlayerState,
  CardInstance,
  GameEvent,
  StackItem,
  HeroState,
  TemporaryResource,
} from '../types/game-state.js';
import type { PlayerAction } from './types.js';
import type { Effect } from '../types/effects.js';
import type { AbilityDSL } from '../types/ability.js';
import { deployToZone, moveCard } from '../zones/zone-manager.js';
import { resolveCombat } from '../combat/combat-resolver.js';
import { canAfford, payCost, effectiveCost, consumeReductions } from '../actions/cost-checker.js';
import { cardResourceType } from '../actions/card-resource.js';
import { isReserveTapEligible, tapReserveCard } from '../actions/reserve-tap.js';
import { meetsEquipRequirement } from '../actions/equip-eligibility.js';
import { runAbilityEffects } from '../effects/effect-runner.js';
import { updateCardInState } from '../effects/state-helpers.js';
import {
  openWindowOrResolve,
  passPriority,
  stackDeclaredEvent,
} from '../effects/stack-resolver.js';
import { dispatchTriggers } from '../runtime/dispatch.js';
import { recomputeAuras } from '../runtime/aura-recompute.js';
import { stabilizeStateBased } from '../runtime/state-based-stabilizer.js';
import { stampGameEvents } from '../runtime/event-envelope.js';
import { expireModifiers } from '../runtime/modifier-expiry.js';
import { isStunned, consumeStun, isSlowed, tickStatusEffects } from '../runtime/status-tick.js';
import {
  getAllRegisteredTriggers,
  registerCardTriggers,
  buildHeroTriggers,
  computeCardTriggers,
} from '../events/trigger-registry.js';
import {
  canTransform,
  computeAvailableActions,
  ELITE_HIGH_GROUND_SURCHARGE,
} from '../actions/available-actions.js';
import type { ResourceCost, ResourceType, ZoneType } from '../types/common.js';
import { hasEffectiveTrait, snapshotCard } from '../selectors/card-semantics.js';
import { attemptDraw } from '../effects/draw-service.js';

export {
  checkHandSize,
  continueEndPhaseBoundary,
  discardCards,
  executeTurnBoundary,
  expireEndOfTurnModifiers,
  expireEndOfTurnModifiersWithEvents,
  passTurn,
  removeTemporaryResources,
  resumeTurnBoundary,
  runScheduledEffects,
} from './turn-boundary.js';

// Variable (X) cost: the chosen X is paid as additional flexible resource on top
// of the base cost, and threaded to effects as `context.xPaid`. The engine's
// ResourceCost has no per-resource X channel, so X draws from any resource.
function addXCost(
  cost: ResourceCost,
  xValue: number,
  resource?: ResourceType,
): ResourceCost {
  const x = Math.max(0, xValue);
  return resource === undefined
    ? { ...cost, flexible: cost.flexible + x }
    : { ...cost, [resource]: cost[resource] + x };
}

// ── Ability Effect Execution ─────────────────────────────────────────────────
// Effect resolution lives in effects/effect-runner.js (runAbilityEffects), shared
// with the stack resolver. This module selects WHICH effects run per action.

function abilityEffects(
  abilities: readonly AbilityDSL[],
  onDeployOnly: boolean,
): readonly Effect[] {
  const out: Effect[] = [];
  for (const ab of abilities) {
    if (ab.type === 'triggered') {
      if (onDeployOnly && ab.trigger.type !== 'on_deploy') continue;
      out.push(...ab.effects);
    } else if (ab.type === 'aura' && !onDeployOnly) {
      out.push(...ab.effects);
    }
  }
  return out;
}

// GAP FIX (config.equipmentTriggers): an equipment's printed on_equipment_attached
// trigger (e.g. Growplate Helm) needs to fire at the moment it attaches, same as
// on_deploy fires inline for a deployed card — the dispatch trigger pool is
// snapshotted BEFORE the attach resolves (see processPlayerAction), and its
// matcher keys on the HOLDER's instance id (event.targetId), not the equipment's
// own, so it could never fire via the general pool. Absent/false ⇒ never called.
function equipmentAttachedEffects(abilities: readonly AbilityDSL[]): readonly Effect[] {
  const out: Effect[] = [];
  for (const ab of abilities) {
    if (ab.type === 'triggered' && ab.trigger.type === 'on_equipment_attached') {
      out.push(...ab.effects);
    }
  }
  return out;
}

function findOnBattlefield(state: GameState, instanceId: string): CardInstance | null {
  for (const p of state.players) {
    for (const zone of [p.zones.reserve, p.zones.frontline, p.zones.highGround]) {
      for (const c of zone) if (c !== null && c.instanceId === instanceId) return c;
    }
  }
  return null;
}

// ── Upkeep Actions ──────────────────────────────────────────────────────────

// `until_next_upkeep` buffs expire at the start of the affected card's
// controller's Upkeep (the active player at this point). The eventful form is
// the authoritative boundary: losing HP or an aura can cause simultaneous
// state-based deaths, and those events must dispatch with pre-expiry LKI.
export function expireUpkeepModifiersWithEvents(
  state: GameState,
  actionId = [
    'upkeep-expiry',
    state.rng.seed,
    state.turnNumber,
    state.activePlayerIndex,
  ].join(':'),
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const triggerPool = getAllRegisteredTriggers(state);
  const cleared = expireModifiers(
    state,
    state.activePlayerIndex,
    'until_next_upkeep',
  );
  return stabilizeStateBased(cleared, {
    triggerPool,
    actionId,
    transactionId: actionId,
  });
}

/** Compatibility projection for callers that only consume state. */
export function expireUpkeepModifiers(state: GameState): GameState {
  return expireUpkeepModifiersWithEvents(state).state;
}

export function refreshCards(state: GameState): GameState {
  const refreshed = updateActivePlayer(state, (player) => ({
    ...player,
    hero:
      player.hero.transformedThisTurn
        ? { ...player.hero, transformedThisTurn: false }
        : player.hero,
    zones: {
      reserve: player.zones.reserve.map(refreshCard),
      frontline: player.zones.frontline.map(refreshCard),
      highGround: player.zones.highGround.map(refreshCard),
    },
    resourceBank: player.resourceBank.map((r) => ({ ...r, exhausted: false })),
  }));
  // Refresh clears reserveEnergyExhausted, which can reactivate a printed aura.
  // Rebuild the continuous graph at that exact boundary so the next observable
  // state never carries stale source/contribution metadata.
  return recomputeAuras(refreshed);
}

function refreshCard(card: CardInstance | null): CardInstance | null {
  if (card === null) return null;
  // A Stunned character does not untap this Upkeep (Rulebook 16). It still clears
  // its per-turn flags, and consumes one Stunned Upkeep. Swift recharges its 1 free
  // move each turn; Rush X is deploy-turn only and is not refreshed.
  const cleared: CardInstance = {
    ...card,
    movedThisTurn: false,
    attackedThisTurn: false,
    freeMovesRemaining: refreshFreeMoves(card),
    // Clear last turn's Reserve Energy exhaustion so abilities re-enable (Rulebook 8).
    reserveEnergyExhausted: false,
    // The once-per-turn equipment transfer limit resets here (Rulebook 13).
    equipment: card.equipment === null ? null : { ...card.equipment, transferredThisTurn: false },
  };
  if (isStunned(card)) return consumeStun(cleared);
  return { ...cleared, exhausted: false, summoningSick: false };
}

// Tick the active player's Regeneration/Persistent/Slowed statuses (Rulebook 16):
// heal/damage applies, values decrement, durations count down, Persistent kills.
// Any produced events (heal/damage/destruction) dispatch triggers, then auras are
// recomputed — mirroring the executePlayerAction pipeline.
export function tickUpkeepStatuses(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const triggerPool = getAllRegisteredTriggers(state);
  const ticked = tickStatusEffects(state, state.activePlayerIndex);
  // No events means no triggers to dispatch and no aura-relevant change, but the
  // tick may still have advanced silent durations (Slowed/Stunned countdown,
  // Regeneration value decrement on a full-HP card). Return the ticked state so
  // those decrements persist — returning the pre-tick `state` would drop them.
  if (ticked.events.length === 0) return { state: ticked.state, events: [] };
  const dispatched = dispatchTriggers(ticked.state, ticked.events, 0, triggerPool);
  if (dispatched.newState.pendingChoice !== null) {
    return {
      state: dispatched.newState,
      events: [...ticked.events, ...dispatched.events],
    };
  }
  const stabilized = stabilizeStateBased(dispatched.newState);
  return {
    state: stabilized.state,
    events: [...ticked.events, ...dispatched.events, ...stabilized.events],
  };
}

// Reserve Energy Generation (Rulebook 8, Upkeep step 4): the active player may
// exhaust ready Reserve characters to generate 1 temporary resource each, matching
// the character's resource type. An exhausted character has ALL of its abilities
// disabled until next Upkeep (flagged reserveEnergyExhausted, cleared at refresh).
//
// Deterministic policy for the autonomous sim: generate from every eligible Reserve
// character — ready (not exhausted), not summoning-sick, and not a Sniper (Snipers
// stay ready to attack from Reserve). This is the ramp the rule authorizes.
//
// Under `config.reserveTapChoice` (rules-accuracy fix — the Rulebook's "may") the
// automatic path is OFF and generation happens via the `tap_reserve` player action.
export function generateReserveEnergy(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  if (state.config?.reserveTapChoice === true) return { state, events: [] };
  const player = state.players[state.activePlayerIndex];
  const events: GameEvent[] = [];
  const tempGained: TemporaryResource[] = [];
  const reserve = player.zones.reserve.map((card) => {
    if (card === null || !isReserveTapEligible(card, state.config)) return card;
    const resourceType = cardResourceType(card);
    tempGained.push({ resourceType, amount: 1 });
    events.push({
      type: 'RESOURCE_GAINED',
      playerId: state.activePlayerIndex,
      resourceType,
      amount: 1,
    });
    return tapReserveCard(card, state.config);
  });

  if (tempGained.length === 0) return { state, events: [] };

  const newPlayer: PlayerState = {
    ...player,
    zones: { ...player.zones, reserve },
    temporaryResources: [...player.temporaryResources, ...tempGained],
  };
  return { state: recomputeAuras(setPlayer(state, state.activePlayerIndex, newPlayer)), events };
}

// The `tap_reserve` player action (config.reserveTapChoice — Rulebook 8 step 4's
// "may"): exhaust ONE ready Reserve character for +1 temporary resource of its
// type, disabling all its abilities until next Upkeep; under reserveTapStrain it
// also suffers 1 direct damage (no ARM, no damage triggers — wear, not an attack;
// eligibility floors at 2 HP so the wear never kills). Aura recompute happens in
// the executePlayerAction wrapper, which turns the tapped body's auras off.
function executeTapReserve(
  state: GameState,
  action: Extract<PlayerAction, { type: 'tap_reserve' }>,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (state.config?.reserveTapChoice !== true) return { state, events: [] };
  const player = state.players[state.activePlayerIndex];
  const idx = player.zones.reserve.findIndex(
    (c) => c !== null && c.instanceId === action.cardInstanceId,
  );
  const card = idx === -1 ? null : player.zones.reserve[idx];
  if (card == null || !isReserveTapEligible(card, state.config)) {
    return { state, events: [] };
  }
  const resourceType = cardResourceType(card);
  const reserve = [...player.zones.reserve];
  reserve[idx] = tapReserveCard(card, state.config);
  const newPlayer: PlayerState = {
    ...player,
    zones: { ...player.zones, reserve },
    temporaryResources: [...player.temporaryResources, { resourceType, amount: 1 }],
  };
  return {
    state: setPlayer(state, state.activePlayerIndex, newPlayer),
    events: [
      {
        type: 'RESOURCE_GAINED',
        playerId: state.activePlayerIndex,
        resourceType,
        amount: 1,
      },
    ],
  };
}

export function drawResourceCard(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const player = state.players[state.activePlayerIndex];
  // Precise "Resource Deck empty at Upkeep, BEFORE the draw" flag for the
  // `resource_deck_empty_transform` rule — recorded ONLY under that mode so every
  // other run is semantically invariant. Captured from the PRE-draw deck length, so transform
  // unlocks the first turn that STARTS empty, not the turn the last card is drawn.
  const base =
    state.config?.terminationMode === 'resource_deck_empty_transform'
      ? {
          ...state,
          turnState: {
            ...state.turnState,
            resourceDeckEmptyAtUpkeep: player.resourceDeck.length === 0,
          },
        }
      : state;
  // CANDIDATE RULE VARIANT (config.firstPlayerSkipsFirstResource, §13r): the first
  // player draws NO Resource Card on their first Upkeep. Read `turnState.
  // firstPlayerFirstTurn` here — it is still true at this point in the upkeep
  // sequence (this action runs on upkeep entry, BEFORE the drawMain state
  // consumes/reads the flag), so it reliably identifies "first player, first turn".
  // Absent/false ⇒ semantically invariant no-op.
  if (
    state.config?.firstPlayerSkipsFirstResource === true &&
    state.turnState.firstPlayerFirstTurn
  ) {
    return { state: base, events: [] };
  }
  // DESIGN-SWEEP (config.resourceRampBonus N): draw 1 + N this Upkeep (faster ramp),
  // never past the live Resource Deck. Absent / <= 0 ⇒ exactly 1 (semantically invariant).
  const bonus = state.config?.resourceRampBonus ?? 0;
  const want = 1 + (bonus > 0 ? bonus : 0);
  const count = Math.min(want, player.resourceDeck.length);
  if (count === 0) {
    return { state: base, events: [] };
  }

  const drawn = player.resourceDeck.slice(0, count);
  const newPlayer: PlayerState = {
    ...player,
    resourceDeck: player.resourceDeck.slice(count),
    resourceBank: [...player.resourceBank, ...drawn],
  };

  return {
    state: setPlayer(base, state.activePlayerIndex, newPlayer),
    events: drawn.map((d) => ({
      type: 'RESOURCE_GAINED' as const,
      playerId: state.activePlayerIndex,
      resourceType: d.resourceType,
      amount: 1,
    })),
  };
}

export function drawMainDeckCard(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly deckEmpty: boolean;
} {
  const result = attemptDraw(state, state.activePlayerIndex, 1, 'upkeep');
  return {
    state: result.state,
    events: result.events,
    deckEmpty: result.failedAttempt !== null,
  };
}

// ── Strategy Phase Actions ──────────────────────────────────────────────────

export function executePlayerAction(
  state: GameState,
  action: PlayerAction,
  actionId?: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  // Snapshot triggers before resolving so Last Breath fires after sources leave play.
  const triggerPool = getAllRegisteredTriggers(state);
  const rawResolved = resolvePlayerAction(state, action);
  const resolved = stampGameEvents(rawResolved.state, rawResolved.events, {
    ...(actionId !== undefined ? { actionId, transactionId: actionId } : {}),
  });
  const dispatched = dispatchTriggers(resolved.state, resolved.events, 0, triggerPool);
  if (dispatched.newState.pendingChoice !== null) {
    return {
      state: dispatched.newState,
      events: [...resolved.events, ...dispatched.events],
    };
  }
  const stabilized = stabilizeStateBased(dispatched.newState, {
    triggerPool,
    ...(actionId !== undefined ? { actionId, transactionId: actionId } : {}),
  });
  return {
    state: stabilized.state,
    events: [
      ...resolved.events,
      ...dispatched.events,
      ...stabilized.events,
    ],
  };
}

// ── Reactive Priority Window ─────────────────────────────────────────────────
// During an open window the responder (pendingPriority.toRespondPlayerId) may cast
// a Counter/Flash spell from hand (adding a link to the chain, flipping priority
// back to the other player) or pass. Two consecutive passes close the window and
// resolve the chain LIFO. Dispatch/aura recompute mirror executePlayerAction.

export function executeReactiveResponse(
  state: GameState,
  action: PlayerAction,
  actionId?: string,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (state.pendingPriority == null) {
    return { state, events: [] };
  }
  const responderId = state.pendingPriority.toRespondPlayerId;
  const triggerPool = getAllRegisteredTriggers(state);
  let resolved: { readonly state: GameState; readonly events: readonly GameEvent[] };
  if (action.type === 'cast_spell') {
    resolved = castReactiveSpell(state, action, responderId);
  } else if (action.type === 'activate_ability' && state.config?.boardReactions === true) {
    // BOARD REACTIONS (config.boardReactions, Tier 3 part 2): a battlefield
    // character or the Hero responds via `activate_ability` (reused — same
    // shape a proactive activation uses) instead of `cast_spell`. Absent/false
    // ⇒ semantically invariant no-op: `activate_ability` never reaches here off-flag,
    // since computeReactiveActions never offers a 'board' option off-flag.
    resolved = activateBoardReaction(state, action, responderId);
  } else {
    return { state, events: [] };
  }
  const stamped = stampGameEvents(resolved.state, resolved.events, {
    ...(actionId !== undefined ? { actionId, transactionId: actionId } : {}),
  });
  const dispatched = dispatchTriggers(stamped.state, stamped.events, 0, triggerPool);
  if (dispatched.newState.pendingChoice !== null) {
    return {
      state: dispatched.newState,
      events: [...stamped.events, ...dispatched.events],
    };
  }
  const stabilized = stabilizeStateBased(dispatched.newState, {
    triggerPool,
    ...(actionId !== undefined ? { actionId, transactionId: actionId } : {}),
  });
  return {
    state: stabilized.state,
    events: [...stamped.events, ...dispatched.events, ...stabilized.events],
  };
}

// A board Counter/Flash (config.boardReactions): pays the ability's own
// trigger.cost (default free) and exhausts the source, but — unlike a hand
// spell's discard-and-chain-link path — it stays on the battlefield. Effects
// resolve immediately (Activate-style, no stack push): a `target_spell` effect
// (e.g. counter_spell) auto-resolves against the newest enemy stack item via
// the interpreter's own target resolution (see target-resolver.ts), so no
// explicit target needs threading here. Priority flips back to the other
// player exactly as a hand reactive cast does.
function activateBoardReaction(
  state: GameState,
  action: { cardInstanceId: string; abilityIndex: number; xValue?: number },
  responderId: 0 | 1,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[responderId];
  const isHero = action.cardInstanceId === `hero_${String(player.hero.cardDefId)}`;
  const boardCard = isHero ? null : findOnBattlefield(state, action.cardInstanceId);
  if (!isHero && boardCard === null) return { state, events: [] };
  if (boardCard !== null && (boardCard.exhausted || boardCard.summoningSick)) {
    return { state, events: [] };
  }
  // Once-per-window guard (Hero Counter/Flash): a source may react at most once per
  // priority window. Board cards enforce this via exhaustion; the Hero has no board card
  // to exhaust, so gate it explicitly — otherwise a free-cost Hero Counter/Flash could
  // fire every window all game. Block if this source already reacted to THIS window
  // (keyed on the window's baseStackItemId — not the last SPELL_CAST, which non-spell
  // windows never emit, so those must not extend the block across distinct windows).
  const currentWindowId = state.pendingPriority?.baseStackItemId;
  if (currentWindowId != null) {
    for (let i = state.log.length - 1; i >= 0; i--) {
      const e = state.log[i]!;
      if (e.type === 'TURN_START') break;
      if (
        e.type === 'ABILITY_ACTIVATED' &&
        e.cardInstanceId === action.cardInstanceId &&
        (e as { windowId?: string }).windowId === currentWindowId
      )
        return { state, events: [] };
    }
  }

  const abilities = isHero ? player.hero.abilities : boardCard!.abilities;
  const ability = abilities[action.abilityIndex];
  if (ability === undefined || ability.type !== 'triggered') return { state, events: [] };
  const trigger = ability.trigger;
  if (trigger.type !== 'on_counter' && trigger.type !== 'on_flash') return { state, events: [] };

  const cost = addXCost(
    trigger.cost ?? { mana: 0, energy: 0, flexible: 0 },
    action.xValue ?? 0,
    ability.xCostResource,
  );
  if (!canAfford(player, cost)) return { state, events: [] };
  const paidPlayer = payCost(player, cost);
  let payState = setPlayer(
    state,
    responderId,
    state.config?.scopedTurnResets === true
      ? {
          ...paidPlayer,
          turnCounters: {
            ...paidPlayer.turnCounters,
            abilitiesActivated: paidPlayer.turnCounters.abilitiesActivated + 1,
          },
        }
      : paidPlayer,
  );
  if (boardCard !== null) {
    payState = updateCardInState(payState, action.cardInstanceId, (c) => ({
      ...c,
      hasActed: true,
      exhausted: true,
    }));
  }

  const activatedEvent: GameEvent = {
    type: 'ABILITY_ACTIVATED',
    cardInstanceId: action.cardInstanceId,
    abilityIndex: action.abilityIndex,
    // Tag with the window it answered so the once-per-window guard can key on it.
    ...(currentWindowId != null ? { windowId: currentWindowId } : {}),
  } as GameEvent;
  if (state.config?.transactionalDeclarations === true) {
    const stackItem: StackItem = {
      id: `ability_${action.cardInstanceId}_${String(action.abilityIndex)}_${String(state.stack.length)}`,
      type: 'ability',
      sourceInstanceId: action.cardInstanceId,
      controllerId: responderId,
      effects: ability.effects,
      targets: reactiveTargets(state, undefined, responderId),
      ...(action.xValue !== undefined ? { xPaid: action.xValue } : {}),
    };
    const other = responderId === 0 ? 1 : 0;
    return {
      state: {
        ...payState,
        stack: [...payState.stack, stackItem],
        pendingPriority: {
          type: 'priority',
          toRespondPlayerId: other,
          window: state.pendingPriority!.window,
          baseStackItemId: state.pendingPriority!.baseStackItemId,
          passes: 0,
        },
      },
      events: [activatedEvent, stackDeclaredEvent(stackItem)],
    };
  }
  const ran = runAbilityEffects(
    payState,
    action.cardInstanceId,
    ability.effects,
    responderId,
    action.xValue,
  );
  const other = responderId === 0 ? 1 : 0;
  const finalState: GameState = {
    ...ran.state,
    pendingPriority: {
      type: 'priority',
      toRespondPlayerId: other,
      // Preserve the base action's window kind (off-flag it can only ever be
      // 'cast', so this is semantically invariant to the declared window-kind invariant).
      window: state.pendingPriority!.window,
      baseStackItemId: state.pendingPriority!.baseStackItemId,
      passes: 0,
    },
  };
  return { state: finalState, events: [activatedEvent, ...ran.events] };
}

export function executePriorityPass(state: GameState, actionId?: string): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const triggerPool = getAllRegisteredTriggers(state);
  const rawResolved = passPriority(state);
  const resolved = stampGameEvents(rawResolved.state, rawResolved.events, {
    ...(actionId !== undefined ? { actionId, transactionId: actionId } : {}),
  });
  const dispatched = dispatchTriggers(resolved.state, resolved.events, 0, triggerPool);
  if (dispatched.newState.pendingChoice !== null) {
    return {
      state: dispatched.newState,
      events: [...resolved.events, ...dispatched.events],
    };
  }
  const stabilized = stabilizeStateBased(dispatched.newState, {
    triggerPool,
    ...(actionId !== undefined ? { actionId, transactionId: actionId } : {}),
  });
  return {
    state: stabilized.state,
    events: [...resolved.events, ...dispatched.events, ...stabilized.events],
  };
}

// A reactive cast: pay cost + discard now (resources not refunded), push the
// Counter/Flash as a chain link targeting the spell it responds to, and reopen
// priority to the other player (passes reset to 0 — a new link was added).
function castReactiveSpell(
  state: GameState,
  action: { cardInstanceId: string; xValue?: number; selectedTargetIds?: readonly string[] },
  responderId: 0 | 1,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[responderId];
  const cardIndex = player.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const cost = addXCost(
    effectiveCost(player, card, state.config),
    action.xValue ?? 0,
    card.xCostResource,
  );
  if (!canAfford(player, cost)) return { state, events: [] };
  const paidPlayer = consumeReductions(payCost(player, cost), card);
  const newPlayer: PlayerState = {
    ...paidPlayer,
    hand: paidPlayer.hand.filter((_, i) => i !== cardIndex),
    discardPile: [...paidPlayer.discardPile, card],
  };

  const stackItem: StackItem = {
    id: `spell_${card.instanceId}`,
    type: 'spell',
    sourceInstanceId: card.instanceId,
    sourceCardDefId: card.cardDefId,
    controllerId: responderId,
    effects: abilityEffects(card.abilities, false),
    targets: reactiveTargets(state, action.selectedTargetIds, responderId),
    ...(action.xValue !== undefined ? { xPaid: action.xValue } : {}),
  };
  const other = responderId === 0 ? 1 : 0;
  const newState: GameState = {
    ...setPlayer(state, responderId, newPlayer),
    stack: [...state.stack, stackItem],
    pendingPriority: {
      type: 'priority',
      toRespondPlayerId: other,
      // Preserve the base action's window kind (off-flag it can only ever be
      // 'cast', so this is semantically invariant to the declared window-kind invariant).
      window: state.pendingPriority!.window,
      baseStackItemId: state.pendingPriority!.baseStackItemId,
      passes: 0,
    },
  };
  const declaredEvent: GameEvent = {
    type: 'SPELL_CAST',
    cardInstanceId: card.instanceId,
    cardDefId: card.cardDefId,
    playerId: responderId,
  };
  return {
    state: newState,
    events:
      state.config?.transactionalDeclarations === true
        ? [
            {
              type: 'SPELL_DECLARED',
              stackItemId: stackItem.id,
              cardInstanceId: card.instanceId,
              cardDefId: card.cardDefId,
              playerId: responderId,
            },
            declaredEvent,
            stackDeclaredEvent(stackItem),
          ]
        : [],
  };
}

// A Counter targets the newest enemy spell on the stack when no explicit target
// is given, so its counter_spell effect resolves against the spell it responds to.
// TIER 4 (config.responseWindowsOnAllActions): ANY enemy stack item is a legal
// default counter target, so a reactive cast in an attack/ability/equip/move
// window counters the base action it responds to. Off-flag the scan stays
// spell-only (legacy, semantically invariant).
function reactiveTargets(
  state: GameState,
  selected: readonly string[] | undefined,
  responderId: 0 | 1,
): readonly string[] {
  if (selected !== undefined && selected.length > 0) return selected;
  const enemyId = responderId === 0 ? 1 : 0;
  const anyKind = state.config?.responseWindowsOnAllActions === true;
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const item = state.stack[i]!;
    if (item.controllerId === enemyId && (anyKind || item.type === 'spell')) return [item.id];
  }
  return [];
}

function resolvePlayerAction(
  state: GameState,
  action: PlayerAction,
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  switch (action.type) {
    case 'deploy':
      return executeDeploy(state, action);
    case 'cast_spell':
      return executeCastSpell(state, action);
    case 'attach_equipment':
      return executeAttachEquipment(state, action);
    case 'remove_equipment':
      return executeRemoveEquipment(state, action);
    case 'transfer_equipment':
      return executeTransferEquipment(state, action);
    case 'move':
      return executeMove(state, action);
    case 'activate_ability':
      return executeActivateAbility(state, action);
    case 'discard_for_energy':
      return executeDiscardForEnergy(state, action);
    case 'declare_attack':
      return executeDeclareAttack(state, action);
    case 'declare_transform':
      return executeDeclareTransform(state);
    case 'tap_reserve':
      return executeTapReserve(state, action);
  }
}

// ── Hero Transformation ──────────────────────────────────────────────────────
// Flip the active player's Hero to its transformed side: swap name/abilities,
// shift maxLp by the transformed side's delta (keeping current damage), mark
// transformedThisTurn, and register the new side's triggers so its triggered/
// Ultimate abilities are live. Pure (state) => newState.

function executeDeclareTransform(state: GameState): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const player = state.players[state.activePlayerIndex];
  const hero = player.hero;
  const data = hero.transformData;
  if (
    data === undefined ||
    hero.transformed ||
    !hero.canTransformThisGame ||
    hero.transformedThisTurn ||
    (state.config?.authoritativeTransitions === true && !canTransform(state))
  ) {
    return { state, events: [] };
  }

  const transformedHero: HeroState = {
    ...hero,
    cardDefId: data.cardDefId,
    name: data.name,
    maxLp: hero.maxLp + data.lpDelta,
    currentLp: hero.currentLp, // damage preserved
    transformed: true,
    transformedThisTurn: true,
    abilities: data.abilities,
    registeredTriggers: [],
  };
  const withTriggers: HeroState = {
    ...transformedHero,
    registeredTriggers: buildHeroTriggers(
      transformedHero,
      data.abilities,
      state.activePlayerIndex,
    ).map((t) => ({
      ...t,
      ownerPlayerId: state.activePlayerIndex,
    })),
  };

  return {
    state: setPlayer(state, state.activePlayerIndex, { ...player, hero: withTriggers }),
    events: [
      {
        type: 'HERO_TRANSFORMED',
        playerId: state.activePlayerIndex,
        fromCardDefId: hero.cardDefId,
        toCardDefId: data.cardDefId,
        previousMaxLp: hero.maxLp,
        newMaxLp: withTriggers.maxLp,
        maxLpDelta: withTriggers.maxLp - hero.maxLp,
        previousCurrentLp: hero.currentLp,
        newCurrentLp: withTriggers.currentLp,
        currentLpDelta: withTriggers.currentLp - hero.currentLp,
        currentLp: withTriggers.currentLp,
      },
    ],
  };
}

/** Free moves a character gets on its deploy turn: Rush X (X) + Swift (1). */
/** Sum of a player's Temporary Resources — used to detect whether a payment
 * consumed any (RIA-09 Symbiotic Expansion). */
function totalTempResources(player: PlayerState): number {
  return player.temporaryResources.reduce((sum, t) => sum + t.amount, 0);
}

function deployFreeMoves(card: CardInstance): number {
  const rush = hasEffectiveTrait(card, 'rush') ? (card.rushValue ?? 1) : 0;
  const swift = hasEffectiveTrait(card, 'swift') ? 1 : 0;
  return rush + swift;
}

/** Free moves a character refreshes to at the start of its Upkeep: Swift grants 1
 * each turn; Rush X is deploy-turn only and does not refresh. */
function refreshFreeMoves(card: CardInstance): number {
  return hasEffectiveTrait(card, 'swift') ? 1 : 0;
}

function executeDeploy(
  state: GameState,
  action: {
    cardInstanceId: string;
    zone: ZoneType;
    slotIndex: number;
    xValue?: number;
  },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex];
  const cardIndex = player.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const xPaid = action.xValue;
  // Elite direct High-Ground deploy costs +2 (Rulebook 16). Frontline/Reserve free.
  const eliteSurcharge =
    action.zone === 'high_ground' &&
    hasEffectiveTrait(card, 'elite')
      ? ELITE_HIGH_GROUND_SURCHARGE
      : 0;
  const baseCost = effectiveCost(player, card, state.config);
  const surchargedCost: ResourceCost = {
    ...baseCost,
    flexible: baseCost.flexible + eliteSurcharge,
  };
  const deployCost = addXCost(surchargedCost, xPaid ?? 0, card.xCostResource);
  if (!canAfford(player, deployCost)) return { state, events: [] };
  const paidPlayer = consumeReductions(payCost(player, deployCost), card);
  // Did this deploy consume any Temporary Resource? (RIA-09 Symbiotic Expansion).
  const usedTemp = totalTempResources(player) > totalTempResources(paidPlayer);

  const deployedCard: CardInstance = {
    ...card,
    summoningSick: !hasEffectiveTrait(card, 'haste'),
    owner: state.activePlayerIndex,
    // Rush X grants X extra deploy-turn moves; Swift grants 1 extra move this turn.
    // Both are seeded as free moves that do not exhaust the mover (Rulebook 16).
    ...(deployFreeMoves(card) > 0 ? { freeMovesRemaining: deployFreeMoves(card) } : {}),
  };

  const newZones = deployToZone(paidPlayer.zones, deployedCard, action.zone, action.slotIndex);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  const newPlayer: PlayerState = {
    ...paidPlayer,
    zones: newZones,
    hand: newHand,
    turnCounters: {
      ...paidPlayer.turnCounters,
      charactersDeployed: paidPlayer.turnCounters.charactersDeployed + 1,
    },
  };

  const baseState = setPlayer(state, state.activePlayerIndex, newPlayer);
  // BUG FIX (config.registerPrintedTriggers): register the deployed card's
  // printed triggered abilities so the dispatch runtime can actually see them
  // (see GameConfig.registerPrintedTriggers). Absent/false ⇒ no-op.
  const triggeredState =
    state.config?.registerPrintedTriggers === true
      ? registerCardTriggers(baseState, card.instanceId)
      : baseState;
  // Flag the deploy's temp-resource use on turnState so the CARD_DEPLOYED event's
  // `event_context: used_temporary_resource` watchers can read it during dispatch.
  // Always (re)set explicitly so a prior temp-deploy's flag never leaks to a later
  // non-temp deploy in the same turn.
  const deployedState: GameState = {
    ...triggeredState,
    turnState: { ...triggeredState.turnState, usedTemporaryResource: usedTemp },
  };
  const deployEvent: GameEvent = {
    type: 'CARD_DEPLOYED',
    cardInstanceId: card.instanceId,
    cardDefId: card.cardDefId,
    zone: action.zone,
    playerId: state.activePlayerIndex,
  };
  const ran = runAbilityEffects(
    deployedState,
    card.instanceId,
    abilityEffects(card.abilities, true),
    state.activePlayerIndex,
    xPaid,
  );
  return { state: ran.state, events: [deployEvent, ...ran.events] };
}

function executeCastSpell(
  state: GameState,
  action: { cardInstanceId: string; xValue?: number; selectedTargetIds?: readonly string[] },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex];
  const cardIndex = player.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  const xPaid = action.xValue;
  const spellCost = addXCost(
    effectiveCost(player, card, state.config),
    xPaid ?? 0,
    card.xCostResource,
  );
  if (!canAfford(player, spellCost)) return { state, events: [] };
  const paidPlayer = consumeReductions(payCost(player, spellCost), card);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  const newPlayer: PlayerState = {
    ...paidPlayer,
    hand: newHand,
    discardPile: [...paidPlayer.discardPile, card],
    turnCounters: {
      ...paidPlayer.turnCounters,
      spellsCast: paidPlayer.turnCounters.spellsCast + 1,
    },
  };

  // Push the spell onto the stack (Rulebook 14): cost/discard happen now (spent
  // resources are not refunded even if countered), but the EFFECTS are deferred
  // so the non-active player gets a response window. The window machinery resolves
  // the chain LIFO; when nobody can respond it resolves inline (semantically invariant).
  const stackItem: StackItem = {
    id: `spell_${card.instanceId}`,
    type: 'spell',
    sourceInstanceId: card.instanceId,
    sourceCardDefId: card.cardDefId,
    controllerId: state.activePlayerIndex,
    effects: abilityEffects(card.abilities, false),
    targets: action.selectedTargetIds ?? [],
    ...(xPaid !== undefined ? { xPaid } : {}),
  };
  const castState: GameState = {
    ...setPlayer(state, state.activePlayerIndex, newPlayer),
    stack: [...state.stack, stackItem],
  };
  const resolved = openWindowOrResolve(castState, stackItem.id);
  const declaredEvent: GameEvent = {
    type: 'SPELL_CAST',
    cardInstanceId: card.instanceId,
    cardDefId: card.cardDefId,
    playerId: state.activePlayerIndex,
  };
  return {
    state: resolved.state,
    events:
      state.config?.transactionalDeclarations === true
        ? [
            {
              type: 'SPELL_DECLARED',
              stackItemId: stackItem.id,
              cardInstanceId: card.instanceId,
              cardDefId: card.cardDefId,
              playerId: state.activePlayerIndex,
            },
            declaredEvent,
            ...resolved.events,
          ]
        : resolved.events,
  };
}

function executeAttachEquipment(
  state: GameState,
  action: { cardInstanceId: string; targetInstanceId: string; xValue?: number },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex];
  const cardIndex = player.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const equipCard = player.hand[cardIndex]!;
  const target = findOnBattlefield(state, action.targetInstanceId);
  // Honor the equipment's alignment/Tag requirement (Rulebook 13).
  if (target === null || !meetsEquipRequirement(equipCard, target)) return { state, events: [] };
  const xPaid = action.xValue;
  const equipCost = addXCost(
    effectiveCost(player, equipCard, state.config),
    xPaid ?? 0,
    equipCard.xCostResource,
  );
  if (!canAfford(player, equipCost)) return { state, events: [] };
  const paidPlayer = consumeReductions(payCost(player, equipCost), equipCard);
  const newHand = paidPlayer.hand.filter((_, i) => i !== cardIndex);

  // Replacing equipment (Rulebook 13): a character may already hold a piece; the
  // existing one is destroyed (to the owner's discard) immediately before the new
  // one attaches.
  const replaced = target.equipment;

  // Attach to target character, recording the X paid on the equipment so its
  // continuous x_cost auras (e.g. Steel-Root Armor +0/+X HP) scale on recompute.
  const xPaidEquip: CardInstance = {
    ...equipCard,
    holderInstanceId: action.targetInstanceId,
    ...(xPaid !== undefined ? { xPaid } : {}),
  };
  // BUG FIX (config.equipmentTriggers): register the equipment's own printed
  // triggered abilities now, the equipment's "enters play" moment, exactly like
  // registerPrintedTriggers does for a deployed card's abilities — an attached
  // equipment isn't in a zone slot of its own, so it can't go through
  // registerCardTriggers/updateCardTriggers; apply computeCardTriggers directly
  // to the CardInstance instead. See GameConfig.equipmentTriggers.
  // Absent/false ⇒ semantically invariant no-op.
  const attachedEquip: CardInstance =
    state.config?.equipmentTriggers === true
      ? { ...xPaidEquip, registeredTriggers: computeCardTriggers(xPaidEquip) }
      : xPaidEquip;
  const equipEffects = [
    ...abilityEffects(equipCard.abilities, true),
    ...(state.config?.equipmentTriggers === true
      ? equipmentAttachedEffects(equipCard.abilities)
      : []),
  ];

  if (
    state.config?.responseWindowsOnAllActions === true &&
    state.config.transactionalDeclarations === true
  ) {
    const declaredPlayer: PlayerState = {
      ...paidPlayer,
      hand: newHand,
      turnCounters: {
        ...paidPlayer.turnCounters,
        equipmentPlayed: paidPlayer.turnCounters.equipmentPlayed + 1,
      },
    };
    const declaredState = setPlayer(state, state.activePlayerIndex, declaredPlayer);
    const stackItem: StackItem = {
      id: `equip_${equipCard.instanceId}`,
      type: 'equip',
      sourceInstanceId: equipCard.instanceId,
      sourceCardDefId: equipCard.cardDefId,
      controllerId: state.activePlayerIndex,
      effects: equipEffects,
      targets: [action.targetInstanceId],
      declaredCard: attachedEquip,
      ...(xPaid !== undefined ? { xPaid } : {}),
    };
    const withStack: GameState = {
      ...declaredState,
      stack: [...declaredState.stack, stackItem],
    };
    const opened = openWindowOrResolve(withStack, stackItem.id, 'equip');
    return {
      state: opened.state,
      events: [
        {
          type: 'EQUIPMENT_DECLARED',
          equipmentId: equipCard.instanceId,
          targetId: action.targetInstanceId,
          cardDefId: equipCard.cardDefId,
          playerId: state.activePlayerIndex,
        },
        ...opened.events,
      ],
    };
  }

  const attachToCard = (c: CardInstance | null): CardInstance | null => {
    if (c === null || c.instanceId !== action.targetInstanceId) return c;
    return { ...c, equipment: attachedEquip };
  };

  const newZones = {
    reserve: paidPlayer.zones.reserve.map(attachToCard),
    frontline: paidPlayer.zones.frontline.map(attachToCard),
    highGround: paidPlayer.zones.highGround.map(attachToCard),
  };

  const newPlayer: PlayerState = {
    ...paidPlayer,
    zones: newZones,
    hand: newHand,
    discardPile:
      replaced === null
        ? paidPlayer.discardPile
        : [...paidPlayer.discardPile, { ...replaced, holderInstanceId: undefined }],
    turnCounters: {
      ...paidPlayer.turnCounters,
      equipmentPlayed: paidPlayer.turnCounters.equipmentPlayed + 1,
    },
  };

  const attachedState = setPlayer(state, state.activePlayerIndex, newPlayer);
  const replacedEvents: GameEvent[] =
    replaced === null
      ? []
      : [
          {
            type: 'CARD_DESTROYED',
            cardInstanceId: replaced.instanceId,
            cardDefId: replaced.cardDefId,
            cause: 'effect',
            playerId: replaced.owner,
            lastKnownCard: snapshotCard(replaced),
          },
        ];
  const attachEvent: GameEvent = {
    type: 'EQUIPMENT_ATTACHED',
    equipmentId: equipCard.instanceId,
    targetId: action.targetInstanceId,
    cardDefId: equipCard.cardDefId,
    playerId: equipCard.owner,
  };
  // TIER 4 (config.responseWindowsOnAllActions): attach_equipment opens a
  // response window (Rulebook 14) — payment, hand-removal, attachment, and any
  // replaced-equipment destruction happen now (the physical/cost half), but the
  // equipment's deploy-time EFFECTS defer through the stack and resolve only
  // when the window closes. An equipment with no deploy effects stays inline
  // (a window over nothing is pointless). Absent/false ⇒ direct-resolution path.
  // config.equipmentTriggers folds in the equipment's own on_equipment_attached
  // effects (e.g. Growplate Helm's grant_ability) alongside its deploy-time
  // effects — both are attach-time effects of this same equipment.
  if (state.config?.responseWindowsOnAllActions === true && equipEffects.length > 0) {
    const stackItem: StackItem = {
      id: `equip_${equipCard.instanceId}`,
      type: 'equip',
      sourceInstanceId: equipCard.instanceId,
      sourceCardDefId: equipCard.cardDefId,
      controllerId: state.activePlayerIndex,
      effects: equipEffects,
      targets: [],
      ...(xPaid !== undefined ? { xPaid } : {}),
    };
    const withStack: GameState = { ...attachedState, stack: [...attachedState.stack, stackItem] };
    const resolved = openWindowOrResolve(withStack, stackItem.id, 'equip');
    return { state: resolved.state, events: [...replacedEvents, attachEvent, ...resolved.events] };
  }
  // Run the equipment's deploy-time effects (e.g. Steel-Root Armor's +0/+X HP)
  // now that it is attached, threading the X paid so x_cost stat grants scale.
  const ran = runAbilityEffects(
    attachedState,
    equipCard.instanceId,
    equipEffects,
    state.activePlayerIndex,
    xPaid,
  );
  return { state: ran.state, events: [...replacedEvents, attachEvent, ...ran.events] };
}

// Voluntary removal (Rulebook 13): the active player discards an attached equipment
// without penalty. The holder keeps its base body; the equipment goes to the owner's
// discard pile and auras are recomputed so its continuous bonuses drop.
function executeRemoveEquipment(
  state: GameState,
  action: { equipmentInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const holder = findEquipmentHolder(state, state.activePlayerIndex, action.equipmentInstanceId);
  if (holder === null) return { state, events: [] };
  const equip = { ...holder.equipment!, holderInstanceId: undefined };
  const cleared = updateCardInState(state, holder.instanceId, (c) => ({ ...c, equipment: null }));
  const player = cleared.players[state.activePlayerIndex];
  const withDiscard = setPlayer(cleared, state.activePlayerIndex, {
    ...player,
    discardPile: [...player.discardPile, equip],
  });
  return {
    state: recomputeAuras(withDiscard),
    events: [
      {
        type: 'EQUIPMENT_DETACHED',
        equipmentId: equip.instanceId,
        holderId: holder.instanceId,
        playerId: equip.owner,
        reason: 'voluntary',
      },
      {
        type: 'EQUIPMENT_DISCARDED',
        equipmentId: equip.instanceId,
        cardDefId: equip.cardDefId,
        playerId: equip.owner,
        reason: 'voluntary',
      },
    ],
  };
}

// Transfer (Rulebook 13): move equipment from one character to another eligible
// character by paying its cost again; only once per turn. The destination must meet
// the equipment's alignment/Tag requirement and be empty (one-equipment default).
function executeTransferEquipment(
  state: GameState,
  action: { equipmentInstanceId: string; targetInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const holder = findEquipmentHolder(state, state.activePlayerIndex, action.equipmentInstanceId);
  const target = findOnBattlefield(state, action.targetInstanceId);
  if (holder === null || target === null || target.equipment !== null) return { state, events: [] };
  const equip = holder.equipment!;
  if (equip.transferredThisTurn === true) return { state, events: [] };
  const player = state.players[state.activePlayerIndex];
  if (
    !meetsEquipRequirement(equip, target) ||
    !canAfford(player, effectiveCost(player, equip, state.config))
  ) {
    return { state, events: [] };
  }
  const paidPlayer = consumeReductions(
    payCost(player, effectiveCost(player, equip, state.config)),
    equip,
  );
  const paid = setPlayer(
    state,
    state.activePlayerIndex,
    paidPlayer,
  );
  if (
    state.config?.responseWindowsOnAllActions === true &&
    state.config.transactionalDeclarations === true
  ) {
    const committed = updateCardInState(paid, holder.instanceId, (card) => ({
      ...card,
      equipment:
        card.equipment === null
          ? null
          : { ...card.equipment, transferredThisTurn: true },
    }));
    const stackItem: StackItem = {
      id: `transfer_${equip.instanceId}`,
      type: 'transfer',
      sourceInstanceId: equip.instanceId,
      sourceCardDefId: equip.cardDefId,
      controllerId: state.activePlayerIndex,
      effects: [],
      targets: [holder.instanceId, target.instanceId],
    };
    const opened = openWindowOrResolve(
      { ...committed, stack: [...committed.stack, stackItem] },
      stackItem.id,
      'equip',
    );
    return {
      state: opened.state,
      events: [
        {
          type: 'EQUIPMENT_DECLARED',
          equipmentId: equip.instanceId,
          targetId: target.instanceId,
          cardDefId: equip.cardDefId,
          playerId: equip.owner,
        },
        ...opened.events,
      ],
    };
  }
  const movedEquip: CardInstance = {
    ...equip,
    holderInstanceId: target.instanceId,
    transferredThisTurn: true,
  };
  const detached = updateCardInState(paid, holder.instanceId, (c) => ({ ...c, equipment: null }));
  const attached = updateCardInState(detached, target.instanceId, (c) => ({
    ...c,
    equipment: movedEquip,
  }));
  return {
    state: recomputeAuras(attached),
    events: [
      {
        type: 'EQUIPMENT_DETACHED',
        equipmentId: equip.instanceId,
        holderId: holder.instanceId,
        playerId: equip.owner,
        reason: 'transfer',
      },
      {
        type: 'EQUIPMENT_TRANSFERRED',
        equipmentId: equip.instanceId,
        fromHolderId: holder.instanceId,
        toHolderId: target.instanceId,
        playerId: equip.owner,
      },
      {
        type: 'EQUIPMENT_ATTACHED',
        equipmentId: equip.instanceId,
        targetId: target.instanceId,
        cardDefId: equip.cardDefId,
        playerId: equip.owner,
      },
    ],
  };
}

function findEquipmentHolder(
  state: GameState,
  playerIndex: 0 | 1,
  equipmentInstanceId: string,
): CardInstance | null {
  const player = state.players[playerIndex];
  for (const zone of [player.zones.reserve, player.zones.frontline, player.zones.highGround]) {
    for (const c of zone) {
      if (c !== null && c.equipment?.instanceId === equipmentInstanceId) return c;
    }
  }
  return null;
}

function executeMove(
  state: GameState,
  action: { cardInstanceId: string; toZone: ZoneType },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex];
  // Slowed characters cannot move (Rulebook 16).
  const mover = findOnBattlefield(state, action.cardInstanceId);
  if (mover !== null && isSlowed(mover)) return { state, events: [] };
  // TIER 4 (config.responseWindowsOnAllActions): move opens a response window
  // (Rulebook 14) — the zone move DEFERS through the stack. A zone move is not
  // an Effect, so the StackItem carries the declaration (mover + destination,
  // effects empty) and resolveStack re-invokes moveCard when the window closes
  // (fizzling if the mover left or was Slowed mid-window). Absent/false ⇒
  // direct-resolution path.
  if (state.config?.responseWindowsOnAllActions === true) {
    const stackItem: StackItem = {
      id: `move_${action.cardInstanceId}_${action.toZone}`,
      type: 'move',
      sourceInstanceId: action.cardInstanceId,
      controllerId: state.activePlayerIndex,
      effects: [],
      targets: [action.toZone],
    };
    const declared =
      state.config.transactionalDeclarations === true
        ? updateCardInState(state, action.cardInstanceId, (card) => {
            const freeMoves = card.freeMovesRemaining ?? 0;
            return freeMoves > 0
              ? { ...card, freeMovesRemaining: freeMoves - 1 }
              : { ...card, exhausted: true, movedThisTurn: true };
          })
        : state;
    const withStack: GameState = {
      ...declared,
      stack: [...declared.stack, stackItem],
    };
    return openWindowOrResolve(withStack, stackItem.id, 'move');
  }
  const newZones = moveCard(player.zones, action.cardInstanceId, action.toZone);

  const fromLoc = (['reserve', 'frontline', 'high_ground'] as const).find((z) => {
    const arr =
      z === 'reserve'
        ? player.zones.reserve
        : z === 'frontline'
          ? player.zones.frontline
          : player.zones.highGround;
    return arr.some((c) => c?.instanceId === action.cardInstanceId);
  });

  return {
    state: setPlayer(state, state.activePlayerIndex, { ...player, zones: newZones }),
    events: [
      {
        type: 'CARD_MOVED',
        cardInstanceId: action.cardInstanceId,
        fromZone: fromLoc ?? 'frontline',
        toZone: action.toZone,
      },
    ],
  };
}

function executeActivateAbility(
  state: GameState,
  action: { cardInstanceId: string; abilityIndex: number; xValue?: number },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  if (
    state.config?.authoritativeTransitions === true &&
    !computeAvailableActions(state).canActivateAbility.some(
      (option) =>
        option.cardInstanceId === action.cardInstanceId &&
        option.abilityIndex === action.abilityIndex &&
        (action.xValue === undefined
          ? option.xValues === undefined || option.xValues.includes(0)
          : option.xValues?.includes(action.xValue) === true),
    )
  ) {
    return { state, events: [] };
  }
  const activatedEvent: GameEvent = {
    type: 'ABILITY_ACTIVATED',
    cardInstanceId: action.cardInstanceId,
    abilityIndex: action.abilityIndex,
  };
  // Hero abilities are addressed via a `hero_<cardDefId>` pseudo-id.
  const heroAbilities = heroAbilitiesFor(state, action.cardInstanceId);
  const abilities = heroAbilities ?? findOnBattlefield(state, action.cardInstanceId)?.abilities;
  const ability = abilities?.[action.abilityIndex];
  const effects =
    ability && (ability.type === 'triggered' || ability.type === 'aura') ? ability.effects : [];

  // Pay the activated ability's cost (mana/energy/flexible, plus any X). Affordability
  // is already gated in computeActivateOptions, so this only deducts — matching the
  // deploy/cast/equip pipeline. A 0-cost ability (e.g. Kaelthar idx0) pays nothing.
  let payState = state;
  if (ability?.type === 'triggered' && ability.trigger.type === 'activated') {
    const player = state.players[state.activePlayerIndex];
    const cost = addXCost(
      ability.trigger.cost,
      action.xValue ?? 0,
      ability.xCostResource,
    );
    if (!canAfford(player, cost)) return { state, events: [] };
    const paid = payCost(player, cost);
    payState = setPlayer(
      state,
      state.activePlayerIndex,
      state.config?.scopedTurnResets === true
        ? {
            ...paid,
            turnCounters: {
              ...paid.turnCounters,
              abilitiesActivated: paid.turnCounters.abilitiesActivated + 1,
            },
          }
        : paid,
    );
  }

  // A character that uses an activated ability becomes exhausted (Rulebook 3/8) and
  // lifts Stealth's untargetability (Rulebook 16). Only battlefield cards carry
  // these; the Hero pseudo-id is not on the battlefield and never exhausts here.
  if (heroAbilities === null && findOnBattlefield(payState, action.cardInstanceId) !== null) {
    payState = updateCardInState(payState, action.cardInstanceId, (c) => ({
      ...c,
      hasActed: true,
      exhausted: true,
    }));
  }

  // TIER 4 (config.responseWindowsOnAllActions): activate_ability opens a
  // response window (Rulebook 14) — cost payment and exhaustion happen now (like
  // a cast's pay/discard: spent, never refunded), but the ability's EFFECTS defer
  // through the stack and resolve only when the window closes. An activation
  // with no effects stays inline (a window over nothing is pointless).
  // Absent/false ⇒ direct-resolution path.
  if (state.config?.responseWindowsOnAllActions === true && effects.length > 0) {
    const stackItem: StackItem = {
      id: `ability_${action.cardInstanceId}_${String(action.abilityIndex)}`,
      type: 'ability',
      sourceInstanceId: action.cardInstanceId,
      controllerId: state.activePlayerIndex,
      effects,
      targets: [],
      ...(action.xValue !== undefined ? { xPaid: action.xValue } : {}),
    };
    const withStack: GameState = { ...payState, stack: [...payState.stack, stackItem] };
    const resolved = openWindowOrResolve(withStack, stackItem.id, 'ability');
    return { state: resolved.state, events: [activatedEvent, ...resolved.events] };
  }

  const ran = runAbilityEffects(
    payState,
    action.cardInstanceId,
    effects,
    payState.activePlayerIndex,
    action.xValue,
  );
  return { state: ran.state, events: [activatedEvent, ...ran.events] };
}

/** If `id` addresses the active player's Hero, return its abilities; else null. */
function heroAbilitiesFor(state: GameState, id: string): readonly AbilityDSL[] | null {
  const hero = state.players[state.activePlayerIndex].hero;
  return id === `hero_${String(hero.cardDefId)}` ? hero.abilities : null;
}

function executeDiscardForEnergy(
  state: GameState,
  action: { cardInstanceId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  const player = state.players[state.activePlayerIndex];
  const cardIndex = player.hand.findIndex((c) => c.instanceId === action.cardInstanceId);
  if (cardIndex === -1) return { state, events: [] };

  const card = player.hand[cardIndex]!;
  // Grant a temporary resource matching the card's resource type (Rulebook 11:
  // "Mana if the card is Magic-aligned, Energy if Tech-aligned"). Under
  // exileDiscardForEnergy the card is removed from the game instead of binned, so it
  // never becomes reanimation fuel; otherwise it goes to the discard pile as usual.
  const exile = state.config?.exileDiscardForEnergy === true;
  const newPlayer: PlayerState = {
    ...player,
    hand: player.hand.filter((_, i) => i !== cardIndex),
    ...(exile ? {} : { discardPile: [...player.discardPile, card] }),
    ...(exile
      ? {
          exile: [
            ...player.exile,
            {
              instanceId: card.instanceId,
              card,
              ownerPlayerId: state.activePlayerIndex,
              cause: 'discard_for_energy' as const,
              turnNumber: state.turnNumber,
              sourceInstanceId: card.instanceId,
            },
          ],
        }
      : {}),
    temporaryResources: [
      ...player.temporaryResources,
      { resourceType: cardResourceType(card), amount: 1 },
    ],
  };

  const newState: GameState = {
    ...setPlayer(state, state.activePlayerIndex, newPlayer),
    turnState: { ...state.turnState, discardedForEnergy: true },
  };

  return {
    state: newState,
    events: exile
      ? [
          {
            type: 'CARD_EXILED',
            cardInstanceId: card.instanceId,
            cardDefId: card.cardDefId,
            playerId: state.activePlayerIndex,
          },
        ]
      : [
          {
            type: 'CARD_DISCARDED',
            cardInstanceId: card.instanceId,
            cardDefId: card.cardDefId,
            playerId: state.activePlayerIndex,
          },
        ],
  };
}

function executeDeclareAttack(
  state: GameState,
  action: { attackerInstanceId: string; targetId: string },
): { readonly state: GameState; readonly events: readonly GameEvent[] } {
  // TIER 4 (config.responseWindowsOnAllActions): declare_attack opens a response
  // window (Rulebook 14) — the whole combat DEFERS through the stack. Combat
  // damage steps are not expressible as Effect[], so the StackItem carries the
  // declaration (attacker + target, effects empty) and resolveStack re-invokes
  // resolveCombat when the window closes; a Counter on the chain removes the
  // attack item so the combat never happens. Absent/false ⇒ direct-resolution path.
  if (state.config?.responseWindowsOnAllActions === true) {
    const stackItem: StackItem = {
      id: `attack_${action.attackerInstanceId}`,
      type: 'attack',
      sourceInstanceId: action.attackerInstanceId,
      controllerId: state.activePlayerIndex,
      effects: [],
      targets: [action.targetId],
    };
    const declaredState =
      state.config.transactionalDeclarations === true
        ? updateCardInState(state, action.attackerInstanceId, (card) => ({
            ...card,
            exhausted: true,
            attackedThisTurn: true,
            hasActed: true,
          }))
        : state;
    const withStack: GameState = {
      ...declaredState,
      stack: [...declaredState.stack, stackItem],
    };
    return openWindowOrResolve(withStack, stackItem.id, 'attack');
  }
  const result = resolveCombat(state, action.attackerInstanceId, action.targetId);
  return { state: result.newState, events: result.events };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function setPlayer(state: GameState, index: 0 | 1, player: PlayerState): GameState {
  const newPlayers = [...state.players] as [PlayerState, PlayerState];
  newPlayers[index] = player;
  return { ...state, players: newPlayers };
}

function updateActivePlayer(
  state: GameState,
  updater: (player: PlayerState) => PlayerState,
): GameState {
  const player = state.players[state.activePlayerIndex];
  return setPlayer(state, state.activePlayerIndex, updater(player));
}

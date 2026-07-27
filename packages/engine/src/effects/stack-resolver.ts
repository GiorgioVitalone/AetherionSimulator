/**
 * Stack Resolver — drives the reactive priority window + LIFO chain resolution
 * (Rulebook Section 14). A windowable action pushes a StackItem and opens a
 * response window for the non-active player; once both players pass, the chain
 * resolves last-in-first-out. A Counter on the chain removes its target before
 * that target resolves (executeCounterSpell, reused unchanged).
 *
 * Spell casts push a `spell` item. Under config.responseWindowsOnAllActions
 * (Tier 4) the other base actions also defer through here: `ability`/`equip`
 * items carry plain effects (run through runAbilityEffects like a spell), while
 * `attack`/`move`/`transfer` items carry a DECLARATION (effects empty — combat,
 * zone moves, and attachment relations are not expressible as Effect[]) that is
 * re-invoked through the appropriate authoritative resolver at resolution time.
 */
import type {
  GameState,
  GameEvent,
  PendingPriority,
  PlayerState,
  StackItem,
  CardInstance,
} from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';
import { runAbilityEffects } from './effect-runner.js';
import { computeReactiveActions } from '../actions/reactive-actions.js';
import { resolveCombat } from '../combat/combat-resolver.js';
import {
  findCard,
  getAllCards,
  moveCard,
  resolveCommittedMove,
} from '../zones/zone-manager.js';
import { isSlowed } from '../runtime/status-tick.js';
import { findCardInState, updateCardInState } from './state-helpers.js';
import { meetsEquipRequirement } from '../actions/equip-eligibility.js';
import { GuardExhaustionError } from '../errors/engine-errors.js';
import { isHeroTargetId } from '../selectors/hero-identity.js';

export interface StackResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * After an action is pushed onto the stack, either open a window (non-active
 * player has a legal Counter/Flash) or resolve the chain immediately. Resolving
 * inline when nobody can respond keeps non-reactive games semantically invariant to the
 * old resolve-on-declaration behavior. `window` records which base action kind
 * opened the window ('cast' for spell casts; the other kinds only occur under
 * config.responseWindowsOnAllActions).
 */
export function openWindowOrResolve(
  state: GameState,
  baseStackItemId: string,
  window: PendingPriority['window'] = 'cast',
): {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
} {
  const item = state.stack.find((candidate) => candidate.id === baseStackItemId);
  const declarationEvents =
    state.config?.transactionalDeclarations === true && item !== undefined
      ? [stackDeclaredEvent(item)]
      : [];
  const responderId = state.activePlayerIndex === 0 ? 1 : 0;
  if (computeReactiveActions(state, responderId).length === 0) {
    const resolved = resolveStack(state);
    return {
      state: resolved.state,
      events: [...declarationEvents, ...resolved.events],
    };
  }
  const pendingPriority: PendingPriority = {
    type: 'priority',
    toRespondPlayerId: responderId,
    window,
    baseStackItemId,
    passes: 0,
  };
  return { state: { ...state, pendingPriority }, events: declarationEvents };
}

export function stackDeclaredEvent(item: StackItem): GameEvent {
  return {
    type: 'STACK_ITEM_DECLARED',
    stackItemId: item.id,
    stackItemType: item.type,
    sourceInstanceId: item.sourceInstanceId,
    controllerPlayerId: item.controllerId,
    targetIds: item.targets,
  };
}

/**
 * Give every still-declared transaction a terminal disposition when the game
 * ends before its priority chain can resolve. Costs and card movement remain
 * committed; the unresolved effects fizzle and no post-game priority or choice
 * survives into the observable terminal state.
 */
export function closeTerminalStack(
  state: GameState,
  reason = 'game ended before stack resolution',
): StackResult {
  if (state.winner === null) return { state, events: [] };
  const events = [...state.stack]
    .reverse()
    .flatMap((item) => fizzledEvents(item, reason));
  if (
    state.stack.length === 0 &&
    state.pendingPriority == null &&
    state.pendingChoice === null
  ) {
    return { state, events };
  }
  return {
    state: {
      ...state,
      stack: [],
      pendingPriority: null,
      pendingChoice: null,
    },
    events,
  };
}

/**
 * Record a pass in the open window. Two consecutive passes close the window and
 * resolve the chain; one pass flips priority to the other player.
 */
export function passPriority(state: GameState): StackResult {
  const pp = state.pendingPriority;
  if (pp === null || pp === undefined) return { state, events: [] };
  if (pp.passes >= 1) {
    return resolveStack({ ...state, pendingPriority: null });
  }
  const other = pp.toRespondPlayerId === 0 ? 1 : 0;
  const next: PendingPriority = { ...pp, toRespondPlayerId: other, passes: pp.passes + 1 };
  return { state: { ...state, pendingPriority: next }, events: [] };
}

/**
 * Resolve the stack LIFO: pop the top item, run its effects, repeat to empty. A
 * countered item is already absent (removed by executeCounterSpell), so it is
 * simply skipped. Returns to no open window.
 */
export function resolveStack(state: GameState): StackResult {
  let current: GameState = { ...state, pendingPriority: null };
  const events: GameEvent[] = [];
  // Bound the loop defensively; a chain is hand-limited in practice.
  let guard = 0;
  while (current.stack.length > 0 && guard++ < 64) {
    const top = current.stack[current.stack.length - 1]!;
    const popped: readonly StackItem[] = current.stack.slice(0, -1);
    const beforeResolve: GameState = { ...current, stack: popped };
    // SPELL_CAST fires on RESOLUTION, not at cast-push: a countered spell is removed
    // from the stack before reaching here, so its on_spell_cast watchers never fire
    // (Rulebook 14). Emitted before the effects so the watcher sees the cast.
    if (top.type === 'spell' && current.config?.transactionalDeclarations !== true) {
      events.push({
        type: 'SPELL_CAST',
        cardInstanceId: top.sourceInstanceId,
        // Omit when absent (rather than faking cardDefId 0) so consumers see
        // "unknown" instead of a real-looking def id — see SpellCastEvent.
        ...(top.sourceCardDefId !== undefined ? { cardDefId: top.sourceCardDefId } : {}),
        playerId: top.controllerId,
      });
    }
    if (
      current.config?.transactionalDeclarations === true &&
      (top.type === 'spell' || top.type === 'ability') &&
      top.targets.length > 0 &&
      !top.targets.some((targetId) => stackTargetExists(beforeResolve, targetId))
    ) {
      current = beforeResolve;
      events.push(...fizzledEvents(top, 'all declared targets became illegal'));
      continue;
    }
    const ran =
      top.type === 'attack'
        ? resolveAttackItem(beforeResolve, top)
        : top.type === 'move'
          ? resolveMoveItem(beforeResolve, top)
          : top.type === 'transfer'
            ? resolveTransferItem(beforeResolve, top)
          : top.type === 'equip' && top.declaredCard !== undefined
            ? resolveEquipItem(beforeResolve, top)
          : runAbilityEffects(
              beforeResolve,
              top.sourceInstanceId,
              top.effects,
              top.controllerId,
              top.xPaid,
              top.targets.length > 0 ? top.targets : undefined,
            );
    current = ran.state;
    events.push(...ran.events);
    if (current.pendingChoice !== null) {
      current = {
        ...current,
        pendingChoice: {
          ...current.pendingChoice,
          stackResolutionContinuation: { item: top },
        },
      };
      break;
    }
    if (current.config?.transactionalDeclarations === true) {
      const fizzled = ran.events.some(
        (event) =>
          event.type === 'STACK_ITEM_FIZZLED' && event.stackItemId === top.id,
      );
      if (!fizzled) {
        events.push({
          type: 'STACK_ITEM_RESOLVED',
          stackItemId: top.id,
          stackItemType: top.type,
          sourceInstanceId: top.sourceInstanceId,
          controllerPlayerId: top.controllerId,
        });
        if (top.type === 'spell') {
          events.push({
            type: 'SPELL_RESOLVED',
            stackItemId: top.id,
            cardInstanceId: top.sourceInstanceId,
            playerId: top.controllerId,
          });
        }
      }
    }
    if (current.winner !== null) break;
  }
  if (
    current.stack.length > 0 &&
    current.pendingChoice === null &&
    current.config?.authoritativeTransitions === true
  ) {
    throw new GuardExhaustionError(
      `Stack resolution exhausted with ${String(current.stack.length)} pending item(s)`,
    );
  }
  return { state: current, events };
}

/** Finish the stack item that paused for an explicit effect choice, then resume
 * ordinary LIFO resolution of the lower stack. */
export function resumeStackAfterChoice(
  state: GameState,
  item: StackItem,
): StackResult {
  const events =
    state.config?.transactionalDeclarations === true
      ? resolvedEvents(item)
      : [];
  if (state.winner !== null || state.stack.length === 0) {
    return { state, events };
  }
  const resumed = resolveStack(state);
  return {
    state: resumed.state,
    events: [...events, ...resumed.events],
  };
}

function resolvedEvents(item: StackItem): readonly GameEvent[] {
  return [
    {
      type: 'STACK_ITEM_RESOLVED',
      stackItemId: item.id,
      stackItemType: item.type,
      sourceInstanceId: item.sourceInstanceId,
      controllerPlayerId: item.controllerId,
    },
    ...(item.type === 'spell'
      ? [
          {
            type: 'SPELL_RESOLVED' as const,
            stackItemId: item.id,
            cardInstanceId: item.sourceInstanceId,
            playerId: item.controllerId,
          },
        ]
      : []),
  ];
}

function resolveTransferItem(state: GameState, item: StackItem): StackResult {
  const [fromHolderId, toHolderId] = item.targets;
  if (fromHolderId === undefined || toHolderId === undefined) {
    return {
      state,
      events: fizzledEvents(item, 'equipment transfer declaration is incomplete'),
    };
  }
  const fromHolder = findCardInState(state, fromHolderId);
  const toHolder = findCardInState(state, toHolderId);
  const equipment = fromHolder?.equipment ?? null;
  if (
    fromHolder === null ||
    toHolder === null ||
    fromHolder.owner !== item.controllerId ||
    equipment?.instanceId !== item.sourceInstanceId ||
    equipment.owner !== item.controllerId ||
    toHolder.owner !== item.controllerId ||
    toHolder.cardType !== 'C' ||
    toHolder.equipment !== null ||
    !meetsEquipRequirement(equipment, toHolder)
  ) {
    return {
      state,
      events: fizzledEvents(item, 'equipment transfer target became illegal'),
    };
  }
  const detached = updateCardInState(state, fromHolderId, (card) => ({
    ...card,
    equipment: null,
  }));
  const attachedEquipment: CardInstance = {
    ...equipment,
    holderInstanceId: toHolderId,
    transferredThisTurn: true,
  };
  const attached = updateCardInState(detached, toHolderId, (card) => ({
    ...card,
    equipment: attachedEquipment,
  }));
  return {
    state: attached,
    events: [
      {
        type: 'EQUIPMENT_DETACHED',
        equipmentId: equipment.instanceId,
        holderId: fromHolderId,
        playerId: equipment.owner,
        reason: 'transfer',
      },
      {
        type: 'EQUIPMENT_TRANSFERRED',
        equipmentId: equipment.instanceId,
        fromHolderId,
        toHolderId,
        playerId: equipment.owner,
      },
      {
        type: 'EQUIPMENT_ATTACHED',
        equipmentId: equipment.instanceId,
        targetId: toHolderId,
        cardDefId: equipment.cardDefId,
        playerId: equipment.owner,
      },
    ],
  };
}

function stackTargetExists(state: GameState, targetId: string): boolean {
  if (targetId === 'hero' || isHeroTargetId(targetId)) {
    return true;
  }
  if (state.stack.some((item) => item.id === targetId)) return true;
  return state.players.some((player) =>
    getAllCards(player.zones).some((card) => card.instanceId === targetId),
  );
}

function fizzledEvents(item: StackItem, reason: string): readonly GameEvent[] {
  return [
    {
      type: 'STACK_ITEM_FIZZLED',
      stackItemId: item.id,
      stackItemType: item.type,
      sourceInstanceId: item.sourceInstanceId,
      controllerPlayerId: item.controllerId,
      reason,
    },
    ...(item.type === 'spell'
      ? [
          {
            type: 'SPELL_FIZZLED' as const,
            stackItemId: item.id,
            cardInstanceId: item.sourceInstanceId,
            playerId: item.controllerId,
            reason,
          },
        ]
      : []),
  ];
}

function resolveEquipItem(state: GameState, item: StackItem): StackResult {
  const equipment = item.declaredCard;
  const targetId = item.targets[0];
  if (equipment === undefined || targetId === undefined) return { state, events: [] };
  const player = state.players[item.controllerId];
  const target = findCard(player.zones, targetId)?.card;
  if (
    target === undefined ||
    target.cardType !== 'C' ||
    !meetsEquipRequirement(equipment, target)
  ) {
    const discardedEquipment = {
      ...equipment,
      holderInstanceId: undefined,
    };
    const players = [...state.players] as [PlayerState, PlayerState];
    players[item.controllerId] = {
      ...player,
      discardPile: [...player.discardPile, discardedEquipment],
    };
    return {
      state: { ...state, players },
      events: [
        {
          type: 'EQUIPMENT_DISCARDED',
          equipmentId: equipment.instanceId,
          cardDefId: equipment.cardDefId,
          playerId: item.controllerId,
          reason: 'fizzled',
        },
        ...fizzledEvents(item, 'equipment target became illegal'),
      ],
    };
  }

  const replaced = target.equipment;
  let attached = updateCardInState(state, targetId, (card) => ({
    ...card,
    equipment,
  }));
  if (replaced !== null) {
    const nextPlayer = attached.players[item.controllerId];
    const players = [...attached.players] as [PlayerState, PlayerState];
    players[item.controllerId] = {
      ...nextPlayer,
      discardPile: [
        ...nextPlayer.discardPile,
        { ...replaced, holderInstanceId: undefined },
      ],
    };
    attached = { ...attached, players };
  }
  const ran = runAbilityEffects(
    attached,
    equipment.instanceId,
    item.effects,
    item.controllerId,
    item.xPaid,
  );
  return {
    state: ran.state,
    events: [
      ...(replaced === null
        ? []
        : [
            {
              type: 'EQUIPMENT_DETACHED' as const,
              equipmentId: replaced.instanceId,
              holderId: targetId,
              playerId: item.controllerId,
              reason: 'replacement' as const,
            },
            {
              type: 'EQUIPMENT_DISCARDED' as const,
              equipmentId: replaced.instanceId,
              cardDefId: replaced.cardDefId,
              playerId: item.controllerId,
              reason: 'replacement' as const,
            },
          ]),
      {
        type: 'EQUIPMENT_ATTACHED',
        equipmentId: equipment.instanceId,
        targetId,
        cardDefId: equipment.cardDefId,
        playerId: item.controllerId,
      },
      ...ran.events,
    ],
  };
}

// An `attack` StackItem (config.responseWindowsOnAllActions) carries a combat
// DECLARATION, not effects: combat damage steps live in resolveCombat and are
// not expressible as Effect[]. Re-invoke the full combat resolver at resolution
// time (attacker exhaustion, damage steps, destructions, events) exactly as the
// direct-resolution path did at declaration. If a reaction invalidated the
// declaration mid-window (attacker gone/exhausted, target illegal), the attack
// fizzles — the window already consumed it.
function resolveAttackItem(state: GameState, item: StackItem): StackResult {
  try {
    const combat = resolveCombat(
      state,
      item.sourceInstanceId,
      item.targets[0] ?? 'hero',
      state.config?.transactionalDeclarations === true,
    );
    return { state: combat.newState, events: combat.events };
  } catch {
    return {
      state,
      events: [...fizzledEvents(item, 'attack declaration became illegal')],
    };
  }
}

// A `move` StackItem (config.responseWindowsOnAllActions) likewise carries a
// move DECLARATION (mover + destination zone), re-invoked through moveCard at
// resolution time. Fizzles when the mover left the battlefield, a reaction
// Slowed it mid-window (mirroring executeMove's declaration-time Slowed gate),
// or the move became illegal (e.g. the destination filled up).
function resolveMoveItem(state: GameState, item: StackItem): StackResult {
  const toZone = item.targets[0] as ZoneType | undefined;
  const player = state.players[item.controllerId];
  const location = toZone !== undefined ? findCard(player.zones, item.sourceInstanceId) : null;
  if (location === null || toZone === undefined || isSlowed(location.card)) {
    return {
      state,
      events: [...fizzledEvents(item, 'move declaration became illegal')],
    };
  }
  try {
    const newZones =
      state.config?.transactionalDeclarations === true
        ? resolveCommittedMove(player.zones, item.sourceInstanceId, toZone)
        : moveCard(player.zones, item.sourceInstanceId, toZone);
    const newPlayers = [...state.players] as [PlayerState, PlayerState];
    newPlayers[item.controllerId] = { ...player, zones: newZones };
    return {
      state: { ...state, players: newPlayers },
      events: [
        {
          type: 'CARD_MOVED',
          cardInstanceId: item.sourceInstanceId,
          fromZone: location.zone,
          toZone,
        },
      ],
    };
  } catch {
    return {
      state,
      events: [...fizzledEvents(item, 'move destination became illegal')],
    };
  }
}

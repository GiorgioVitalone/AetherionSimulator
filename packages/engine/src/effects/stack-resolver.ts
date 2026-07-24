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
 * `attack`/`move` items carry a DECLARATION (effects empty — combat damage steps
 * and zone moves are not expressible as Effect[]) that is re-invoked through
 * resolveCombat / moveCard at resolution time.
 */
import type {
  GameState,
  GameEvent,
  PendingPriority,
  PlayerState,
  StackItem,
} from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';
import { runAbilityEffects } from './effect-runner.js';
import { computeReactiveActions } from '../actions/reactive-actions.js';
import { resolveCombat } from '../combat/combat-resolver.js';
import { findCard, moveCard } from '../zones/zone-manager.js';
import { isSlowed } from '../runtime/status-tick.js';

export interface StackResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/**
 * After an action is pushed onto the stack, either open a window (non-active
 * player has a legal Counter/Flash) or resolve the chain immediately. Resolving
 * inline when nobody can respond keeps non-reactive games byte-identical to the
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
  const responderId = state.activePlayerIndex === 0 ? 1 : 0;
  if (computeReactiveActions(state, responderId).length === 0) {
    return resolveStack(state);
  }
  const pendingPriority: PendingPriority = {
    type: 'priority',
    toRespondPlayerId: responderId,
    window,
    baseStackItemId,
    passes: 0,
  };
  return { state: { ...state, pendingPriority }, events: [] };
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
    if (top.type === 'spell') {
      events.push({
        type: 'SPELL_CAST',
        cardInstanceId: top.sourceInstanceId,
        // Omit when absent (rather than faking cardDefId 0) so consumers see
        // "unknown" instead of a real-looking def id — see SpellCastEvent.
        ...(top.sourceCardDefId !== undefined ? { cardDefId: top.sourceCardDefId } : {}),
        playerId: top.controllerId,
      });
    }
    const ran =
      top.type === 'attack'
        ? resolveAttackItem(beforeResolve, top)
        : top.type === 'move'
          ? resolveMoveItem(beforeResolve, top)
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
    if (current.winner !== null) break;
  }
  return { state: current, events };
}

// An `attack` StackItem (config.responseWindowsOnAllActions) carries a combat
// DECLARATION, not effects: combat damage steps live in resolveCombat and are
// not expressible as Effect[]. Re-invoke the full combat resolver at resolution
// time (attacker exhaustion, damage steps, destructions, events) exactly as the
// legacy inline path did at declaration. If a reaction invalidated the
// declaration mid-window (attacker gone/exhausted, target illegal), the attack
// fizzles — the window already consumed it.
function resolveAttackItem(state: GameState, item: StackItem): StackResult {
  try {
    const combat = resolveCombat(state, item.sourceInstanceId, item.targets[0] ?? 'hero');
    return { state: combat.newState, events: combat.events };
  } catch {
    return { state, events: [] };
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
    return { state, events: [] };
  }
  try {
    const newZones = moveCard(player.zones, item.sourceInstanceId, toZone);
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
    return { state, events: [] };
  }
}

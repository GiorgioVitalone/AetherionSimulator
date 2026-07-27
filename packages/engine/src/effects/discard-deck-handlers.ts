/**
 * Discard- and deck-manipulation effect handlers.
 * Pure: (state, effect, context) => EffectResult. Never mutate input.
 */
import type { Effect } from '../types/effects.js';
import type { ZoneType } from '../types/common.js';
import type {
  GameState,
  GameEvent,
  EffectContext,
  EffectResult,
  CardInstance,
  PlayerState,
} from '../types/game-state.js';
import type { Effect as EffectNode } from '../types/effects.js';
import { resolveTargets, applyFilter } from './target-resolver.js';
import { updateCardInState } from './state-helpers.js';
import { executeEffect } from './interpreter.js';
import { deployToZone, firstOpenSlot } from '../zones/zone-manager.js';
import { shuffle } from '../setup/rng.js';
import { registerCardTriggers } from '../events/trigger-registry.js';

const DEPLOY_ZONES: readonly ZoneType[] = ['frontline', 'reserve', 'high_ground'];

function setPlayer(state: GameState, playerId: 0 | 1, player: PlayerState): GameState {
  const players = [...state.players] as [PlayerState, PlayerState];
  players[playerId] = player;
  return { ...state, players };
}

/** BUG FIX (config.registerPrintedTriggers): a card entering the battlefield from
 * a pile registers its printed triggered abilities so dispatch can see them (see
 * GameConfig.registerPrintedTriggers). Absent/false ⇒ no-op. */
function maybeRegisterPrintedTriggers(state: GameState, cardInstanceId: string): GameState {
  return state.config?.registerPrintedTriggers === true
    ? registerCardTriggers(state, cardInstanceId)
    : state;
}

/** Reset a card pulled out of a pile so it enters play/hand with clean runtime state. */
function freshFromPile(
  card: CardInstance,
  summoningSick = true,
): CardInstance {
  return {
    ...card,
    currentHp: card.baseHp,
    currentAtk: card.baseAtk,
    currentArm: card.baseArm,
    exhausted: false,
    summoningSick,
    movedThisTurn: false,
    attackedThisTurn: false,
    hasActed: false,
    freeMovesRemaining: 0,
    reserveEnergyExhausted: false,
    transferredThisTurn: false,
    armMitigatedThisTurn: false,
    shieldMitigatedThisTurn: false,
    forcedAttacksThisTurn: 0,
    armConsumed: false,
    grantedTraits: [],
    modifiers: [],
    statusEffects: [],
    registeredTriggers: [],
    activeReplacements: [],
    equipment: null,
    xPaid: 0,
  };
}

// ── return_from_discard ────────────────────────────────────────────────────────

export function executeReturnFromDiscard(
  state: GameState,
  effect: Extract<Effect, { type: 'return_from_discard' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  const events: GameEvent[] = [];
  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = returnOne(currentState, targetId, effect.destination, events);
  }
  return { newState: currentState, events };
}

function returnOne(
  state: GameState,
  targetId: string,
  destination: 'hand' | 'battlefield',
  events: GameEvent[],
): GameState {
  for (let pi = 0; pi < 2; pi++) {
    const playerId = pi as 0 | 1;
    const player = state.players[playerId];
    const card = player.discardPile.find((c) => c.instanceId === targetId);
    if (card === undefined) continue;

    const discardPile = player.discardPile.filter((c) => c.instanceId !== targetId);
    if (destination === 'hand') {
      const next = setPlayer(state, playerId, {
        ...player,
        discardPile,
        hand: [...player.hand, freshFromPile(card)],
      });
      events.push({ type: 'CARD_DRAWN', playerId, count: 1 });
      return next;
    }
    const zone = DEPLOY_ZONES.find((z) => firstOpenSlot(player.zones, z) !== -1);
    if (zone === undefined) {
      // No legal slot — leave the card in discard.
      return state;
    }
    const zones = deployToZone(player.zones, freshFromPile(card), zone);
    events.push({
      type: 'CARD_DEPLOYED',
      cardInstanceId: card.instanceId,
      cardDefId: card.cardDefId,
      zone,
      playerId,
    });
    return maybeRegisterPrintedTriggers(
      setPlayer(state, playerId, { ...player, discardPile, zones }),
      card.instanceId,
    );
  }
  return state;
}

// ── search_deck ────────────────────────────────────────────────────────────────

export function executeSearchDeck(
  state: GameState,
  effect: Extract<Effect, { type: 'search_deck' }>,
  context: EffectContext,
): EffectResult {
  const playerId = context.controllerId;
  const player = state.players[playerId];
  const matches = applyFilter(player.mainDeck, effect.filter, context);
  const events: GameEvent[] = [];
  let currentState = state;
  let working = player;

  let deployedInstanceId: string | undefined;
  if (matches.length > 0) {
    const found = matches[0]!;
    const remaining = working.mainDeck.filter((c) => c.instanceId !== found.instanceId);
    if (effect.destination === 'hand') {
      working = { ...working, mainDeck: remaining, hand: [...working.hand, found] };
      events.push({ type: 'CARD_DRAWN', playerId, count: 1 });
    } else {
      const zone = DEPLOY_ZONES.find((z) => firstOpenSlot(working.zones, z) !== -1);
      if (zone !== undefined) {
        working = {
          ...working,
          mainDeck: remaining,
          zones: deployToZone(working.zones, freshFromPile(found), zone),
        };
        events.push({
          type: 'CARD_DEPLOYED',
          cardInstanceId: found.instanceId,
          cardDefId: found.cardDefId,
          zone,
          playerId,
        });
        deployedInstanceId = found.instanceId;
      }
    }
    currentState = setPlayer(currentState, playerId, working);
    if (deployedInstanceId !== undefined) {
      currentState = maybeRegisterPrintedTriggers(currentState, deployedInstanceId);
      // Refresh `working` from the registered state: the final setPlayer below spreads
      // `working`, so a stale copy would clobber `zones` and silently drop the
      // registration a tutored-to-battlefield card just received.
      working = currentState.players[playerId]!;
    }

    if (effect.destination === 'hand' && shouldCastFree(effect, found)) {
      const cast = castFoundForFree(currentState, found, playerId);
      currentState = cast.newState;
      events.push(...cast.events);
      working = currentState.players[playerId]!;
    }
  }

  const { result, nextRng } = shuffle(working.mainDeck, currentState.rng);
  currentState = setPlayer({ ...currentState, rng: nextRng }, playerId, {
    ...working,
    mainDeck: result,
  });
  return { newState: currentState, events };
}

/** Free-cast applies when the effect grants it unconditionally, or when the found
 * card's total cost is at or below the `castFreeIfCost` threshold. */
function shouldCastFree(
  effect: Extract<Effect, { type: 'search_deck' }>,
  found: CardInstance,
): boolean {
  if (effect.castForFree === true) return true;
  if (effect.castFreeIfCost === undefined) return false;
  const total = found.cost.mana + found.cost.energy + found.cost.flexible;
  return total <= effect.castFreeIfCost;
}

/**
 * Cast the just-searched spell for free: resolve its on-cast/triggered effects
 * (no resource payment) and move it from hand to the discard pile, since spells
 * are discarded after they resolve. Pure: returns the new state + events.
 */
function castFoundForFree(state: GameState, found: CardInstance, playerId: 0 | 1): EffectResult {
  const handAfter = state.players[playerId].hand.filter((c) => c.instanceId !== found.instanceId);
  const movedToDiscard = setPlayer(state, playerId, {
    ...state.players[playerId],
    hand: handAfter,
    discardPile: [...state.players[playerId].discardPile, found],
  });
  const events: GameEvent[] = [
    { type: 'SPELL_CAST', cardInstanceId: found.instanceId, cardDefId: found.cardDefId, playerId },
  ];
  let current = movedToDiscard;
  const castContext: EffectContext = {
    sourceInstanceId: found.instanceId,
    controllerId: playerId,
    triggerDepth: 0,
  };
  for (const eff of castSpellEffects(found)) {
    let result = executeEffect(current, eff, castContext);
    if (result.pendingChoice !== undefined) {
      const ids = result.pendingChoice.options
        .map((o) => o.instanceId ?? o.id)
        .filter((x): x is string => typeof x === 'string');
      // Honor the choice's real minimum: an optional target (up_to ⇒ minSelections 0)
      // must be allowed to resolve with NO target chosen, not forced to fire on a body
      // the player would decline. Capped at the number of legal options.
      const want = Math.min(ids.length, result.pendingChoice.minSelections);
      result = executeEffect(current, eff, { ...castContext, selectedTargets: ids.slice(0, want) });
    }
    current = result.newState;
    events.push(...result.events);
    if (current.winner !== null) break;
  }
  return { newState: current, events };
}

/** The effects a spell resolves when cast: its triggered (on_cast) effects. */
function castSpellEffects(card: CardInstance): readonly EffectNode[] {
  const out: EffectNode[] = [];
  for (const ab of card.abilities) {
    if (ab.type === 'triggered') out.push(...ab.effects);
  }
  return out;
}

// ── shuffle_into_deck ──────────────────────────────────────────────────────────

export function executeShuffleIntoDeck(
  state: GameState,
  effect: Extract<Effect, { type: 'shuffle_into_deck' }>,
  context: EffectContext,
): EffectResult {
  const playerId = context.controllerId;
  const player = state.players[playerId];
  const source = effect.source === 'discard' ? player.discardPile : player.hand;
  if (source.length === 0) return { newState: state, events: [] };

  // Cards in discard retain last-known battlefield state for recursion and
  // trigger inspection. Crossing back into the deck is a new-zone reset: a
  // later draw must not resurrect lethal damage, exhaustion, modifiers, or
  // once-per-turn markers from the destroyed instance.
  const combined = [
    ...player.mainDeck,
    ...source.map((card) => freshFromPile(card, false)),
  ];
  const { result, nextRng } = shuffle(combined, state.rng);
  const cleared =
    effect.source === 'discard'
      ? { ...player, discardPile: [], mainDeck: result }
      : { ...player, hand: [], mainDeck: result };
  return { newState: setPlayer({ ...state, rng: nextRng }, playerId, cleared), events: [] };
}

// ── cleanse ────────────────────────────────────────────────────────────────────

export function executeCleanse(
  state: GameState,
  effect: Extract<Effect, { type: 'cleanse' }>,
  context: EffectContext,
): EffectResult {
  const resolved = resolveTargets(state, effect.target, context);
  if (!resolved.resolved)
    return { newState: state, events: [], pendingChoice: resolved.pendingChoice };

  let currentState = state;
  for (const targetId of resolved.targetIds) {
    currentState = updateCardInState(currentState, targetId, (c) => ({
      ...c,
      statusEffects: [],
      modifiers: c.modifiers.filter((m) => !isNegative(m.modifier)),
    }));
  }
  return { newState: currentState, events: [] };
}

function isNegative(modifier: { atk?: number; hp?: number; arm?: number }): boolean {
  return (modifier.atk ?? 0) < 0 || (modifier.hp ?? 0) < 0 || (modifier.arm ?? 0) < 0;
}

// ── deploy_from_deck ───────────────────────────────────────────────────────────

export function executeDeployFromDeck(
  state: GameState,
  effect: Extract<Effect, { type: 'deploy_from_deck' }>,
  context: EffectContext,
): EffectResult {
  const playerId = context.controllerId;
  const player = state.players[playerId];
  const characters = player.mainDeck.filter((c) => c.cardType === 'C');
  const referenceCost = resolveReferenceCost(player, effect.filter);
  const matches = applyFilter(characters, effect.filter, context, referenceCost);
  if (matches.length === 0) return { newState: state, events: [] };

  const zone = DEPLOY_ZONES.find((z) => firstOpenSlot(player.zones, z) !== -1);
  if (zone === undefined) return { newState: state, events: [] };

  const found = matches[0]!;
  const remaining = player.mainDeck.filter((c) => c.instanceId !== found.instanceId);
  const zones = deployToZone(player.zones, freshFromPile(found), zone);
  const next = maybeRegisterPrintedTriggers(
    setPlayer(state, playerId, { ...player, mainDeck: remaining, zones }),
    found.instanceId,
  );
  return {
    newState: next,
    events: [
      {
        type: 'CARD_DEPLOYED',
        cardInstanceId: found.instanceId,
        cardDefId: found.cardDefId,
        zone,
        playerId,
      },
    ],
  };
}

/**
 * Resolve the reference cost for a `costRelativeTo` filter. For
 * `destroyed_card`, the card just destroyed by a preceding effect is the most
 * recently added non-token card in the controller's discard pile (e.g. Rampant
 * Evolution destroys an allied character immediately before deploying). Returns
 * undefined when there's no reference to resolve (the filter then no-ops).
 *
 * The 'cast_spell' reference is part of the type union but unwired by design
 * (YAGNI): no card data uses it on a deploy_from_deck filter, so it resolves to
 * undefined and the cost constraint no-ops. See discard-deck-handlers.test.ts.
 */
function resolveReferenceCost(
  player: PlayerState,
  filter: Extract<Effect, { type: 'deploy_from_deck' }>['filter'],
): number | undefined {
  if (filter.costRelativeTo?.reference !== 'destroyed_card') return undefined;
  const last = player.discardPile[player.discardPile.length - 1];
  if (last === undefined) return undefined;
  return last.cost.mana + last.cost.energy + last.cost.flexible;
}

// ── copy_card ──────────────────────────────────────────────────────────────────

export function executeCopyCard(
  state: GameState,
  effect: Extract<Effect, { type: 'copy_card' }>,
  context: EffectContext,
): EffectResult {
  const playerId = context.controllerId;
  const player = state.players[playerId];
  const pile = effect.source === 'discard' ? player.discardPile : player.mainDeck;
  const matches = applyFilter(pile, effect.filter, context);
  if (matches.length === 0) return { newState: state, events: [] };

  const original = matches[0]!;
  const copyId = state.rng.counter + 1;
  const copy: CardInstance = {
    ...freshFromPile(original),
    instanceId: `copy_${String(copyId)}`,
    isToken: true,
    owner: playerId,
  };
  const next = setPlayer({ ...state, rng: { ...state.rng, counter: copyId } }, playerId, {
    ...player,
    hand: [...player.hand, copy],
  });
  return { newState: next, events: [{ type: 'CARD_DRAWN', playerId, count: 1 }] };
}

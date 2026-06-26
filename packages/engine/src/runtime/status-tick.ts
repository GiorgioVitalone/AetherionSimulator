/**
 * Status-effect lifecycle — applied during a controller's Upkeep (Rulebook 16,
 * "Status Effects"). Regeneration heals, Persistent deals damage; both decrement
 * their value by 1 and are removed at 0. Slowed/Stunned count down their
 * `remainingTurns` and expire at 0. Statuses are removed when the card leaves the
 * battlefield (handled by the zone/destroy paths, not here).
 *
 * Aura-sourced statuses (`sourceAuraId` set) are continuous — they are rebuilt
 * every recompute and must NOT be ticked/decremented here.
 */
import type {
  GameState,
  CardInstance,
  GameEvent,
  ActiveStatus,
} from '../types/game-state.js';
import { removeCardFromState } from '../effects/state-helpers.js';
import { isExiledOnDestruction } from '../effects/destruction-destination.js';

export interface StatusTickResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

/** True if a card should skip its Upkeep refresh because it is Stunned. */
export function isStunned(card: CardInstance): boolean {
  return card.statusEffects.some(s => s.statusType === 'stunned');
}

/** True if a card cannot move because it is Slowed. */
export function isSlowed(card: CardInstance): boolean {
  return card.statusEffects.some(s => s.statusType === 'slowed');
}

/**
 * Consume one Stunned Upkeep: decrement `remainingTurns`, drop the status at 0.
 * A null duration (open-ended) counts as a single Upkeep and is removed. Called
 * from the refresh step, which keeps a Stunned card exhausted for this Upkeep.
 */
export function consumeStun(card: CardInstance): CardInstance {
  const statuses = decrementByType(card.statusEffects, 'stunned');
  return { ...card, statusEffects: statuses };
}

/**
 * Tick the active player's Regeneration / Persistent / Slowed statuses. Heals and
 * damage apply immediately; Persistent damage that drops a card to 0 HP destroys
 * it. Returns the new state plus the events produced.
 */
export function tickStatusEffects(state: GameState, playerIndex: 0 | 1): StatusTickResult {
  const cards = ownedCards(state, playerIndex);
  let currentState = state;
  const events: GameEvent[] = [];

  for (const card of cards) {
    const live = findCard(currentState, playerIndex, card.instanceId);
    if (live === null) continue;
    const stepped = stepCard(live);
    currentState = setCard(currentState, playerIndex, stepped.card);
    events.push(...stepped.events);
    if (stepped.destroyed) {
      events.push({
        type: 'CARD_DESTROYED',
        cardInstanceId: stepped.card.instanceId,
        cause: 'effect',
        playerId: stepped.card.owner,
      });
      if (!stepped.card.isToken && isExiledOnDestruction(stepped.card)) {
        events.push({ type: 'CARD_EXILED', cardInstanceId: stepped.card.instanceId, playerId: stepped.card.owner });
      }
      currentState = removeCardFromState(currentState, stepped.card.instanceId);
    }
  }
  return { state: currentState, events };
}

interface StepResult {
  readonly card: CardInstance;
  readonly events: readonly GameEvent[];
  readonly destroyed: boolean;
}

/** Apply Regeneration/Persistent/Slowed for one card; returns updated statuses. */
function stepCard(card: CardInstance): StepResult {
  const events: GameEvent[] = [];
  let hp = card.currentHp;
  const next: ActiveStatus[] = [];

  for (const status of card.statusEffects) {
    if (status.sourceAuraId !== undefined) {
      next.push(status); // continuous aura status — never ticked here
      continue;
    }
    switch (status.statusType) {
      case 'regeneration': {
        const healed = Math.min(status.value, card.baseHp - hp);
        if (healed > 0) {
          hp += healed;
          events.push({ type: 'CHARACTER_HEALED', cardInstanceId: card.instanceId, amount: healed });
        }
        pushDecremented(next, status);
        break;
      }
      case 'persistent': {
        if (status.value > 0) {
          hp -= status.value;
          events.push({ type: 'DAMAGE_DEALT', sourceId: card.instanceId, targetId: card.instanceId, amount: status.value });
        }
        pushDecremented(next, status);
        break;
      }
      case 'slowed':
      case 'stunned':
        pushTurnDecremented(next, status);
        break;
      case 'hexproof':
      case 'anti_redirect':
        next.push(status); // duration-less protective statuses; not ticked
        break;
    }
  }

  return {
    card: { ...card, currentHp: hp, statusEffects: next },
    events,
    destroyed: hp <= 0,
  };
}

/** Regen/Persistent: value -= 1, drop the status when it reaches 0. */
function pushDecremented(out: ActiveStatus[], status: ActiveStatus): void {
  const value = status.value - 1;
  if (value > 0) out.push({ ...status, value });
}

/** Slowed/Stunned: remainingTurns -= 1, drop at 0. null = single Upkeep. */
function pushTurnDecremented(out: ActiveStatus[], status: ActiveStatus): void {
  if (status.remainingTurns === null) return;
  const remaining = status.remainingTurns - 1;
  if (remaining > 0) out.push({ ...status, remainingTurns: remaining });
}

/** Decrement one status of `type` by an Upkeep; used by Stunned refresh handling. */
function decrementByType(
  statuses: readonly ActiveStatus[],
  type: ActiveStatus['statusType'],
): readonly ActiveStatus[] {
  const out: ActiveStatus[] = [];
  for (const status of statuses) {
    if (status.statusType !== type || status.sourceAuraId !== undefined) {
      out.push(status);
      continue;
    }
    pushTurnDecremented(out, status);
  }
  return out;
}

function ownedCards(state: GameState, playerIndex: 0 | 1): readonly CardInstance[] {
  const z = state.players[playerIndex].zones;
  return [...z.reserve, ...z.frontline, ...z.highGround].filter(
    (c): c is CardInstance => c !== null,
  );
}

function findCard(state: GameState, playerIndex: 0 | 1, id: string): CardInstance | null {
  const z = state.players[playerIndex].zones;
  for (const c of [...z.reserve, ...z.frontline, ...z.highGround]) {
    if (c !== null && c.instanceId === id) return c;
  }
  return null;
}

function setCard(state: GameState, playerIndex: 0 | 1, card: CardInstance): GameState {
  const player = state.players[playerIndex];
  const map = (c: CardInstance | null): CardInstance | null =>
    c !== null && c.instanceId === card.instanceId ? card : c;
  const newPlayers = [...state.players] as [GameState['players'][0], GameState['players'][1]];
  newPlayers[playerIndex] = {
    ...player,
    zones: {
      reserve: player.zones.reserve.map(map),
      frontline: player.zones.frontline.map(map),
      highGround: player.zones.highGround.map(map),
    },
  };
  return { ...state, players: newPlayers };
}

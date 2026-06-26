/**
 * Dispatch rate-limit gating — enforce wrapper oncePerTurn / cooldown on
 * NON-activated (dispatch) triggered abilities (Rulebook 16, "once per turn" /
 * "Cooldown N"). Activated abilities are gated separately in available-actions;
 * this module is the dispatch-side equivalent, reading the trigger's TRIGGER_FIRED
 * markers from the event log (which persists across turns and across player actions
 * within a turn). Within a single dispatch chain the markers are appended to the
 * working state's log by the dispatcher so the same trigger cannot re-fire.
 */
import type { GameState, RegisteredTrigger } from '../types/game-state.js';

/** True if a oncePerTurn/cooldown trigger is currently rate-limited and must not
 * fire for this event. Plain triggers (no limits) always return false. */
export function triggerRateLimited(
  state: GameState,
  trigger: RegisteredTrigger,
): boolean {
  if (trigger.oncePerTurn === true && firedThisTurn(state, trigger.id)) return true;
  if (trigger.cooldown !== undefined && trigger.cooldown > 0) {
    return onCooldown(state, trigger.id, trigger.cooldown, trigger.ownerPlayerId);
  }
  return false;
}

/** Whether the trigger fired since the most recent TURN_START in the log. */
function firedThisTurn(state: GameState, triggerId: string): boolean {
  let turnStart = 0;
  for (let i = state.log.length - 1; i >= 0; i--) {
    if (state.log[i]!.type === 'TURN_START') {
      turnStart = i;
      break;
    }
  }
  for (let i = turnStart; i < state.log.length; i++) {
    const e = state.log[i]!;
    if (e.type === 'TRIGGER_FIRED' && e.triggerId === triggerId) return true;
  }
  return false;
}

/** Cooldown N: after the last fire, the trigger stays unusable until N of the
 * owner's turns have started. Mirrors the activated-ability cooldown rule. */
function onCooldown(
  state: GameState,
  triggerId: string,
  cooldown: number,
  ownerPlayerId: 0 | 1,
): boolean {
  let lastFireIdx = -1;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!;
    if (e.type === 'TRIGGER_FIRED' && e.triggerId === triggerId) {
      lastFireIdx = i;
      break;
    }
  }
  if (lastFireIdx === -1) return false;

  let ownTurns = 0;
  for (let i = lastFireIdx + 1; i < state.log.length; i++) {
    const e = state.log[i]!;
    if (e.type === 'TURN_START' && e.playerId === ownerPlayerId) ownTurns++;
  }
  return ownTurns < cooldown;
}

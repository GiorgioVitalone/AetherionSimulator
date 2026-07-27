import type { GameState } from '../types/game-state.js';
import type { PlayerAction } from '../state-machine/types.js';
import {
  computeAvailableActions,
  computeReactiveActions,
  type AvailableActions,
} from '../actions/index.js';
import type { RuleViolation } from './types.js';

function violation(
  code: RuleViolation['code'],
  path: string,
  message: string,
): RuleViolation {
  return { code, path, message };
}

function xValueViolation(action: PlayerAction): RuleViolation | null {
  if (!('xValue' in action) || action.xValue === undefined) return null;
  return Number.isSafeInteger(action.xValue) && action.xValue >= 0
    ? null
    : violation('cost', 'action.xValue', 'X must be a non-negative safe integer');
}

function targetListViolation(action: PlayerAction): RuleViolation | null {
  if (action.type !== 'cast_spell' || action.selectedTargetIds === undefined) return null;
  const targets = action.selectedTargetIds;
  if (
    targets.some((id) => typeof id !== 'string' || id.length === 0) ||
    new Set(targets).size !== targets.length
  ) {
    return violation(
      'target',
      'action.selectedTargetIds',
      'Selected targets must be unique, non-empty instance IDs',
    );
  }
  return null;
}

function proactiveMatch(
  state: GameState,
  action: PlayerAction,
  available: AvailableActions,
): boolean {
  switch (action.type) {
    case 'deploy':
      return available.canDeploy.some(
        (option) =>
          option.cardInstanceId === action.cardInstanceId &&
          xMatches(action.xValue, option.xValues) &&
          option.validSlots.some(
            (group) => group.zone === action.zone && group.slots.includes(action.slotIndex),
          ),
      );
    case 'cast_spell':
      return available.canCastSpell.some(
        (option) =>
          option.cardInstanceId === action.cardInstanceId &&
          xMatches(action.xValue, option.xValues),
      );
    case 'attach_equipment':
      return available.canAttachEquipment.some(
        (option) =>
          option.cardInstanceId === action.cardInstanceId &&
          xMatches(action.xValue, option.xValues) &&
          option.validTargets.includes(action.targetInstanceId),
      );
    case 'remove_equipment':
      return available.canRemoveEquipment.some(
        (option) => option.equipmentInstanceId === action.equipmentInstanceId,
      );
    case 'transfer_equipment':
      return available.canTransferEquipment.some(
        (option) =>
          option.equipmentInstanceId === action.equipmentInstanceId &&
          option.validTargets.includes(action.targetInstanceId),
      );
    case 'move':
      return available.canMove.some(
        (option) =>
          option.cardInstanceId === action.cardInstanceId &&
          option.validDestinations.includes(action.toZone),
      );
    case 'activate_ability':
      return available.canActivateAbility.some(
        (option) =>
          option.cardInstanceId === action.cardInstanceId &&
          option.abilityIndex === action.abilityIndex &&
          xMatches(action.xValue, option.xValues),
      );
    case 'declare_attack':
      return available.canAttack.some(
        (option) =>
          option.attackerInstanceId === action.attackerInstanceId &&
          option.validTargets.some((target) =>
            target.type === 'hero'
              ? action.targetId === 'hero'
              : target.instanceId === action.targetId,
          ),
      );
    case 'discard_for_energy':
      return (
        available.canDiscardForEnergy &&
        state.players[state.activePlayerIndex].hand.some(
          (card) => card.instanceId === action.cardInstanceId,
        )
      );
    case 'declare_transform':
      return available.canTransform;
    case 'tap_reserve':
      return available.canTapReserve.includes(action.cardInstanceId);
  }
}

function xMatches(
  submitted: number | undefined,
  legal: readonly number[] | undefined,
): boolean {
  return submitted === undefined
    ? legal === undefined || legal.includes(0)
    : legal?.includes(submitted) === true;
}

function explainProactiveMismatch(state: GameState, action: PlayerAction): RuleViolation {
  const actionPhaseAction = action.type === 'declare_attack';
  const expectedPhase =
    actionPhaseAction
      ? 'action'
      : action.type === 'cast_spell' && state.config?.flashAtWill === true
        ? 'strategy or an allowed Flash window'
        : 'strategy';
  if (
    (actionPhaseAction && state.phase !== 'action') ||
    (!actionPhaseAction &&
      action.type !== 'cast_spell' &&
      state.phase !== 'strategy' &&
      !(action.type === 'declare_transform' && state.phase === 'upkeep')) ||
    (action.type === 'cast_spell' && state.phase !== 'strategy' && state.phase !== 'action')
  ) {
    return violation(
      'phase',
      'state.phase',
      `${action.type} is not legal during ${state.phase}; expected ${expectedPhase}`,
    );
  }

  const player = state.players[state.activePlayerIndex];
  const handId =
    'cardInstanceId' in action
      ? action.cardInstanceId
      : action.type === 'declare_attack'
        ? action.attackerInstanceId
        : null;
  if (
    handId !== null &&
    ['deploy', 'cast_spell', 'attach_equipment', 'discard_for_energy'].includes(action.type) &&
    !player.hand.some((card) => card.instanceId === handId)
  ) {
    return violation(
      'source_zone',
      'action.cardInstanceId',
      'The source is not in the active player’s hand',
    );
  }

  if (action.type === 'deploy' || action.type === 'cast_spell' || action.type === 'attach_equipment') {
    const card = player.hand.find((candidate) => candidate.instanceId === action.cardInstanceId);
    const expected = action.type === 'deploy' ? 'C' : action.type === 'cast_spell' ? 'S' : 'E';
    if (card !== undefined && card.cardType !== expected) {
      return violation(
        'card_kind',
        'action.cardInstanceId',
        `${action.type} requires card type ${expected}, received ${card.cardType}`,
      );
    }
  }

  if (action.type === 'declare_transform') {
    return violation(
      'transformation',
      'action',
      'The active Hero does not satisfy every transformation predicate',
    );
  }
  if (
    action.type === 'attach_equipment' ||
    action.type === 'transfer_equipment' ||
    action.type === 'declare_attack'
  ) {
    return violation('target', 'action', 'The submitted target is not legal');
  }
  if (action.type === 'activate_ability') {
    return violation(
      'timing',
      'action.abilityIndex',
      'The ability is absent, not activated, exhausted, limited, on cooldown, or unaffordable',
    );
  }
  if (action.type === 'move' || action.type === 'tap_reserve') {
    return violation(
      'readiness',
      'action.cardInstanceId',
      'The source cannot take this action or the destination is illegal',
    );
  }
  return violation('not_legal', 'action', 'The action is not in the authoritative legal set');
}

export function validatePlayerAction(
  state: GameState,
  action: PlayerAction,
): readonly RuleViolation[] {
  if (state.winner !== null || state.phase === 'game_over') {
    return [violation('game_over', 'state.winner', 'No action is legal after game end')];
  }
  if (state.pendingPriority != null) {
    return [
      violation(
        'priority',
        'state.pendingPriority',
        'Use a reactive action or priority pass for the open response window',
      ),
    ];
  }
  if (state.pendingChoice !== null) {
    return [
      violation(
        'choice',
        'state.pendingChoice',
        'Resolve the pending interaction before submitting another action',
      ),
    ];
  }
  const xViolation = xValueViolation(action);
  if (xViolation !== null) return [xViolation];
  const targetsViolation = targetListViolation(action);
  if (targetsViolation !== null) return [targetsViolation];

  const available = computeAvailableActions(state);
  return proactiveMatch(state, action, available)
    ? []
    : [explainProactiveMismatch(state, action)];
}

export function validateReactiveAction(
  state: GameState,
  windowId: string,
  action: PlayerAction,
): readonly RuleViolation[] {
  const pending = state.pendingPriority;
  if (pending == null) {
    return [violation('stale_window', 'windowId', 'No response window is open')];
  }
  if (pending.baseStackItemId !== windowId) {
    return [
      violation(
        'stale_window',
        'windowId',
        `Expected current window ${pending.baseStackItemId}`,
      ),
    ];
  }
  const xViolation = xValueViolation(action);
  if (xViolation !== null) return [xViolation];
  const targetViolation = targetListViolation(action);
  if (targetViolation !== null) return [targetViolation];

  const options = computeReactiveActions(state, pending.toRespondPlayerId);
  const matches =
    action.type === 'cast_spell'
      ? options.some(
          (option) =>
            option.source !== 'board' &&
            option.cardInstanceId === action.cardInstanceId &&
            xMatches(action.xValue, option.xValues),
        )
      : action.type === 'activate_ability'
        ? options.some(
            (option) =>
              option.source === 'board' &&
              option.cardInstanceId === action.cardInstanceId &&
              option.abilityIndex === action.abilityIndex &&
              xMatches(action.xValue, option.xValues),
          )
        : false;
  return matches
    ? []
    : [
        violation(
          'not_legal',
          'action',
          'The reactive action is not offered to the current priority holder',
        ),
      ];
}

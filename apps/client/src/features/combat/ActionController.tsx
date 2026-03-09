/**
 * ActionController — headless component that orchestrates multi-step interactions.
 *
 * Subscribes to the action-flow-store and dispatches completed actions to game-store.
 * Handles the card_selected → awaiting_zone/target → dispatch lifecycle.
 */
import { useCallback } from 'react';
import type { ZoneType } from '@aetherion-sim/engine';
import { useGameStore } from '@/stores/game-store';
import { useActionFlowStore } from '@/stores/action-flow-store';
import type { ActionIntent } from '@/stores/action-flow-store';
import { useUiStore } from '@/stores/ui-store';

export function useActionController() {
  const dispatch = useGameStore((s) => s.dispatch);
  const availableActions = useGameStore((s) => s.availableActions);
  const flowState = useActionFlowStore((s) => s.flowState);
  const selectCardFromHand = useActionFlowStore((s) => s.selectCardFromHand);
  const selectBattlefieldCard = useActionFlowStore((s) => s.selectBattlefieldCard);
  const setAwaitingZone = useActionFlowStore((s) => s.setAwaitingZone);
  const setAwaitingTarget = useActionFlowStore((s) => s.setAwaitingTarget);
  const cancel = useActionFlowStore((s) => s.cancel);
  const reset = useActionFlowStore((s) => s.reset);
  const selectCard = useUiStore((s) => s.selectCard);

  // When a hand card is clicked
  const handleHandCardClick = useCallback(
    (instanceId: string) => {
      if (!availableActions) return;
      if (flowState.step === 'awaiting_zone') return;

      // If clicking the already-selected card, cancel
      if (flowState.step === 'card_selected' && flowState.cardInstanceId === instanceId) {
        cancel();
        selectCard(null);
        return;
      }

      // Determine what actions are possible for this card
      const possibleActions: ActionIntent[] = [];

      const deployOption = availableActions.canDeploy.find((d) => d.cardInstanceId === instanceId);
      if (deployOption) possibleActions.push('deploy');

      if (availableActions.canCastSpell.some((s) => s.cardInstanceId === instanceId)) {
        possibleActions.push('cast_spell');
      }

      const equipOption = availableActions.canAttachEquipment.find((e) => e.cardInstanceId === instanceId);
      if (equipOption) possibleActions.push('attach_equipment');

      if (availableActions.canDiscardForEnergy) {
        possibleActions.push('discard_for_energy');
      }

      if (possibleActions.length === 0) return;

      selectCard(instanceId);

      // If only one action and it needs a zone, skip to awaiting_zone
      if (possibleActions.length === 1 && possibleActions[0] === 'deploy' && deployOption) {
        const validSlots = deployOption.validSlots.flatMap((vs) =>
          vs.slots.map((slotIndex) => ({ zone: vs.zone, slotIndex })),
        );
        setAwaitingZone(instanceId, 'deploy', validSlots);
        return;
      }

      // If only one action and it's instant (cast_spell) or needs a target (equipment)
      if (possibleActions.length === 1) {
        const action = possibleActions[0]!;
        if (action === 'cast_spell') {
          const spellOption = availableActions.canCastSpell.find(s => s.cardInstanceId === instanceId);
          if (spellOption?.needsTarget && spellOption.validTargets.length > 0) {
            setAwaitingTarget(instanceId, 'cast_spell', [...spellOption.validTargets]);
            return;
          }
          dispatch({ type: 'cast_spell', cardInstanceId: instanceId });
          reset();
          selectCard(null);
          return;
        }
        if (action === 'attach_equipment' && equipOption) {
          setAwaitingTarget(instanceId, 'attach_equipment', equipOption.validTargets);
          return;
        }
        // Never auto-resolve discard_for_energy — always show ActionBar
        // so the player must explicitly confirm a destructive action
      }

      // Multiple actions: show action bar
      selectCardFromHand(instanceId, possibleActions);
    },
    [availableActions, flowState, dispatch, cancel, reset, selectCard, selectCardFromHand, setAwaitingZone, setAwaitingTarget],
  );

  // When a battlefield card is clicked
  const handleBattlefieldCardClick = useCallback(
    (instanceId: string) => {
      if (!availableActions) return;
      if (flowState.step === 'awaiting_zone') return;

      // If awaiting a target, check if this card is a valid target
      if (flowState.step === 'awaiting_target') {
        if (flowState.validTargets.includes(instanceId)) {
          const sourceId = flowState.cardInstanceId;
          const actionType = flowState.actionType;

          if (actionType === 'attack') {
            dispatch({ type: 'declare_attack', attackerInstanceId: sourceId, targetId: instanceId });
          } else if (actionType === 'attach_equipment') {
            dispatch({ type: 'attach_equipment', cardInstanceId: sourceId, targetInstanceId: instanceId });
          } else if (actionType === 'cast_spell') {
            dispatch({ type: 'cast_spell', cardInstanceId: sourceId, targetId: instanceId });
          }
          reset();
          selectCard(null);
          return;
        }
      }

      // Select this battlefield card for actions
      const possibleActions: ActionIntent[] = [];

      const moveOption = availableActions.canMove.find((m) => m.cardInstanceId === instanceId);
      if (moveOption) possibleActions.push('move');

      const attackOption = availableActions.canAttack.find((a) => a.attackerInstanceId === instanceId);
      if (attackOption) possibleActions.push('attack');

      if (availableActions.canActivateAbility.some((a) => a.cardInstanceId === instanceId)) {
        possibleActions.push('activate_ability');
      }

      if (possibleActions.length === 0) return;

      selectCard(instanceId);

      // Auto-resolve single actions
      if (possibleActions.length === 1) {
        const action = possibleActions[0]!;
        if (action === 'move' && moveOption) {
          setAwaitingZone(instanceId, 'move', moveOption.validSlots);
          return;
        }
        if (action === 'attack' && attackOption) {
          const targets = attackOption.validTargets.map((t) => t.instanceId ?? 'hero');
          // Auto-resolve if hero is the only valid target
          if (targets.length === 1 && targets[0] === 'hero') {
            dispatch({ type: 'declare_attack', attackerInstanceId: instanceId, targetId: 'hero' });
            reset();
            selectCard(null);
            return;
          }
          setAwaitingTarget(instanceId, 'attack', targets);
          return;
        }
        if (action === 'activate_ability') {
          const activateOption = availableActions.canActivateAbility.find(
            (a) => a.cardInstanceId === instanceId,
          );
          if (!activateOption) return;
          dispatch({
            type: 'activate_ability',
            cardInstanceId: instanceId,
            abilityIndex: activateOption.abilityIndex,
          });
          reset();
          selectCard(null);
          return;
        }
      }

      selectBattlefieldCard(instanceId, possibleActions);
    },
    [availableActions, flowState, dispatch, reset, selectCard, selectBattlefieldCard, setAwaitingZone, setAwaitingTarget],
  );

  // When a zone slot is clicked (for deployment or movement)
  const handleSlotClick = useCallback(
    (zone: ZoneType, slotIndex: number) => {
      if (flowState.step !== 'awaiting_zone') return;
      const isValidSlot = flowState.validSlots.some(
        (slot) => slot.zone === zone && slot.slotIndex === slotIndex,
      );
      if (!isValidSlot) return;

      const instanceId = flowState.cardInstanceId;
      const actionType = flowState.actionType;

      if (actionType === 'deploy') {
        dispatch({ type: 'deploy_character', cardInstanceId: instanceId, zone, slotIndex });
      } else if (actionType === 'move') {
        dispatch({
          type: 'move_character',
          cardInstanceId: instanceId,
          toZone: zone,
          slotIndex,
        });
      }
      reset();
      selectCard(null);
    },
    [flowState, dispatch, reset, selectCard],
  );

  // Choose an action from the action bar (when multiple are available)
  const handleChooseAction = useCallback(
    (action: ActionIntent) => {
      if (flowState.step !== 'card_selected') return;
      if (!availableActions) return;

      const instanceId = flowState.cardInstanceId;

      switch (action) {
        case 'deploy': {
          const option = availableActions.canDeploy.find((d) => d.cardInstanceId === instanceId);
          if (option) {
            const validSlots = option.validSlots.flatMap((vs) =>
              vs.slots.map((s) => ({ zone: vs.zone, slotIndex: s })),
            );
            setAwaitingZone(instanceId, 'deploy', validSlots);
          }
          break;
        }
        case 'cast_spell': {
          const spellOpt = availableActions.canCastSpell.find(s => s.cardInstanceId === instanceId);
          if (spellOpt?.needsTarget && spellOpt.validTargets.length > 0) {
            setAwaitingTarget(instanceId, 'cast_spell', [...spellOpt.validTargets]);
          } else {
            dispatch({ type: 'cast_spell', cardInstanceId: instanceId });
            reset();
            selectCard(null);
          }
          break;
        }
        case 'attach_equipment': {
          const option = availableActions.canAttachEquipment.find((e) => e.cardInstanceId === instanceId);
          if (option) {
            setAwaitingTarget(instanceId, 'attach_equipment', option.validTargets);
          }
          break;
        }
        case 'move': {
          const option = availableActions.canMove.find((m) => m.cardInstanceId === instanceId);
          if (option) {
            setAwaitingZone(instanceId, 'move', option.validSlots);
          }
          break;
        }
        case 'activate_ability': {
          const option = availableActions.canActivateAbility.find(
            (a) => a.cardInstanceId === instanceId,
          );
          if (option) {
            dispatch({
              type: 'activate_ability',
              cardInstanceId: instanceId,
              abilityIndex: option.abilityIndex,
            });
            reset();
            selectCard(null);
          }
          break;
        }
        case 'attack': {
          const option = availableActions.canAttack.find((a) => a.attackerInstanceId === instanceId);
          if (option) {
            const targets = option.validTargets.map((t) => t.instanceId ?? 'hero');
            // Auto-resolve if hero is the only valid target
            if (targets.length === 1 && targets[0] === 'hero') {
              dispatch({ type: 'declare_attack', attackerInstanceId: instanceId, targetId: 'hero' });
              reset();
              selectCard(null);
              break;
            }
            setAwaitingTarget(instanceId, 'attack', targets);
          }
          break;
        }
        case 'discard_for_energy':
          dispatch({ type: 'discard_for_energy', cardInstanceId: instanceId });
          reset();
          selectCard(null);
          break;
      }
    },
    [flowState, availableActions, dispatch, reset, selectCard, setAwaitingZone, setAwaitingTarget],
  );

  return {
    handleHandCardClick,
    handleBattlefieldCardClick,
    handleSlotClick,
    handleChooseAction,
    cancel: () => { cancel(); selectCard(null); },
  };
}

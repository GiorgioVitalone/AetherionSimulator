/**
 * GameScreen — top-level game container that composes all game UI elements.
 * Layout: OpponentPanel → BattlefieldArea → ActionBar → PlayerPanel → HandRow
 * Plus overlays: PendingChoice, TurnHandoff, GameOver, GameLog
 */
import { type ReactNode, useCallback, useMemo } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
import { useActionFlowStore } from '@/stores/action-flow-store';
import { useViewingPlayer } from '@/hooks/useViewingPlayer';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { useViewingPlayerSync } from '@/hooks/useViewingPlayerSync';
import { useGameStateWatcher } from '@/hooks/useGameStateWatcher';
import { useAnimationPlayer } from '@/hooks/useAnimationPlayer';
import { useActionController } from '@/features/combat/ActionController';
import { OpponentPanel } from './OpponentPanel';
import { PlayerPanel } from './PlayerPanel';
import { BattlefieldArea } from '@/features/battlefield/BattlefieldArea';
import { HandRow } from '@/features/hand/HandRow';
import { ActionBar } from '@/features/combat/ActionBar';
import { PendingChoiceModal } from '@/features/pending-choice/PendingChoiceModal';
import { TurnHandoffOverlay } from '@/features/turn-handoff/TurnHandoffOverlay';
import { GameOverOverlay } from '@/features/game-over/GameOverOverlay';
import { GameLog } from '@/features/game-log/GameLog';
import { TargetOverlay } from '@/features/combat/TargetOverlay';
import { ErrorBoundary } from '@/features/shared/ErrorBoundary';
import { CardDetailModal } from '@/features/shared/CardDetailModal';
import { getHeroTargetTokenForPlayer, HERO_ATTACK_TARGET } from '@/features/combat/target-tokens';

export function GameScreen(): ReactNode {
  const state = useGameStore((s) => s.state);
  const pendingChoice = useGameStore((s) => s.pendingChoice);
  const reset = useGameStore((s) => s._reset);
  const phase = state?.phase ?? 'setup';
  const turnNumber = state?.turnNumber ?? 0;

  const { myState, opponentState, isMyTurn, viewingPlayer } = useViewingPlayer();
  const controller = useActionController();
  const dispatch = useGameStore((s) => s.dispatch);
  const flowState = useActionFlowStore((s) => s.flowState);
  const flowReset = useActionFlowStore((s) => s.reset);
  const selectCard = useUiStore((s) => s.selectCard);
  const hoveredCardId = useUiStore((s) => s.hoveredCardId);
  const hoverCard = useUiStore((s) => s.hoverCard);

  // Find hovered card across all locations in both players
  const hoveredCard = useMemo(() => {
    if (!hoveredCardId || !state) return null;
    for (const p of state.players) {
      const inHand = p.hand.find(c => c.instanceId === hoveredCardId);
      if (inHand) return inHand;
      for (const zone of [p.zones.reserve, p.zones.frontline, p.zones.highGround]) {
        const inZone = zone.find(c => c?.instanceId === hoveredCardId);
        if (inZone) return inZone;
      }
    }
    return null;
  }, [hoveredCardId, state]);

  const opponentPlayerId = viewingPlayer === 0 ? 1 : 0;
  const myHeroTargetToken = flowState.step === 'awaiting_target'
    ? getHeroTargetTokenForPlayer(flowState.validTargets, viewingPlayer)
    : null;
  const opponentHeroTargetToken = flowState.step === 'awaiting_target'
    ? getHeroTargetTokenForPlayer(flowState.validTargets, opponentPlayerId) ??
      (flowState.validTargets.includes(HERO_ATTACK_TARGET) ? `hero_${String(opponentPlayerId)}` : null)
    : null;

  const handleHeroClick = useCallback((targetId: string) => {
    if (flowState.step !== 'awaiting_target') return;
    const sourceId = flowState.cardInstanceId;
    const actionType = flowState.actionType;
    if (actionType === 'attack') {
      dispatch({ type: 'declare_attack', attackerInstanceId: sourceId, targetId: HERO_ATTACK_TARGET });
    } else if (actionType === 'cast_spell') {
      dispatch({ type: 'cast_spell', cardInstanceId: sourceId, targetId });
    }
    flowReset();
    selectCard(null);
  }, [flowState, dispatch, flowReset, selectCard]);

  useKeyboardShortcuts();
  useViewingPlayerSync();
  useGameStateWatcher();
  useAnimationPlayer();

  if (!state || !myState || !opponentState) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-[var(--color-text-secondary)] font-body">Loading game...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary onReset={reset}>
      <div className="h-screen min-w-[1280px] flex flex-col bg-[var(--color-bg)] overflow-hidden">
        {/* Opponent panel (top) */}
        <OpponentPanel
          player={opponentState}
          playerIndex={opponentPlayerId as 0 | 1}
          heroHighlighted={opponentHeroTargetToken !== null}
          onHeroClick={opponentHeroTargetToken !== null
            ? () => handleHeroClick(opponentHeroTargetToken)
            : undefined}
        />

        {/* Battlefield (middle, fills available space) */}
        <BattlefieldArea
          onSlotClick={controller.handleSlotClick}
          onCardClick={controller.handleBattlefieldCardClick}
        />

        {/* Action bar (conditional, between battlefield and player panel) */}
        <ActionBar onChoose={controller.handleChooseAction} onCancel={controller.cancel} onXValueSelected={controller.handleXValueSelected} />

        {/* Player panel */}
        <PlayerPanel
          player={myState}
          phase={phase}
          turnNumber={turnNumber}
          isMyTurn={isMyTurn}
          heroHighlighted={myHeroTargetToken !== null}
          onHeroClick={myHeroTargetToken !== null
            ? () => handleHeroClick(myHeroTargetToken)
            : undefined}
          playerIndex={viewingPlayer}
        />

        {/* Hand row (bottom) */}
        <HandRow
          cards={myState.hand}
          onCardClick={controller.handleHandCardClick}
        />

        {/* Overlays */}
        {pendingChoice && <PendingChoiceModal choice={pendingChoice} />}
        <TargetOverlay onCancel={controller.cancel} />
        <TurnHandoffOverlay />
        <GameOverOverlay />
        <GameLog />
        {hoveredCard && (
          <CardDetailModal card={hoveredCard} onClose={() => hoverCard(null)} />
        )}
      </div>
    </ErrorBoundary>
  );
}

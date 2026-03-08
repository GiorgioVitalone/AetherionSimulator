/**
 * GameScreen — top-level game container that composes all game UI elements.
 * Layout: OpponentPanel → BattlefieldArea → ActionBar → PlayerPanel → HandRow
 * Plus overlays: PendingChoice, TurnHandoff, GameOver, GameLog
 */
import { type ReactNode, useMemo } from 'react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
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

export function GameScreen(): ReactNode {
  const state = useGameStore((s) => s.state);
  const pendingChoice = useGameStore((s) => s.pendingChoice);
  const reset = useGameStore((s) => s._reset);
  const phase = state?.phase ?? 'setup';
  const turnNumber = state?.turnNumber ?? 0;

  const { myState, opponentState, isMyTurn } = useViewingPlayer();
  const controller = useActionController();
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
      <div className="min-h-screen min-w-[1280px] flex flex-col bg-[var(--color-bg)]">
        {/* Opponent panel (top) */}
        <OpponentPanel player={opponentState} />

        {/* Battlefield (middle, fills available space) */}
        <BattlefieldArea
          onSlotClick={controller.handleSlotClick}
          onCardClick={controller.handleBattlefieldCardClick}
        />

        {/* Action bar (conditional, between battlefield and player panel) */}
        <ActionBar onChoose={controller.handleChooseAction} onCancel={controller.cancel} />

        {/* Player panel */}
        <PlayerPanel
          player={myState}
          phase={phase}
          turnNumber={turnNumber}
          isMyTurn={isMyTurn}
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

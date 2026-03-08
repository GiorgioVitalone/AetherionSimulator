/**
 * PlayerPanel — the viewing player's hero, resources, and phase indicator.
 * Interactive: shows transform button, end phase button.
 */
import type { ReactNode } from 'react';
import type { PlayerState, GamePhase } from '@aetherion-sim/engine';
import { getFaction } from '@aetherion-sim/ui';
import { HeroPanel } from '@/features/hero/HeroPanel';
import { ResourceBank } from '@/features/hero/ResourceBank';
import { PhaseIndicator } from '@/features/hero/PhaseIndicator';
import { useGameStore } from '@/stores/game-store';

interface PlayerPanelProps {
  readonly player: PlayerState;
  readonly phase: GamePhase;
  readonly turnNumber: number;
  readonly isMyTurn: boolean;
}

export function PlayerPanel({
  player,
  phase,
  turnNumber,
  isMyTurn,
}: PlayerPanelProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const canTransform = useGameStore((s) => s.availableActions?.canTransform ?? false);

  // Infer faction from the first card in hand or deck
  const sampleCard = player.hand[0] ?? player.mainDeck[0];
  const faction = sampleCard ? getFaction(sampleCard.alignment) : 'none';

  return (
    <div
      className="flex items-start gap-4 px-4 py-3 border-t border-[var(--color-border)]"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Hero panel */}
      <div className="w-64 shrink-0">
        <HeroPanel
          hero={player.hero}
          faction={faction}
          isMyTurn={isMyTurn}
          canTransform={isMyTurn && canTransform}
          onTransform={() => dispatch({ type: 'declare_transformation' })}
        />
      </div>

      {/* Resources + Phase */}
      <div className="flex-1 flex flex-col gap-2 justify-center">
        <ResourceBank resources={player.resourceBank} temporaryResources={player.temporaryResources} />
        <PhaseIndicator
          phase={phase}
          turnNumber={turnNumber}
          isMyTurn={isMyTurn}
        />
      </div>
    </div>
  );
}

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
  readonly onHeroClick?: () => void;
  readonly heroHighlighted?: boolean;
  readonly playerIndex: 0 | 1;
}

export function PlayerPanel({
  player,
  phase,
  turnNumber,
  isMyTurn,
  onHeroClick,
  heroHighlighted,
  playerIndex,
}: PlayerPanelProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const canTransform = useGameStore((s) => s.availableActions?.canTransform ?? false);

  // Infer faction from the first card in hand or deck
  const sampleCard = player.hand[0] ?? player.mainDeck[0];
  const faction = sampleCard ? getFaction(sampleCard.alignment) : 'none';

  return (
    <div
      className="flex items-start gap-4 px-4 py-2 border-t border-[var(--color-border)]"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Hero panel */}
      <div
        className={`w-64 shrink-0 ${heroHighlighted ? 'cursor-pointer ring-2 ring-[var(--color-error)] rounded-[var(--radius-lg)]' : ''}`}
        onClick={heroHighlighted ? onHeroClick : undefined}
      >
        <HeroPanel
          hero={player.hero}
          faction={faction}
          isMyTurn={isMyTurn}
          canTransform={isMyTurn && canTransform}
          onTransform={() => dispatch({ type: 'declare_transformation' })}
          playerIndex={playerIndex}
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

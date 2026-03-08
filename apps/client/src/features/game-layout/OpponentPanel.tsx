/**
 * OpponentPanel — compact display of the opponent's hero, resources, and hand count.
 * No interactivity — the opponent's state is read-only from the viewing player's perspective.
 */
import type { ReactNode } from 'react';
import type { PlayerState } from '@aetherion-sim/engine';
import { LpBar, CardBack } from '@aetherion-sim/ui';
import { ResourceBank } from '@/features/hero/ResourceBank';

interface OpponentPanelProps {
  readonly player: PlayerState;
  readonly onHeroClick?: () => void;
  readonly heroHighlighted?: boolean;
}

export function OpponentPanel({ player, onHeroClick, heroHighlighted }: OpponentPanelProps): ReactNode {
  const hero = player.hero;
  // Hero doesn't have alignment directly — infer from cards or use name-based lookup
  // For now, use 'none' and let data-faction style it
  const handCount = player.hand.length;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--color-border)]"
      style={{ backgroundColor: 'var(--color-surface)' }}
    >
      {/* Hero summary — clickable when highlighted as a valid attack/spell target */}
      <div
        className={`flex-1 min-w-0 ${heroHighlighted ? 'cursor-pointer ring-2 ring-[var(--color-error)] rounded-md p-1 -m-1' : ''}`}
        onClick={heroHighlighted ? onHeroClick : undefined}
      >
        <div className="flex items-center gap-2 mb-1">
          <h3 className="text-sm font-bold truncate" style={{ fontFamily: 'var(--font-display)' }}>
            {hero.name}
          </h3>
          {hero.transformed && (
            <span className="text-[7px] uppercase tracking-widest font-semibold text-[var(--color-accent-light)] bg-[var(--color-accent-subtle)] px-1 py-0.5 rounded-sm shrink-0">
              Transformed
            </span>
          )}
          {heroHighlighted && (
            <span className="text-[8px] uppercase tracking-widest font-semibold text-[var(--color-error)] shrink-0">
              Target
            </span>
          )}
        </div>
        <div className="w-48">
          <LpBar current={hero.currentLp} max={hero.maxLp} size="sm" />
        </div>
      </div>

      {/* Resources */}
      <ResourceBank resources={player.resourceBank} />

      {/* Hand count */}
      <div className="flex items-center gap-1.5 shrink-0">
        <CardBack size="sm" />
        <span className="font-mono text-[11px] text-[var(--color-text-muted)]">
          x{handCount}
        </span>
      </div>
    </div>
  );
}

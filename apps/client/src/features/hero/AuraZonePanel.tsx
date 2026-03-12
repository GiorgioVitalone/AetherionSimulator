import type { ReactNode } from 'react';
import type { CardInstance } from '@aetherion-sim/engine';
import { getFaction } from '@aetherion-sim/ui';
import { useUiStore } from '@/stores/ui-store';
import { getAbilityMeta } from '@/stores/game-store';

interface AuraZonePanelProps {
  readonly cards: readonly CardInstance[];
  readonly playerIndex: 0 | 1;
  readonly compact?: boolean;
}

export function AuraZonePanel({ cards, playerIndex, compact = false }: AuraZonePanelProps): ReactNode {
  const hoverCard = useUiStore((s) => s.hoverCard);

  if (cards.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="aura-zone"
      data-player-index={String(playerIndex)}
      className={compact ? 'space-y-1' : 'space-y-1.5'}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[8px] uppercase tracking-[0.2em] font-semibold text-[var(--color-text-faint)]">
          Aura Zone
        </span>
        <span className="text-[8px] font-mono text-[var(--color-text-muted)]">
          x{cards.length}
        </span>
      </div>

      <div className="grid gap-1.5">
        {cards.map((card) => {
          const faction = getFaction(card.alignment);
          const primaryEffect = getAbilityMeta(card.cardDefId)[0]?.effect ?? 'Aura effect active while this card remains in play.';

          return (
            <button
              key={card.instanceId}
              type="button"
              data-testid="aura-card"
              data-card-name={card.name}
              data-player-index={String(playerIndex)}
              data-faction={faction}
              className={`rounded-[var(--radius-md)] border text-left cursor-help transition-colors duration-150 hover:border-[var(--color-accent-muted)] ${compact ? 'px-2 py-1' : 'px-2 py-1.5'}`}
              style={{
                borderColor: 'var(--card-faction-color)',
                background: `
                  linear-gradient(90deg, color-mix(in srgb, var(--card-faction-color) 22%, transparent), transparent 65%),
                  var(--color-surface-alt)
                `,
              }}
              onMouseEnter={() => hoverCard(card.instanceId)}
              onMouseLeave={() => hoverCard(null)}
              onFocus={() => hoverCard(card.instanceId)}
              onBlur={() => hoverCard(null)}
            >
              <div className="min-w-0">
                <p className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-semibold truncate text-[var(--color-text)]`}>
                  {card.name}
                </p>
                <p className={`${compact ? 'text-[7px]' : 'text-[8px]'} uppercase tracking-[0.18em] text-[var(--color-accent-light)]`}>
                  Aura Spell
                </p>
              </div>
              <p className={`${compact ? 'mt-0.5 text-[8px]' : 'mt-1 text-[9px]'} leading-snug line-clamp-2 text-[var(--color-text-secondary)]`}>
                {primaryEffect}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

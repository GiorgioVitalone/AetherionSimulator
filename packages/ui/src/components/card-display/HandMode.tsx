/**
 * HandMode — larger card display for the player's hand (100×140px).
 * Shows name, cost, type badge, stats, and first ability (2-line clamp).
 * Grayed if unaffordable, gold border if playable.
 */
import type { ReactNode } from 'react';
import type { CardDisplayProps } from '../../types.js';
import { useArtBaseUrl } from '../../context/ArtContext.js';
import { resolveArtUrl } from '../../utils/art-url.js';
import { CostBadge } from '../CostBadge.js';
import { StatBadge } from '../StatBadge.js';

const CARD_TYPE_LABELS: Record<string, string> = {
  C: 'Character',
  S: 'Spell',
  E: 'Equipment',
};

export function HandMode(props: CardDisplayProps): ReactNode {
  const {
    name, cost, stats, cardType, abilities, playable, selected,
    artUrl, onClick, onMouseEnter, onMouseLeave,
  } = props;

  const artBaseUrl = useArtBaseUrl();
  const resolvedUrl = resolveArtUrl(artUrl, artBaseUrl);

  const firstAbility = abilities[0];

  return (
    <div
      className={`
        relative w-[100px] h-[140px] rounded-[var(--radius-md)] border-2 p-2
        flex flex-col cursor-pointer select-none overflow-hidden
        transition-all duration-150 hover:translate-y-[-4px] hover:shadow-lg
        ${selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]' : ''}
      `}
      style={{
        borderColor: playable ? 'var(--color-accent)' : 'var(--card-faction-color)',
        background: `
          radial-gradient(ellipse at 50% 95%, var(--card-faction-color) 0%, transparent 60%) no-repeat,
          var(--color-surface)
        `,
        backgroundSize: '100% 30%, 100% 100%',
        opacity: playable === false ? 0.5 : 1,
        filter: playable === false ? 'grayscale(30%)' : undefined,
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Card art background */}
      {resolvedUrl && (
        <img
          src={resolvedUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover rounded-[var(--radius-md)] opacity-20 pointer-events-none"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}

      {/* Cost badge */}
      <div className="flex justify-end mb-0.5">
        <CostBadge cost={cost} size="sm" />
      </div>

      {/* Name */}
      <h3
        className="text-[11px] font-black leading-tight truncate mb-0.5"
        style={{ color: 'var(--card-faction-light, var(--color-text))' }}
      >
        {name}
      </h3>

      {/* Type */}
      <div className="text-[8px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold mb-1">
        {CARD_TYPE_LABELS[cardType] ?? cardType}
      </div>

      {/* Ability (first only, 2-line clamp) */}
      {firstAbility && (
        <div className="text-[9px] text-[var(--color-text-secondary)] leading-snug line-clamp-2 mb-auto">
          {firstAbility.name && (
            <span className="font-semibold text-[var(--color-text-muted)]">
              {firstAbility.name}:{' '}
            </span>
          )}
          {firstAbility.effect}
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="flex gap-0.5 flex-wrap mt-1">
          <StatBadge type="atk" value={stats.atk} size="sm" />
          <StatBadge type="hp" value={stats.hp} size="sm" />
          {stats.arm > 0 && <StatBadge type="arm" value={stats.arm} size="sm" />}
        </div>
      )}
    </div>
  );
}

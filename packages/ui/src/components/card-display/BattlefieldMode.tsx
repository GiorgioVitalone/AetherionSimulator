/**
 * BattlefieldMode — compact card display for the game board (80×110px).
 * Shows name (truncated), stat badges, faction border, and status indicators.
 */
import type { ReactNode } from 'react';
import type { CardDisplayProps } from '../../types.js';
import { StatBadge } from '../StatBadge.js';

const CARD_TYPE_LABELS: Record<string, string> = {
  C: 'Character',
  S: 'Spell',
  E: 'Equipment',
};

export function BattlefieldMode(props: CardDisplayProps): ReactNode {
  const {
    name, stats, modifiedStats, cardType, exhausted, summoningSick,
    selected, highlighted, equipmentName, onClick, onMouseEnter, onMouseLeave,
  } = props;

  return (
    <div
      className={`
        relative w-[72px] h-[96px] rounded-[var(--radius-md)] border-2 p-1
        flex flex-col justify-between cursor-pointer select-none
        transition-all duration-150
        hover:ring-1 hover:ring-[var(--card-faction-light)] hover:brightness-110
        ${selected ? 'ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-bg)]' : ''}
        ${highlighted ? 'shadow-[0_0_12px_var(--card-faction-light)]' : ''}
      `}
      style={{
        borderColor: 'var(--card-faction-color)',
        background: `
          radial-gradient(ellipse at 50% 90%, var(--card-faction-color) 0%, transparent 70%) no-repeat,
          var(--color-surface)
        `,
        backgroundSize: '100% 40%, 100% 100%',
        opacity: exhausted ? 0.6 : 1,
        transform: exhausted ? 'rotate(90deg)' : undefined,
        transformOrigin: 'center center',
      }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Summoning sick indicator */}
      {summoningSick && (
        <div
          className="absolute inset-0 rounded-[var(--radius-md)] pointer-events-none animate-pulse"
          style={{ border: '2px solid var(--card-faction-light)', opacity: 0.5 }}
        />
      )}

      {/* Name */}
      <div
        className="text-[9px] font-bold leading-tight truncate text-[var(--color-text)]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {name}
      </div>

      {/* Type badge */}
      <div className="text-[7px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold">
        {CARD_TYPE_LABELS[cardType] ?? cardType}
      </div>

      {/* Equipment indicator */}
      {equipmentName && (
        <div
          className="text-[7px] font-semibold truncate px-0.5 rounded-sm"
          style={{
            color: 'var(--color-accent-light)',
            backgroundColor: 'rgba(190,148,56,0.15)',
          }}
        >
          {equipmentName}
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="flex gap-0.5 flex-wrap mt-auto">
          <StatBadge type="atk" value={modifiedStats?.atk ?? stats.atk} baseValue={stats.atk} size="sm" />
          <StatBadge type="hp" value={modifiedStats?.hp ?? stats.hp} baseValue={stats.hp} size="sm" />
          {stats.arm > 0 && (
            <StatBadge type="arm" value={modifiedStats?.arm ?? stats.arm} baseValue={stats.arm} size="sm" />
          )}
        </div>
      )}
    </div>
  );
}

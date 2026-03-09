/**
 * DetailMode — full-size card display for modals.
 * Shows all stats, abilities, traits, modifiers, and status effects.
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
  H: 'Hero',
  T: 'Transformed',
  R: 'Resource',
};

export function DetailMode(props: CardDisplayProps): ReactNode {
  const {
    name, cost, stats, modifiedStats, cardType, abilities,
    traits, rarity, flavorText, artUrl,
  } = props;

  const artBaseUrl = useArtBaseUrl();
  const resolvedUrl = resolveArtUrl(artUrl, artBaseUrl);

  return (
    <div
      className="relative w-[280px] rounded-[var(--radius-lg)] border-2 p-4 flex flex-col gap-3 overflow-hidden"
      style={{
        borderColor: 'var(--card-faction-color)',
        background: `
          radial-gradient(ellipse at 50% 100%, var(--card-faction-color) 0%, transparent 50%) no-repeat,
          var(--color-surface)
        `,
        backgroundSize: '100% 20%, 100% 100%',
      }}
    >
      {/* Card art background */}
      {resolvedUrl && (
        <img
          src={resolvedUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover rounded-[var(--radius-lg)] opacity-30 pointer-events-none"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3
            className="text-base font-black leading-tight"
            style={{ color: 'var(--card-faction-light, var(--color-text))' }}
          >
            {name}
          </h3>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold">
              {CARD_TYPE_LABELS[cardType] ?? cardType}
            </span>
            {rarity && (
              <span className="text-[9px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold">
                {rarity}
              </span>
            )}
          </div>
        </div>
        <CostBadge cost={cost} />
      </div>

      {/* Stats */}
      {stats && (
        <div className="flex gap-1.5">
          <StatBadge type="atk" value={modifiedStats?.atk ?? stats.atk} baseValue={stats.atk} />
          <StatBadge type="hp" value={modifiedStats?.hp ?? stats.hp} baseValue={stats.hp} />
          <StatBadge type="arm" value={modifiedStats?.arm ?? stats.arm} baseValue={stats.arm} />
        </div>
      )}

      {/* Traits */}
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {traits.map((trait) => (
            <span
              key={trait}
              className="text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-sm"
              style={{
                backgroundColor: 'rgba(190,148,56,0.12)',
                color: 'var(--color-accent-light)',
              }}
            >
              {trait}
            </span>
          ))}
        </div>
      )}

      {/* Abilities */}
      {abilities.length > 0 && (
        <div className="flex flex-col gap-2">
          {abilities.map((ability, i) => (
            <div key={i} className="text-[11px] leading-snug">
              <div className="flex items-baseline gap-1">
                {ability.name && (
                  <span className="font-semibold text-[var(--color-text)]">
                    {ability.name}
                  </span>
                )}
                {ability.cost && (
                  <span className="text-[9px] font-mono text-[var(--color-text-muted)]">
                    ({ability.cost})
                  </span>
                )}
              </div>
              {ability.trigger && (
                <div className="text-[9px] text-[var(--color-accent-light)] italic mb-0.5">
                  {ability.trigger}
                </div>
              )}
              <div className="text-[var(--color-text-secondary)]">{ability.effect}</div>
            </div>
          ))}
        </div>
      )}

      {/* Flavor text */}
      {flavorText && (
        <div
          className="text-[10px] italic leading-relaxed pt-2 border-t"
          style={{
            color: 'var(--color-text-faint)',
            borderColor: 'var(--color-border)',
          }}
        >
          {flavorText}
        </div>
      )}
    </div>
  );
}

/**
 * HeroPickerCard — displays a hero for selection in the game setup screen.
 * Shows hero name (Playfair 900), faction border, LP, and ability summaries.
 */
import type { ReactNode } from 'react';
import type { SimCard } from '@aetherion-sim/cards';
import { getFaction, LpBar } from '@aetherion-sim/ui';

interface HeroPickerCardProps {
  readonly hero: SimCard;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

export function HeroPickerCard({
  hero,
  selected,
  disabled,
  onSelect,
}: HeroPickerCardProps): ReactNode {
  const faction = getFaction(hero.alignment);
  const lp = hero.stats?.hp ?? 30;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      data-faction={faction}
      className={`
        w-full text-left rounded-[var(--radius-lg)] border-2 p-4
        transition-all duration-200 cursor-pointer
        ${selected
          ? 'ring-2 ring-[var(--color-accent)] border-[var(--card-faction-color)]'
          : 'border-[var(--color-border)] hover:border-[var(--card-faction-color)]'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
      style={{
        background: selected
          ? `radial-gradient(ellipse at 50% 100%, var(--card-faction-color) 0%, transparent 60%) no-repeat, var(--color-surface)`
          : 'var(--color-surface)',
        backgroundSize: '100% 30%, 100% 100%',
      }}
    >
      {/* Hero name */}
      <h3
        className="text-lg font-black leading-tight mb-1"
        style={{ color: selected ? 'var(--card-faction-light)' : 'var(--color-text)' }}
      >
        {hero.name}
      </h3>

      {/* Faction label */}
      <div className="text-[9px] uppercase tracking-widest text-[var(--color-text-faint)] font-semibold font-body mb-2">
        {hero.alignment[0] ?? 'Unknown'} Hero
      </div>

      {/* LP bar */}
      <div className="mb-3">
        <LpBar current={lp} max={lp} size="sm" />
      </div>

      {/* Abilities */}
      <div className="flex flex-col gap-1.5">
        {hero.abilities.map((ability, i) => (
          <div key={i} className="text-[10px] leading-snug">
            <span className="font-semibold text-[var(--color-text-muted)]">
              {ability.name}
            </span>
            {ability.trigger && (
              <span className="text-[var(--color-text-faint)] italic ml-1">
                ({ability.trigger})
              </span>
            )}
            <p className="text-[var(--color-text-secondary)] line-clamp-1 mt-0.5">
              {ability.effect}
            </p>
          </div>
        ))}
      </div>
    </button>
  );
}

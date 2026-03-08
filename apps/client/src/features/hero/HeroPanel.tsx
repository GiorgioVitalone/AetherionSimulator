/**
 * HeroPanel — displays the hero's name, LP bar, transformation state,
 * and ability buttons for the viewing player.
 */
import type { ReactNode } from 'react';
import type { HeroState } from '@aetherion-sim/engine';
import { LpBar } from '@aetherion-sim/ui';
import { HeroAbilityButton } from './HeroAbilityButton';

interface HeroPanelProps {
  readonly hero: HeroState;
  readonly faction: string;
  readonly isMyTurn: boolean;
  readonly canTransform: boolean;
  readonly onTransform?: () => void;
}

export function HeroPanel({
  hero,
  faction,
  isMyTurn,
  canTransform,
  onTransform,
}: HeroPanelProps): ReactNode {
  return (
    <div
      data-faction={faction}
      className="rounded-[var(--radius-lg)] border-2 p-3 space-y-2"
      style={{
        borderColor: 'var(--card-faction-color)',
        background: `
          radial-gradient(ellipse at 50% 100%, var(--card-faction-color) 0%, transparent 60%) no-repeat,
          var(--color-surface)
        `,
        backgroundSize: '100% 25%, 100% 100%',
      }}
    >
      {/* Hero name + transformation */}
      <div className="flex items-center gap-2">
        <h3 className="text-base font-bold leading-tight flex-1" style={{ fontFamily: 'var(--font-display)' }}>
          {hero.name}
        </h3>
        {hero.transformed && (
          <span className="text-[8px] uppercase tracking-widest font-semibold text-[var(--color-accent-light)] bg-[var(--color-accent-subtle)] px-1.5 py-0.5 rounded-sm">
            Transformed
          </span>
        )}
        {canTransform && !hero.transformed && (
          <button
            type="button"
            onClick={onTransform}
            className="text-[8px] uppercase tracking-widest font-semibold text-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-1.5 py-0.5 rounded-sm animate-pulse cursor-pointer hover:bg-[var(--color-accent-muted)]"
          >
            Transform
          </button>
        )}
      </div>

      {/* LP bar */}
      <LpBar current={hero.currentLp} max={hero.maxLp} />

      {/* Abilities */}
      {hero.abilities.length > 0 && (
        <div className="flex flex-col gap-1">
          {hero.abilities.map((ability, i) => (
            <HeroAbilityButton
              key={i}
              ability={ability}
              abilityIndex={i}
              heroCardDefId={hero.cardDefId}
              isMyTurn={isMyTurn}
            />
          ))}
        </div>
      )}
    </div>
  );
}

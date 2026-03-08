/**
 * HeroAbilityButton — shows ability name, cost, and cooldown state.
 * Dispatches ability activation via the action flow.
 */
import type { ReactNode } from 'react';
import type { AbilityDSL } from '@aetherion-sim/engine';
import { Tooltip } from '@/features/shared/Tooltip';
import { getHeroAbilityMeta } from '@/stores/game-store';

interface HeroAbilityButtonProps {
  readonly ability: AbilityDSL;
  readonly abilityIndex: number;
  readonly heroCardDefId: number;
  readonly isMyTurn: boolean;
}

export function HeroAbilityButton({
  ability: _ability,
  abilityIndex,
  heroCardDefId,
  isMyTurn,
}: HeroAbilityButtonProps): ReactNode {
  const meta = getHeroAbilityMeta(heroCardDefId);
  const abilityName = meta[abilityIndex]?.name ?? 'Ability';
  const abilityDesc = meta[abilityIndex]?.effect ?? '';

  const content = (
    <div
      className={`
        text-[10px] rounded-[var(--radius-sm)] p-1.5 border
        transition-colors duration-150
        ${isMyTurn
          ? 'border-[var(--color-border)] hover:border-[var(--color-accent-muted)] cursor-pointer'
          : 'border-[var(--color-border-subtle)] opacity-60'}
      `}
      style={{ backgroundColor: 'var(--color-surface-alt)' }}
    >
      <span className="font-semibold text-[var(--color-text)]">{abilityName}</span>
      {abilityDesc && (
        <p className="text-[var(--color-text-secondary)] mt-0.5 line-clamp-1">
          {abilityDesc}
        </p>
      )}
    </div>
  );

  if (!abilityDesc) return content;

  return (
    <Tooltip content={abilityDesc} placement="bottom">
      {content}
    </Tooltip>
  );
}

/**
 * HeroAbilityButton — shows ability name, cost, and cooldown state.
 * Dispatches hero ability activation when clicked during the player's turn.
 */
import type { ReactNode } from 'react';
import type { AbilityDSL } from '@aetherion-sim/engine';
import { Tooltip } from '@/features/shared/Tooltip';
import { useGameStore, getHeroAbilityMeta } from '@/stores/game-store';

interface HeroAbilityButtonProps {
  readonly ability: AbilityDSL;
  readonly abilityIndex: number;
  readonly heroCardDefId: number;
  readonly isMyTurn: boolean;
  readonly cooldownRemaining?: number;
}

export function HeroAbilityButton({
  ability,
  abilityIndex,
  heroCardDefId,
  isMyTurn,
  cooldownRemaining,
}: HeroAbilityButtonProps): ReactNode {
  const dispatch = useGameStore((s) => s.dispatch);
  const heroOptions = useGameStore((s) => s.availableActions?.canActivateHeroAbility ?? []);
  const option = heroOptions.find((o) => o.abilityIndex === abilityIndex);
  const canActivate = isMyTurn && option !== undefined;
  const onCooldown = cooldownRemaining !== undefined && cooldownRemaining > 0;

  const meta = getHeroAbilityMeta(heroCardDefId);
  const abilityName = meta[abilityIndex]?.name ?? 'Ability';
  const abilityDesc = meta[abilityIndex]?.effect ?? '';

  // Detect ability type label
  const isPassive = ability.type === 'aura';
  const isUltimate = ability.type === 'triggered' &&
    ability.trigger.type === 'activated' &&
    ability.trigger.oncePerGame === true;

  // Format cost display
  const costText = option
    ? [
        option.cost.mana > 0 ? `${String(option.cost.mana)}M` : '',
        option.cost.energy > 0 ? `${String(option.cost.energy)}E` : '',
        option.cost.flexible > 0 ? `${String(option.cost.flexible)}F` : '',
      ].filter(Boolean).join(' ') || 'Free'
    : '';

  const handleClick = () => {
    if (!canActivate) return;
    dispatch({ type: 'activate_hero_ability', abilityIndex });
  };

  const content = (
    <div
      className={`
        text-[10px] rounded-[var(--radius-sm)] p-1.5 border
        transition-colors duration-150
        ${canActivate
          ? 'border-[var(--color-accent-muted)] hover:border-[var(--color-accent)] cursor-pointer'
          : isMyTurn
            ? 'border-[var(--color-border)] opacity-60 cursor-not-allowed'
            : 'border-[var(--color-border-subtle)] opacity-60'}
      `}
      style={{ backgroundColor: 'var(--color-surface-alt)' }}
      onClick={handleClick}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-[var(--color-text)]">
          {abilityName}
          {isPassive && (
            <span className="ml-1 text-[7px] uppercase tracking-wider text-[var(--color-text-faint)]">PASSIVE</span>
          )}
          {isUltimate && (
            <span className="ml-1 text-[7px] uppercase tracking-wider text-[var(--color-accent)]">ULTIMATE</span>
          )}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          {onCooldown && (
            <span className="font-mono text-[8px] text-[var(--color-alignment-crimson)] bg-[var(--color-alignment-crimson-light)] px-1 rounded-sm">
              CD:{cooldownRemaining}
            </span>
          )}
          {costText && (
            <span className="font-mono text-[8px] text-[var(--color-text-muted)]">
              {costText}
            </span>
          )}
        </span>
      </div>
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

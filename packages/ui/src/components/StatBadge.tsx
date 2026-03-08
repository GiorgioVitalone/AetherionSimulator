/**
 * StatBadge — compact stat indicator for ATK, HP, ARM.
 * Uses JetBrains Mono for numeric values per Gilded Ink typography spec.
 */
import type { ReactNode } from 'react';

export type StatType = 'atk' | 'hp' | 'arm';

interface StatBadgeProps {
  readonly type: StatType;
  readonly value: number;
  readonly baseValue?: number;
  readonly size?: 'sm' | 'md';
}

const STAT_CONFIG: Record<StatType, { label: string; color: string }> = {
  atk: { label: 'ATK', color: '#ff6b6b' },
  hp:  { label: 'HP',  color: '#95d5b2' },
  arm: { label: 'ARM', color: '#d5ad52' },
};

export function StatBadge({ type, value, baseValue, size = 'md' }: StatBadgeProps): ReactNode {
  const config = STAT_CONFIG[type];
  const isBuffed = baseValue !== undefined && value > baseValue;
  const isDebuffed = baseValue !== undefined && value < baseValue;

  const sizeClasses = size === 'sm'
    ? 'text-[9px] px-1 py-0.5 gap-0.5'
    : 'text-[11px] px-1.5 py-0.5 gap-1';

  return (
    <span
      className={`inline-flex items-center rounded-sm font-mono font-medium ${sizeClasses}`}
      style={{
        backgroundColor: `${config.color}15`,
        color: isDebuffed ? '#e05050' : isBuffed ? '#52b788' : config.color,
      }}
      title={`${config.label}: ${value}${baseValue !== undefined ? ` (base ${baseValue})` : ''}`}
    >
      <span className="opacity-60 text-[0.8em]">{config.label}</span>
      <span>{value}</span>
    </span>
  );
}

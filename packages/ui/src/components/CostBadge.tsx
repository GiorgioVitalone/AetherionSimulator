/**
 * CostBadge — displays mana/energy cost values.
 * Mana = blue (#5a9acf), Energy = gold (#d5ad52) per design tokens.
 */
import type { ReactNode } from 'react';
import type { CostDisplay } from '../types.js';

interface CostBadgeProps {
  readonly cost: CostDisplay;
  readonly size?: 'sm' | 'md';
}

const RESOURCE_COLORS = {
  mana:     { color: '#5a9acf', bg: 'rgba(90,154,207,0.15)' },
  energy:   { color: '#d5ad52', bg: 'rgba(213,173,82,0.15)' },
  neutral:  { color: '#9ca3af', bg: 'rgba(156,163,175,0.15)' },
} as const;

export function CostBadge({ cost, size = 'md' }: CostBadgeProps): ReactNode {
  const parts: { label: string; value: string; color: string; bg: string }[] = [];

  // X-cost pills
  if (cost.xMana === true) {
    parts.push({ label: 'X', value: 'X', ...RESOURCE_COLORS.mana });
  }
  if (cost.xEnergy === true) {
    parts.push({ label: 'XE', value: 'X', ...RESOURCE_COLORS.energy });
  }

  // Flexible flag: show total cost as a neutral pill (any resource mix)
  if (cost.flexible > 0) {
    const totalCost = cost.mana + cost.energy;
    if (totalCost > 0) {
      parts.push({ label: 'N', value: String(totalCost), ...RESOURCE_COLORS.neutral });
    }
  } else {
    if (cost.mana > 0) {
      parts.push({ label: 'M', value: String(cost.mana), ...RESOURCE_COLORS.mana });
    }
    if (cost.energy > 0) {
      parts.push({ label: 'E', value: String(cost.energy), ...RESOURCE_COLORS.energy });
    }
  }

  if (parts.length === 0) {
    return (
      <span className="font-mono text-[10px] text-[var(--color-text-faint)]">0</span>
    );
  }

  const sizeClass = size === 'sm' ? 'text-[9px] gap-0.5' : 'text-[11px] gap-1';

  return (
    <span className={`inline-flex items-center ${sizeClass}`}>
      {parts.map((p) => (
        <span
          key={p.label}
          className="inline-flex items-center rounded-sm px-1 py-0.5 font-mono font-medium"
          style={{ backgroundColor: p.bg, color: p.color }}
        >
          {p.value}
        </span>
      ))}
    </span>
  );
}

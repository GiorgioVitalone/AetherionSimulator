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
  flexible: { color: '#b185db', bg: 'rgba(177,133,219,0.15)' },
} as const;

export function CostBadge({ cost, size = 'md' }: CostBadgeProps): ReactNode {
  const parts: { label: string; value: number; color: string; bg: string }[] = [];

  if (cost.mana > 0) {
    parts.push({ label: 'M', value: cost.mana, ...RESOURCE_COLORS.mana });
  }
  if (cost.energy > 0) {
    parts.push({ label: 'E', value: cost.energy, ...RESOURCE_COLORS.energy });
  }
  if (cost.flexible > 0) {
    parts.push({ label: 'F', value: cost.flexible, ...RESOURCE_COLORS.flexible });
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
          {p.value}{p.label}
        </span>
      ))}
    </span>
  );
}

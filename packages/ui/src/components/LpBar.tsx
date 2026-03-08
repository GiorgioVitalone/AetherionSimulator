/**
 * LpBar — horizontal hero life point bar.
 * Color transitions: green >60% → yellow 30-60% → red <30%.
 */
import type { ReactNode } from 'react';

interface LpBarProps {
  readonly current: number;
  readonly max: number;
  readonly size?: 'sm' | 'md';
}

function getLpColor(ratio: number): string {
  if (ratio > 0.6) return '#52b788';
  if (ratio > 0.3) return '#e0a030';
  return '#e05050';
}

export function LpBar({ current, max, size = 'md' }: LpBarProps): ReactNode {
  const ratio = max > 0 ? current / max : 0;
  const color = getLpColor(ratio);
  const height = size === 'sm' ? 'h-1.5' : 'h-2.5';

  return (
    <div className="flex items-center gap-2 w-full">
      <div
        className={`flex-1 rounded-full overflow-hidden ${height}`}
        style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
      >
        <div
          className={`${height} rounded-full transition-all duration-300`}
          style={{
            width: `${Math.max(0, Math.min(100, ratio * 100))}%`,
            backgroundColor: color,
          }}
        />
      </div>
      <span
        className="font-mono text-[11px] font-medium tabular-nums min-w-[3.5em] text-right"
        style={{ color }}
      >
        {current}/{max}
      </span>
    </div>
  );
}

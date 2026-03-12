/**
 * FactionBorder — wrapper that applies data-faction attribute and a 2px left border.
 * Children inherit faction CSS custom properties for contextual theming.
 */
import type { ReactNode } from 'react';
import { getFaction } from '../utils/faction.js';

interface FactionBorderProps {
  readonly alignment: readonly string[];
  readonly children: ReactNode;
  readonly className?: string;
}

export function FactionBorder({ alignment, children, className = '' }: FactionBorderProps): ReactNode {
  const faction = getFaction(alignment);

  return (
    <div
      data-faction={faction}
      className={`border-l-2 ${className}`}
      style={{ borderLeftColor: 'var(--card-faction-color)' }}
    >
      {children}
    </div>
  );
}

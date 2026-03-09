/**
 * Divider — horizontal rule separating opponent and player battlefields.
 */
import type { ReactNode } from 'react';

export function Divider(): ReactNode {
  return (
    <div className="flex items-center gap-3 px-4">
      <div className="flex-1 h-px bg-[var(--color-border)]" />
      <div className="w-3 h-3 rounded-full bg-[var(--color-accent)] opacity-50" />
      <div className="flex-1 h-px bg-[var(--color-border)]" />
    </div>
  );
}

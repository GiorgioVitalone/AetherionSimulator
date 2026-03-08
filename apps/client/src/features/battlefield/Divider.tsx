/**
 * Divider — horizontal rule separating opponent and player battlefields.
 */
import type { ReactNode } from 'react';

export function Divider(): ReactNode {
  return (
    <div className="flex items-center gap-3 px-4">
      <div className="flex-1 h-px bg-[var(--color-border)]" />
      <div className="w-2 h-2 rounded-full bg-[var(--color-accent)] opacity-40" />
      <div className="flex-1 h-px bg-[var(--color-border)]" />
    </div>
  );
}

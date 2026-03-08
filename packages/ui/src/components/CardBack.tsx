/**
 * CardBack — face-down card for the opponent's hand display.
 * Warm near-black with a gold accent pattern.
 */
import type { ReactNode } from 'react';

interface CardBackProps {
  readonly size?: 'sm' | 'md';
}

export function CardBack({ size = 'md' }: CardBackProps): ReactNode {
  const dims = size === 'sm'
    ? 'w-[50px] h-[70px]'
    : 'w-[60px] h-[84px]';

  return (
    <div
      className={`${dims} rounded-[var(--radius-md)] border-2 flex items-center justify-center`}
      style={{
        borderColor: 'var(--color-border-strong)',
        background: `
          radial-gradient(circle at 50% 50%, rgba(190,148,56,0.08) 0%, transparent 70%),
          var(--color-surface)
        `,
      }}
    >
      <div
        className="w-4 h-4 rounded-full border"
        style={{
          borderColor: 'rgba(190,148,56,0.3)',
          background: 'rgba(190,148,56,0.08)',
        }}
      />
    </div>
  );
}

/**
 * CardDetailModal — enlarged card preview on hover.
 * Rendered as a non-interactive floating panel (pointer-events: none)
 * to avoid stealing hover focus from the source card.
 */
import type { ReactNode } from 'react';
import type { CardInstance } from '@aetherion-sim/engine';
import { CardDisplay } from '@aetherion-sim/ui';
import { mapCardToDisplay } from '@/utils/card-mappers';

interface CardDetailModalProps {
  readonly card: CardInstance;
  readonly onClose: () => void;
}

export function CardDetailModal({ card, onClose: _onClose }: CardDetailModalProps): ReactNode {
  const displayProps = mapCardToDisplay(card, { mode: 'detail' });

  return (
    <div
      className="fixed inset-0 flex items-start justify-end p-6"
      style={{
        zIndex: 'var(--z-popover)',
        pointerEvents: 'none',
      }}
    >
      <div
        className="rounded-[var(--radius-lg)] overflow-hidden"
        style={{
          boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
        }}
      >
        <CardDisplay {...displayProps} />
      </div>
    </div>
  );
}

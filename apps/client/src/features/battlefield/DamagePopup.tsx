/**
 * DamagePopup — floating ±N text that appears above a card when damage/healing occurs.
 * Uses motion.div for a float-up + fade-out animation.
 */
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface DamagePopupProps {
  readonly value: number | null;
  readonly type: 'damage' | 'heal';
}

export function DamagePopup({ value, type }: DamagePopupProps): ReactNode {
  return (
    <AnimatePresence>
      {value !== null && (
        <motion.div
          data-testid="damage-popup"
          data-animation-type={type}
          data-popup-value={String(value)}
          initial={{ opacity: 1, y: 0 }}
          animate={{ opacity: 0, y: -24 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="absolute top-0 left-1/2 -translate-x-1/2 font-mono font-bold text-lg pointer-events-none"
          style={{
            zIndex: 'var(--z-tooltip)',
            color: type === 'damage' ? 'var(--color-error)' : '#52b788',
            textShadow: '0 1px 4px rgba(0,0,0,0.6)',
          }}
        >
          {type === 'damage' ? `-${value}` : `+${value}`}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

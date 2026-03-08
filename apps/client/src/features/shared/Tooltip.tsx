/**
 * Tooltip — hover-triggered tooltip using Gilded Ink design tokens.
 *
 * - 300ms hover delay to prevent flicker
 * - motion.div fade (150ms) with AnimatePresence
 * - z-index: var(--z-tooltip) (700), pointer-events: none
 * - Gilded Ink: bg-surface-raised, border-2 border, DM Sans 12px, 5px radius
 */
import { type ReactNode, useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  readonly content: ReactNode;
  readonly children: ReactNode;
  readonly placement?: 'top' | 'bottom' | 'left' | 'right';
}

const HOVER_DELAY_MS = 300;

const PLACEMENT_STYLES: Record<string, React.CSSProperties> = {
  top: { bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 6 },
  bottom: { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: 6 },
  left: { right: '100%', top: '50%', transform: 'translateY(-50%)', marginRight: 6 },
  right: { left: '100%', top: '50%', transform: 'translateY(-50%)', marginLeft: 6 },
};

export function Tooltip({ content, children, placement = 'top' }: TooltipProps): ReactNode {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), HOVER_DELAY_MS);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute rounded-[var(--radius-md)] border-2 px-2.5 py-1.5 text-xs font-body whitespace-nowrap"
            style={{
              zIndex: 'var(--z-tooltip)',
              pointerEvents: 'none',
              backgroundColor: 'var(--color-surface-raised)',
              borderColor: 'var(--color-border)',
              color: 'var(--color-text)',
              ...PLACEMENT_STYLES[placement],
            }}
          >
            {content}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

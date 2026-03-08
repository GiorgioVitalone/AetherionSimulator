/**
 * TargetOverlay — semi-transparent overlay shown when awaiting target selection.
 *
 * Dims the screen while the player chooses a target for an attack or equipment.
 * Provides a Cancel button. Valid targets are highlighted by the action flow store
 * (handled by BattlefieldCard's `highlighted` prop — not by this component).
 */
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useActionFlowStore } from '@/stores/action-flow-store';

interface TargetOverlayProps {
  readonly onCancel: () => void;
}

export function TargetOverlay({ onCancel }: TargetOverlayProps): ReactNode {
  const step = useActionFlowStore((s) => s.flowState.step);
  const isAwaitingTarget = step === 'awaiting_target';

  return (
    <AnimatePresence>
      {isAwaitingTarget && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0"
          style={{
            zIndex: 'var(--z-overlay)',
            backgroundColor: 'rgba(15,14,11,0.5)',
            pointerEvents: 'none',
          }}
        >
          {/* Cancel button is interactive */}
          <div
            className="absolute bottom-8 left-1/2 -translate-x-1/2"
            style={{ pointerEvents: 'auto' }}
          >
            <button
              type="button"
              onClick={onCancel}
              className="
                px-5 py-2 rounded-[var(--radius-md)] font-semibold text-sm font-body
                border-2 border-[var(--color-border-strong)] text-[var(--color-text)]
                hover:border-[var(--color-error)] hover:text-[var(--color-error)]
                transition-all duration-150 cursor-pointer
              "
              style={{ backgroundColor: 'var(--color-surface)' }}
            >
              Cancel
            </button>
          </div>

          {/* Instructional text */}
          <div
            className="absolute top-6 left-1/2 -translate-x-1/2"
            style={{ pointerEvents: 'none' }}
          >
            <span className="text-sm font-semibold font-body text-[var(--color-accent-light)]">
              Select a target
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

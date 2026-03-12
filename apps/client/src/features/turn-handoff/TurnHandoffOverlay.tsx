/**
 * TurnHandoffOverlay — full-screen "Player N's Turn" shown on turn changes.
 * Blocks interaction for 1.5s, then swaps the viewing player perspective.
 * Uses AnimatePresence for smooth fade in/out transitions.
 */
import { type ReactNode, useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';

const DISPLAY_DURATION_MS = 1500;

export function TurnHandoffOverlay(): ReactNode {
  const activePlayerIndex = useGameStore((s) => s.state?.activePlayerIndex ?? 0);
  const turnNumber = useGameStore((s) => s.state?.turnNumber ?? 0);
  const setViewingPlayer = useUiStore((s) => s.setViewingPlayer);

  const [visible, setVisible] = useState(false);
  const [displayPlayer, setDisplayPlayer] = useState(activePlayerIndex);
  const prevTurnRef = useRef(turnNumber);
  const prevActiveRef = useRef(activePlayerIndex);

  useEffect(() => {
    // Detect turn change (either turn number changed or active player changed)
    const turnChanged = turnNumber !== prevTurnRef.current || activePlayerIndex !== prevActiveRef.current;
    prevTurnRef.current = turnNumber;
    prevActiveRef.current = activePlayerIndex;

    if (!turnChanged || turnNumber === 0) return;

    // Show overlay BEFORE swapping to prevent opponent hand flash
    setDisplayPlayer(activePlayerIndex);
    setVisible(true);

    const timer = setTimeout(() => {
      setViewingPlayer(activePlayerIndex);
      setVisible(false);
    }, DISPLAY_DURATION_MS);

    return () => clearTimeout(timer);
  }, [turnNumber, activePlayerIndex, setViewingPlayer]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 flex items-center justify-center text-[var(--color-text)]"
          data-testid="turn-handoff-overlay"
          data-active-player={String(displayPlayer)}
          data-turn-number={String(turnNumber)}
          style={{
            zIndex: 'var(--z-modal)',
            backgroundColor: 'var(--color-surface-overlay)',
          }}
        >
          <motion.div
            className="text-center"
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          >
            <h1 className="text-4xl font-black mb-2">
              Player {displayPlayer + 1}&apos;s Turn
            </h1>
            <span className="font-mono text-lg text-[var(--color-text-muted)]">
              Turn {turnNumber}
            </span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

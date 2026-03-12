/**
 * useAnimationPlayer — consumes the animation queue with a 400ms auto-dequeue timer.
 *
 * Returns the current animation (if any) so components can react to it.
 * Respects `prefers-reduced-motion` by skipping the delay and dequeuing instantly.
 */
import { useEffect, useCallback } from 'react';
import { useUiStore, type AnimationEvent } from '@/stores/ui-store';
import { useReducedMotion } from 'motion/react';

const ANIMATION_DURATION_MS = 400;

export function useAnimationPlayer(): AnimationEvent | null {
  const queue = useUiStore((s) => s.animationQueue);
  const dequeueAnimation = useUiStore((s) => s.dequeueAnimation);
  const reducedMotion = useReducedMotion();

  const currentAnimation = queue.length > 0 ? (queue[0] ?? null) : null;

  const dequeue = useCallback(() => {
    dequeueAnimation();
  }, [dequeueAnimation]);

  useEffect(() => {
    if (!currentAnimation) return;

    // With reduced motion, dequeue instantly
    if (reducedMotion) {
      dequeue();
      return;
    }

    const timer = setTimeout(dequeue, ANIMATION_DURATION_MS);
    return () => clearTimeout(timer);
  }, [currentAnimation, reducedMotion, dequeue]);

  return reducedMotion ? null : currentAnimation;
}

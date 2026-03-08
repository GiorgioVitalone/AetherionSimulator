/**
 * BattlefieldCard — wraps a CardInstance in CardDisplay (battlefield mode).
 * Bridges engine CardInstance → UI CardDisplayProps via the card mapper.
 * Wrapped in motion.div for deploy/exhausted animations.
 */
import { type ReactNode, useMemo } from 'react';
import type { CardInstance } from '@aetherion-sim/engine';
import { motion } from 'motion/react';
import { CardDisplay } from '@aetherion-sim/ui';
import { useUiStore } from '@/stores/ui-store';
import { mapCardToDisplay } from '@/utils/card-mappers';
import { DamagePopup } from './DamagePopup';

interface BattlefieldCardProps {
  readonly card: CardInstance;
  readonly highlighted?: boolean;
  readonly onClick?: () => void;
}

export function BattlefieldCard({
  card,
  highlighted,
  onClick,
}: BattlefieldCardProps): ReactNode {
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const hoverCard = useUiStore((s) => s.hoverCard);
  const animationQueue = useUiStore((s) => s.animationQueue);

  const displayProps = mapCardToDisplay(card, {
    mode: 'battlefield',
    selected: selectedCardId === card.instanceId,
    highlighted,
    onClick,
    onMouseEnter: () => hoverCard(card.instanceId),
    onMouseLeave: () => hoverCard(null),
  });

  // Check if current animation targets this card
  const currentAnim = animationQueue.length > 0 ? animationQueue[0] : undefined;
  const damageValue = useMemo(() => {
    if (currentAnim?.targetId === card.instanceId && currentAnim.type === 'damage') {
      return currentAnim.value ?? null;
    }
    return null;
  }, [currentAnim, card.instanceId]);

  const healValue = useMemo(() => {
    if (currentAnim?.targetId === card.instanceId && currentAnim.type === 'heal') {
      return currentAnim.value ?? null;
    }
    return null;
  }, [currentAnim, card.instanceId]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{
        opacity: 1,
        scale: 1,
        rotate: card.exhausted ? 6 : 0,
      }}
      transition={{ duration: 0.2 }}
      className="relative"
    >
      <CardDisplay {...displayProps} />
      <DamagePopup value={damageValue} type="damage" />
      <DamagePopup value={healValue} type="heal" />
    </motion.div>
  );
}

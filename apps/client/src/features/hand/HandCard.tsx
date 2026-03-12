/**
 * HandCard — wraps CardDisplay in hand mode.
 * Reads availableActions to determine playability.
 * Wrapped in motion.div for smooth layout animations when cards leave/enter hand.
 */
import type { ReactNode } from 'react';
import type { CardInstance } from '@aetherion-sim/engine';
import { motion } from 'motion/react';
import { CardDisplay } from '@aetherion-sim/ui';
import { useGameStore } from '@/stores/game-store';
import { useUiStore } from '@/stores/ui-store';
import { mapCardToDisplay } from '@/utils/card-mappers';

interface HandCardProps {
  readonly card: CardInstance;
  readonly onClick: (instanceId: string) => void;
}

export function HandCard({ card, onClick }: HandCardProps): ReactNode {
  const availableActions = useGameStore((s) => s.availableActions);
  const selectedCardId = useUiStore((s) => s.selectedCardId);
  const hoverCard = useUiStore((s) => s.hoverCard);

  const displayProps = mapCardToDisplay(card, {
    mode: 'hand',
    availableActions,
    selected: selectedCardId === card.instanceId,
    onClick: () => onClick(card.instanceId),
    onMouseEnter: () => hoverCard(card.instanceId),
    onMouseLeave: () => hoverCard(null),
  });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      data-testid="hand-card"
      data-instance-id={card.instanceId}
      data-card-name={card.name}
      data-card-type={card.cardType}
      data-playable={displayProps.playable === true ? 'true' : 'false'}
      data-x-cost={card.cost.xMana === true || card.cost.xEnergy === true ? 'true' : 'false'}
      data-has-haste={card.traits.some((trait) => trait.toLowerCase() === 'haste') ? 'true' : 'false'}
    >
      <CardDisplay {...displayProps} />
    </motion.div>
  );
}

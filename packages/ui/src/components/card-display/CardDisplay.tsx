/**
 * CardDisplay — polymorphic card component that delegates to mode-specific renderers.
 * Wraps content in a FactionBorder-compatible data-faction attribute.
 */
import type { ReactNode } from 'react';
import type { CardDisplayProps } from '../../types.js';
import { BattlefieldMode } from './BattlefieldMode.js';
import { HandMode } from './HandMode.js';
import { DetailMode } from './DetailMode.js';

export function CardDisplay(props: CardDisplayProps): ReactNode {
  const content = (() => {
    switch (props.mode) {
      case 'battlefield':
        return <BattlefieldMode {...props} />;
      case 'hand':
        return <HandMode {...props} />;
      case 'detail':
        return <DetailMode {...props} />;
    }
  })();

  return (
    <div data-faction={props.faction}>
      {content}
    </div>
  );
}

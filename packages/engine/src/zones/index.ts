export {
  getZoneSlots,
  getZoneArray,
  getCardsInZone,
  getAllCards,
  hasOpenSlot,
  firstOpenSlot,
  findCard,
  deployToZone,
  removeFromZone,
  moveCard,
  isAdjacentZone,
  createEmptyZoneState,
} from './zone-manager.js';
export type { CardLocation, RemoveResult } from './zone-manager.js';

export {
  getValidAttackTargets,
  isBoardEmpty,
} from './targeting.js';
export type { AttackTarget } from './targeting.js';

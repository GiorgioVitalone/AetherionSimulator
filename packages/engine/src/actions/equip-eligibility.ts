/**
 * Equipment attach-eligibility (Rulebook 13). A character is an eligible attach
 * target for an Equipment card when it satisfies every constraint authored on the
 * equipment's `equipRequirement` (a matching resource type — Magic/Tech — and/or a
 * specific Tag). Equipment with no requirement may attach to any character. Pure.
 */
import type { CardInstance } from '../types/game-state.js';
import { cardResourceType } from './card-resource.js';
import { hasEffectiveTag } from '../selectors/card-semantics.js';

export function meetsEquipRequirement(
  equipment: CardInstance,
  character: CardInstance,
): boolean {
  const req = equipment.equipRequirement;
  if (req === undefined) return true;
  if (req.resourceType !== undefined && cardResourceType(character) !== req.resourceType) {
    return false;
  }
  if (req.tag !== undefined && !hasEffectiveTag(character, req.tag)) {
    return false;
  }
  return true;
}

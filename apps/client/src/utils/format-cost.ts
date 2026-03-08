/**
 * Format a resource cost into a human-readable string.
 */
import type { ResourceCost } from '@aetherion-sim/engine';

export function formatCost(cost: ResourceCost): string {
  const parts: string[] = [];
  if (cost.mana > 0) parts.push(`${cost.mana} Mana`);
  if (cost.energy > 0) parts.push(`${cost.energy} Energy`);
  if (cost.flexible > 0) parts.push(`${cost.flexible} Flexible`);
  return parts.length > 0 ? parts.join(', ') : 'Free';
}

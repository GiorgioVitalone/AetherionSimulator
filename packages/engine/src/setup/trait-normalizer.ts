/**
 * Trait Normalizer — converts authored Title-Case trait labels (as stored in the
 * card DB / JSON, e.g. "Defender", "First Strike", "Regeneration 2") into the
 * engine's lowercase snake_case `Trait` enum values used by every gating check.
 *
 * "Regeneration N" is special: it is not a `Trait`, it is a status. It is split
 * out into a `regeneration` ActiveStatus carrying the numeric value N.
 */
import type { Trait } from '../types/common.js';
import type { ActiveStatus } from '../types/game-state.js';

/** Title-Case (or otherwise authored) trait label -> engine `Trait`. */
const TRAIT_MAP: Readonly<Record<string, Trait>> = {
  haste: 'haste',
  rush: 'rush',
  sniper: 'sniper',
  elite: 'elite',
  flying: 'flying',
  defender: 'defender',
  stealth: 'stealth',
  swift: 'swift',
  volatile: 'volatile',
  'first strike': 'first_strike',
  first_strike: 'first_strike',
};

export interface NormalizedTraits {
  readonly traits: readonly Trait[];
  readonly statusEffects: readonly ActiveStatus[];
  /** X parsed from a "Rush N" label (extra deploy-turn moves). Absent if no Rush. */
  readonly rushValue?: number;
  /** X parsed from a "Recycle N" label (cards drawn when discarded from hand;
   * Rulebook 16). Absent if no Recycle. */
  readonly recycleValue?: number;
}

/**
 * Normalize a raw authored trait list. Recognized labels become engine `Trait`s;
 * "Regeneration N" becomes a regeneration status with value N. Unknown labels are
 * dropped (no current card carries them and the enum is closed).
 */
export function normalizeTraits(
  raw: readonly string[] | undefined,
): NormalizedTraits {
  const traits: Trait[] = [];
  const statusEffects: ActiveStatus[] = [];
  let rushValue: number | undefined;
  let recycleValue: number | undefined;

  for (const label of raw ?? []) {
    const regen = parseRegeneration(label);
    if (regen !== null) {
      statusEffects.push(regen);
      continue;
    }
    const rush = parseRush(label);
    if (rush !== null) {
      traits.push('rush');
      rushValue = rush;
      continue;
    }
    const recycle = parseRecycle(label);
    if (recycle !== null) {
      traits.push('recycle');
      recycleValue = recycle;
      continue;
    }
    const trait = TRAIT_MAP[label.trim().toLowerCase()];
    if (trait !== undefined) traits.push(trait);
  }

  return {
    traits,
    statusEffects,
    ...(rushValue !== undefined ? { rushValue } : {}),
    ...(recycleValue !== undefined ? { recycleValue } : {}),
  };
}

/** Parse "Rush N" -> N extra deploy-turn moves (defaults to 1 if no number). */
function parseRush(label: string): number | null {
  const match = /^rush(?:\s+(\d+))?$/i.exec(label.trim());
  if (match === null) return null;
  return match[1] !== undefined ? Number.parseInt(match[1], 10) : 1;
}

/** Parse "Recycle N" -> N cards drawn on discard-from-hand (defaults to 1). */
function parseRecycle(label: string): number | null {
  const match = /^recycle(?:\s+(\d+))?$/i.exec(label.trim());
  if (match === null) return null;
  return match[1] !== undefined ? Number.parseInt(match[1], 10) : 1;
}

/** Parse "Regeneration N" -> regeneration status, or null if not a regen label. */
function parseRegeneration(label: string): ActiveStatus | null {
  const match = /^regeneration(?:\s+(\d+))?$/i.exec(label.trim());
  if (match === null) return null;
  const value = match[1] !== undefined ? Number.parseInt(match[1], 10) : 1;
  return { statusType: 'regeneration', value, remainingTurns: null };
}

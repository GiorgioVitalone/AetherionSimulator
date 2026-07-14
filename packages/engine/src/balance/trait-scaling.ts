/**
 * Trait → stat-scaling values. Each keyword's worth scales with the stat it
 * leverages (Defender ∝ HP+ARM, Flying/First-Strike/Haste ∝ ATK, Volatile a
 * negative ∝ HP). Anchored to combat-plan's KEY_DEFENDER_VALUE=1.6 (a wall is
 * worth ~1.6× its blocking mass ⇒ a +0.6 premium). Additive contributions; the
 * intra-card synergy multiplier is applied separately (see card-power.ts).
 */
import type { Trait } from '../types/common.js';
import { CARD_TO_HAND, W_ARM } from './weights.js';
import type { CardStats } from './types.js';

export interface TraitParams {
  readonly rushValue?: number;
  readonly recycleValue?: number;
}

const ZERO_STATS: CardStats = { hp: 0, atk: 0, arm: 0 };

function assertNever(x: never): never {
  throw new Error(`Unhandled trait: ${JSON.stringify(x)}`);
}

/** Additive value of one engine-normalized trait given the body it sits on. */
export function traitValue(trait: Trait, stats: CardStats | null, params: TraitParams): number {
  const s = stats ?? ZERO_STATS;
  const power = s.atk + s.hp;
  switch (trait) {
    case 'defender':
      // §S2: blocking mass in the SAME per-point units as statBase (W_HP=1 per
      // HP, W_ARM per ARM) — was a flat hp+arm (1:1), implicitly pricing ARM's
      // contribution to blocking mass at a rate independent of what W_ARM says
      // everywhere else (and, before §S2, at a rate that assumed ARM absorbs
      // every gang-hit rather than only the first each turn).
      return 0.6 * (s.hp + W_ARM * s.arm); // wall premium scales with blocking mass
    case 'flying':
      return 0.5 * s.atk; // evasive reach scales with ATK
    case 'first_strike':
      return 0.35 * s.atk; // wins exchanges, ∝ ATK
    case 'haste':
      return 0.3 * s.atk; // one immediate attack, ∝ ATK
    case 'rush':
      return 0.12 * (params.rushValue ?? 1) * s.atk; // N extra deploy moves
    case 'swift':
      return 0.4; // one free non-exhausting move/turn
    case 'recycle':
      // §S1: derived from the shared acquisition primitive — ½ CARD_TO_HAND per
      // recycled card, matching this comment's own long-standing claim (was a
      // hardcoded 0.6, which was NOT half of the draw anchor).
      return 0.5 * CARD_TO_HAND * (params.recycleValue ?? 1);
    case 'stealth':
      return 0.25 * power; // dodges removal a window, ∝ body
    case 'elite':
      return 0.5; // High-Ground access
    case 'volatile':
      return -0.35 * s.hp; // downside ∝ HP (forward-looking; no live card)
    case 'sniper':
      return 0.3 * s.atk; // reach (inert on the current pool)
    default:
      return assertNever(trait);
  }
}

/** Regeneration is a STATUS (not a Trait): recurring upkeep heal, capped so a
 * 1-HP body can't claim huge regen value. */
export function regenerationValue(n: number, hp: number): number {
  return Math.min(0.8 * n, 0.8 * Math.max(hp, 1));
}

/**
 * Static (context-free) effect valuation — the analog of src/bot/spell-eval.ts's
 * scoreEffect, valued against EXPECTED targets instead of a live board. Same
 * per-effect coefficients, so static scores stay consistent with the bot's
 * worldview. Always full value-mode (it is an analysis tool, not the legacy bot).
 *
 * §S3: the actual valuation logic lives in effect-interval.ts's
 * effectStaticValueDetailed/sumEffectsDetailed (the ONE core path, returning a
 * [low, high] band + PowerFlags around the point value). The plain
 * EffectValue exports below are thin derived views (`.value`/`.isRemoval`
 * only) — never a second computation, so the scalar can never drift.
 */
import type { Effect } from '../types/effects.js';
import type { EffectValue } from './types.js';
import { effectStaticValueDetailed, sumEffectsDetailed } from './effect-interval.js';

/** Sum a list of effects; isRemoval propagates if ANY sub-effect is removal. */
export function sumEffects(effects: readonly Effect[]): EffectValue {
  const d = sumEffectsDetailed(effects);
  return { value: d.value, isRemoval: d.isRemoval };
}

/** Expected context-free value of a single effect node. */
export function effectStaticValue(effect: Effect): EffectValue {
  const d = effectStaticValueDetailed(effect);
  return { value: d.value, isRemoval: d.isRemoval };
}

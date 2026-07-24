/**
 * Small shared helpers for reading a TargetExpr's side/shape. Used by both the
 * effect valuator and the signal extractor. `side ∈ {enemy, any}` counts as
 * enemy-facing — the bot uses `any`-side removal/damage offensively.
 */
import type { Side } from '../types/common.js';
import type { TargetExpr } from '../types/targets.js';

export function targetSide(t: TargetExpr): Side | undefined {
  return 'side' in t ? t.side : undefined;
}

export function isEnemyFacing(t: TargetExpr): boolean {
  const s = targetSide(t);
  return s === 'enemy' || s === 'any';
}

export function isEnemyHero(t: TargetExpr): boolean {
  return t.type === 'hero' && (t.side === 'enemy' || t.side === 'any');
}

/** §H1-1 (round-13 fix): `up_to` (a variable-size CHOSEN set — up to N
 * targets) is multi-target the same way `all_characters`/`_in_zone` are —
 * previously excluded here, which made effect-interval.ts's aoeFactor treat
 * an `up_to`-2 destroy identically to a single-target one (1x, not ~2x).
 * signal-extract.ts's demand emission also benefits: a card that buffs
 * `up_to` allies genuinely wants multiple buffable bodies, same as an
 * all-characters buff. The magnitude (how MANY targets, not just "is this
 * multi-target") is resolved separately, per-count, by effect-interval.ts's
 * aoeFactor — this boolean is a shape check only. */
export function isAoE(t: TargetExpr): boolean {
  return t.type === 'all_characters' || t.type === 'all_characters_in_zone' || t.type === 'up_to';
}

export function isAlliedCharacter(t: TargetExpr): boolean {
  return targetSide(t) === 'allied' && t.type !== 'hero';
}

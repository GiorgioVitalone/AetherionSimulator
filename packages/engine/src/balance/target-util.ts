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

export function isAoE(t: TargetExpr): boolean {
  return t.type === 'all_characters' || t.type === 'all_characters_in_zone';
}

export function isAlliedCharacter(t: TargetExpr): boolean {
  return targetSide(t) === 'allied' && t.type !== 'hero';
}

/**
 * Bot spell-target selection — chooses sensible chosen targets for a cast_spell
 * action so the engine resolves to the RIGHT body instead of front-of-zone.
 *
 * Pure functions over PlayerState; deterministic tie-breaks (no Math.random).
 * Policy per single-target effect:
 *   - ally-facing destroy/sacrifice → WEAKEST own body (cheapest chump to lose)
 *   - enemy-facing removal/damage   → BIGGEST enemy threat (highest power)
 *   - ally buff (modify_stats)      → best own attacker (highest power)
 * AoE / multi / self specs contribute no chosen target (the engine resolves them).
 */
import type { PlayerState, CardInstance } from '../types/game-state.js';
import type { Effect } from '../types/effects.js';
import type { TargetExpr } from '../types/targets.js';
import type { AbilityDSL } from '../types/ability.js';
import type { Side } from '../types/common.js';
import { getAllCards } from '../zones/zone-manager.js';

/** Chosen target instanceIds for a spell, or undefined to let the engine auto-resolve. */
export function chooseSpellTargets(
  caster: PlayerState,
  opponent: PlayerState,
  card: CardInstance,
): readonly string[] | undefined {
  const ids: string[] = [];
  for (const effect of spellEffects(card.abilities)) {
    const id = chooseEffectTarget(caster, opponent, effect);
    if (id !== null) ids.push(id);
  }
  return ids.length > 0 ? ids : undefined;
}

/** One-shot effects of a spell: triggered + aura effect lists. */
function spellEffects(abilities: readonly AbilityDSL[]): readonly Effect[] {
  const out: Effect[] = [];
  for (const ab of abilities) {
    if (ab.type === 'triggered' || ab.type === 'aura') out.push(...ab.effects);
  }
  return out;
}

function chooseEffectTarget(
  caster: PlayerState,
  opponent: PlayerState,
  effect: Effect,
): string | null {
  switch (effect.type) {
    case 'destroy':
    case 'sacrifice':
    case 'bounce':
      return isAlliedSingle(effect.target)
        ? weakestBody(caster) // sacrifice/destroy our own → lose the cheapest chump
        : isEnemySingle(effect.target)
          ? biggestThreat(opponent) // removal → kill the biggest enemy
          : null;
    case 'deal_damage':
      return isEnemySingle(effect.target) ? biggestThreat(opponent) : null;
    case 'modify_stats':
      return isAlliedSingle(effect.target) ? strongestBody(caster) : null;
    default:
      return null;
  }
}

// ── Target-spec classification ───────────────────────────────────────────────

function isSingle(target: TargetExpr): boolean {
  return target.type === 'target_character';
}

function side(target: TargetExpr): Side | undefined {
  return 'side' in target ? (target as { side?: Side }).side : undefined;
}

function isAlliedSingle(target: TargetExpr): boolean {
  return isSingle(target) && side(target) === 'allied';
}

function isEnemySingle(target: TargetExpr): boolean {
  return isSingle(target) && side(target) === 'enemy';
}

// ── Body selection (deterministic: power, then instanceId) ───────────────────

function bodies(player: PlayerState): readonly CardInstance[] {
  return getAllCards(player.zones).filter(c => c.cardType === 'C');
}

function weakestBody(player: PlayerState): string | null {
  const ranked = [...bodies(player)].sort(
    (a, b) => power(a) - power(b) || a.instanceId.localeCompare(b.instanceId),
  );
  return ranked[0]?.instanceId ?? null;
}

function strongestBody(player: PlayerState): string | null {
  const ranked = [...bodies(player)].sort(
    (a, b) => power(b) - power(a) || a.instanceId.localeCompare(b.instanceId),
  );
  return ranked[0]?.instanceId ?? null;
}

function biggestThreat(player: PlayerState): string | null {
  return strongestBody(player);
}

function power(card: CardInstance): number {
  return card.currentAtk + card.currentHp;
}

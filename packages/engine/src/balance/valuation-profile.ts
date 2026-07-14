/**
 * §S2 — versioned valuation profile: documents the RULESET assumptions the
 * defense-related weights (W_ARM in weights.ts, the shield-replacement case in
 * effect-value.ts, the Defender premium in trait-scaling.ts) are derived under.
 *
 * v1 rule (locked, sim-data/ruleset-v1.json — `armFirstInstanceOnly` and
 * `shieldFirstInstanceOnly`, both `true`): a body's ARM and its EC-003 "-1
 * would take damage" shield reduce only the FIRST combat-damage instance the
 * body takes in a given turn; later instances that same turn are unreduced.
 * The charge recharges at the next turn boundary. This is NOT the engine's
 * default per-instance rule (which would reduce EVERY instance, unbounded per
 * turn) — that stronger, repealed premise is what the old W_ARM=1.3
 * justification ("mitigates >=1 damage per instance and persists") described.
 *
 * This file is a documentation-and-derivation locus, not a parallel anchor
 * system: every number below IS one of the engine's own existing constants,
 * re-exported/referenced by name so this profile and the weights it describes
 * can never silently drift apart.
 */
import { AURA_REC } from './weights.js';

export const VALUATION_PROFILE_V1 = {
  armMitigation: 'first_instance_per_turn',
  shieldMitigation: 'first_instance_per_turn',
  /** Damage mitigated per ARM point / per shield reduction point, PER
   * ELIGIBLE TURN — exactly one blocked hit, never more, regardless of how
   * many additional combat instances land on the body that turn (the
   * single-instance cap EC-002/EC-003 both enforce). */
  mitigatedDamagePerPointPerTurn: 1,
  /** Expected number of turns a body remains an active blocking presence.
   * Reuses the SAME anchor the trigger-recurrence model already uses for "a
   * continuous board effect, active every turn in play" (weights.ts
   * AURA_REC) — a shield that recharges every turn is exactly that kind of
   * continuous presence. Consumed by the ability-wrapped shield-replacement
   * path (effect-value.ts 'replacement' -> card-power.ts's
   * abilityContribution -> recurrence()), NOT by the flat per-point W_ARM
   * stat weight (see weights.ts for why those two are deliberately kept in
   * different, non-turn-multiplied units).
   */
  expectedActiveTurns: AURA_REC,
} as const;

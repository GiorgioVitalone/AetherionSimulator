/**
 * §S2 — versioned valuation profile: documents the RULESET assumptions the
 * defense-related weights (W_ARM in weights.ts, the shield-replacement case in
 * effect-value.ts, the Defender premium in trait-scaling.ts) are derived under.
 *
 * ROUND-5 CORRECTION (2026-07-16): this file previously claimed
 * `shieldFirstInstanceOnly` was locked `true` in ruleset-v1.json, alongside
 * `armFirstInstanceOnly`. That claim was FALSE — see the cross-layer test
 * below (valuation-profile-manifest.test.ts), which reads
 * sim-data/ruleset-v1.json directly: the manifest's `rules` object carries
 * ONLY `armFirstInstanceOnly: true`. There is no `shieldFirstInstanceOnly`
 * entry at all (the ratified nine flags are enumerated in
 * tests/sim/ruleset-v1-lock.test.ts's EXPECTED_RULES literal). The engine
 * defaults `shieldFirstInstanceOnly` to `false` when a config doesn't set it
 * (combat-resolver.ts), so under v1 the EC-003 "-1 would take damage" shield
 * reduces EVERY combat-damage instance a body takes in a turn, not just the
 * first. The shield pricing below has been re-derived for that per-instance
 * reality (see SHIELD_INSTANCES_PER_TURN, weights.ts).
 *
 * v1 rule (locked, sim-data/ruleset-v1.json — `armFirstInstanceOnly: true`
 * only): a body's ARM reduces only the FIRST combat-damage instance the body
 * takes in a given turn; later instances that same turn are unreduced. The
 * charge recharges at the next turn boundary. This is NOT the engine's
 * default per-instance rule (which would reduce EVERY instance, unbounded per
 * turn) — that stronger, repealed premise is what the old W_ARM=1.3
 * justification ("mitigates >=1 damage per instance and persists") described.
 * The shield (EC-003, `shieldFirstInstanceOnly`) is a SEPARATE, OPTIONAL
 * config flag that exists in the engine but is NOT part of the v1 lock —
 * standard v1 play runs shields at the engine's per-instance default.
 *
 * This file is a documentation-and-derivation locus, not a parallel anchor
 * system: every number below IS one of the engine's own existing constants,
 * re-exported/referenced by name so this profile and the weights it describes
 * can never silently drift apart.
 */
import { AURA_REC, SHIELD_INSTANCES_PER_TURN } from './weights.js';

export const VALUATION_PROFILE_V1 = {
  armMitigation: 'first_instance_per_turn',
  shieldMitigation: 'per_instance',
  /** Damage mitigated per ARM point, PER ELIGIBLE TURN — exactly one blocked
   * hit, never more, regardless of how many additional combat instances land
   * on the body that turn (the single-instance cap EC-002 enforces; ARM IS
   * locked to this in v1). */
  armMitigatedDamagePerPointPerTurn: 1,
  /** Damage mitigated per shield reduction point, PER ELIGIBLE TURN — v1 runs
   * shields at the engine's per-instance default (shieldFirstInstanceOnly is
   * NOT in the v1 manifest), so a shield blunts EVERY combat instance the body
   * takes that turn, not just the first. SHIELD_INSTANCES_PER_TURN (weights.ts)
   * is the Rulebook's own worked ARM example (two attacks landing on one body
   * in a turn), reused here as the expected instance count. */
  shieldMitigatedDamagePerPointPerTurn: SHIELD_INSTANCES_PER_TURN,
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

/**
 * Bot-side combat simulation — a faithful, rule-aware mirror of the engine's real
 * combat damage model, used by the gang planner / trade heuristic to decide whether
 * a sequence of attackers actually KILLS a body.
 *
 * It reuses the SAME primitives the engine combat path uses:
 *   - `calculateCombatDamage` (ARM-then-shield math, First Strike ordering)
 *   - `applyDamageReplacements` (the −1 "would take damage" shield)
 *   - `effectiveCombatArm` semantics (EC-002 first-instance ARM) and the EC-003
 *     first-instance shield suppression.
 *
 * The defect this fixes: the planner previously called `applyDamageReplacements`
 * fresh for EVERY swing and read raw `currentArm` per swing — so it modelled the
 * shield/ARM as if each attacker faced a full, recharged defence, and (under EC-003)
 * never saw that ganging a shielded body lets later attackers bypass the spent
 * shield. By threading per-turn ARM/shield CHARGES across the simulated sequence
 * (exactly as `combat-resolver` consumes them), the planner now matches how real
 * combat resolves and can correctly elect to gang a body it can clear.
 *
 * Pure: no GameState mutation. Charges are tracked in a small local map keyed by
 * instanceId for the duration of one planning call.
 */
import type { CardInstance, GameConfig } from '../types/game-state.js';
import type { Trait } from '../types/common.js';
import { calculateCombatDamage } from '../combat/damage-calculator.js';
import { applyDamageReplacements } from '../effects/replacement-handler.js';

/** The mutable per-body charge state a planning sequence threads between swings.
 * `armSpent` / `shieldSpent` mirror the engine's `armMitigatedThisTurn` /
 * `shieldMitigatedThisTurn` first-instance charges (only meaningful when the
 * matching toggle is on). Seeded from the live card flags so an already-damaged
 * board (mid-turn) is modelled correctly. */
export interface CombatSimBody {
  readonly card: CardInstance;
  armSpent: boolean;
  shieldSpent: boolean;
}

/** Wrap a live card as a sim body, seeding charges from its current flags so a
 * mid-turn plan reflects charges the body has already spent in real combat. */
export function asSimBody(card: CardInstance): CombatSimBody {
  return {
    card,
    armSpent: card.armMitigatedThisTurn === true,
    shieldSpent: card.shieldMitigatedThisTurn === true,
  };
}

function traits(card: CardInstance): readonly Trait[] {
  return [...card.traits, ...card.grantedTraits.map(g => g.trait)];
}

/** The ARM a body presents against ONE combat instance under the live rule —
 * mirrors combat-resolver.effectiveCombatArm. */
function armFor(body: CombatSimBody, firstInstanceOnly: boolean): number {
  if (!firstInstanceOnly) return body.card.currentArm;
  return body.armSpent ? 0 : body.card.currentArm;
}

/** Build the shield reducer for one body for ONE instance — mirrors
 * combat-resolver.reduceShield. Returns the reduced amount and whether the shield
 * fired (so the EC-003 charge can be spent). Under EC-003, a body that already
 * spent its shield charge passes raw through (shield withheld). */
function reduceShieldFor(
  body: CombatSimBody,
  shieldFirstInstanceOnly: boolean,
): { reduce: (raw: number) => number; fired: () => boolean } {
  let didFire = false;
  const reduce = (raw: number): number => {
    if (shieldFirstInstanceOnly && body.shieldSpent) return raw; // withheld
    const r = applyDamageReplacements(body.card, raw);
    if (r.consumedIds.length > 0) didFire = true;
    return r.amount;
  };
  return { reduce, fired: () => didFire };
}

/** Resolve ONE attacker → target combat instance with the live rule, returning the
 * damage dealt to the target and whether each side dies, then SPEND the consumed
 * first-instance charges on both bodies (so the next swing in the sequence sees the
 * spent ARM/shield, exactly as the engine does). Pure w.r.t. GameState; mutates only
 * the passed sim bodies' charge flags. */
export function simulateCombatExchange(
  attacker: CombatSimBody,
  target: CombatSimBody,
  targetRemainingHp: number,
  config: GameConfig | undefined,
): { damageToTarget: number; targetDestroyed: boolean; attackerDestroyed: boolean } {
  const armFirst = config?.armFirstInstanceOnly === true;
  const shieldFirst = config?.shieldFirstInstanceOnly === true;

  const targetShield = reduceShieldFor(target, shieldFirst);
  const attackerShield = reduceShieldFor(attacker, shieldFirst);

  const result = calculateCombatDamage(
    attacker.card.currentAtk, armFor(attacker, armFirst), attacker.card.currentHp,
    target.card.currentAtk, armFor(target, armFirst), targetRemainingHp,
    traits(attacker.card), traits(target.card),
    targetShield.reduce,
    attackerShield.reduce,
    config?.damageScale ?? 1,
  );

  // Spend first-instance charges, mirroring combat-resolver's post-result block.
  if (armFirst) {
    if (target.card.currentArm > 0) target.armSpent = true;
    if (attacker.card.currentArm > 0) attacker.armSpent = true;
  }
  if (shieldFirst) {
    if (targetShield.fired()) target.shieldSpent = true;
    if (attackerShield.fired()) attacker.shieldSpent = true;
  }

  return {
    damageToTarget: result.damageToDefender,
    targetDestroyed: result.defenderDestroyed,
    attackerDestroyed: result.attackerDestroyed,
  };
}

/**
 * Turn-level combat planning — decides PURPOSEFUL SACRIFICES.
 *
 * The greedy per-attacker value gate (see heuristic.pickCombatTarget) declines
 * every net-negative attack, so the bot never GANGS a key body: it will chip a
 * Defender it can favorably trade with, then give up, leaving the wall standing.
 * That is exactly what props up a heal+Defender+ARM wall — opponents never break
 * through.
 *
 * This module identifies KEY enemy bodies worth removing (Defenders that gate the
 * board from the Hero, and high-value / recurring threats), then checks whether
 * committing MULTIPLE ready attackers can KILL one — correctly accounting for the
 * target's ARM, the -1 "would take damage" shield, the Defender dealing return
 * damage to EACH attacker (combat is sequential, one declaration at a time, and
 * the target loses HP between declarations), and regeneration. When a gang can
 * finish a key body and the removal is worth the bodies spent, it returns the
 * NEXT attack of that plan even though each individual swing is a down-trade.
 *
 * Pure / deterministic: a function of GameState only. No stored plan — each call
 * re-derives the next step from current (already-damaged) board state, so the
 * sequence is stable across the per-action drive loop.
 */
import type { PlayerState, CardInstance, GameConfig } from '../types/game-state.js';
import type { PlayerAction } from '../state-machine/types.js';
import type { Trait } from '../types/common.js';
import type { AttackOption } from '../actions/available-actions.js';
import { simulateCombatExchange, asSimBody } from './combat-sim.js';

/** A ready attacker paired with the live valid-target set the engine offers it. */
interface ReadyAttacker {
  readonly card: CardInstance;
  readonly option: AttackOption;
}

/** The value multiplier that makes breaking a board-gating Defender worth more
 * than the raw stats of the bodies spent: a wall that blocks every path to the
 * Hero (and heals back) is a strategic target, not a fair trade. */
const KEY_DEFENDER_VALUE = 1.6;
/** Plainer "big / recurring threat" multiplier — worth ganging, but not as
 * lopsidedly as a path-gating wall. */
const KEY_THREAT_VALUE = 1.2;
/** A body is a "big" threat worth ganging at this raw power (atk+hp) or above. */
const BIG_THREAT_POWER = 7;

function hasTrait(card: CardInstance, trait: Trait): boolean {
  return card.traits.includes(trait) || card.grantedTraits.some(g => g.trait === trait);
}

function power(card: CardInstance): number {
  return card.currentAtk + card.currentHp;
}

function hasRegen(card: CardInstance): boolean {
  return card.statusEffects.some(s => s.statusType === 'regeneration');
}

/**
 * Plan the turn's combat as a SET and return the single next attack to declare,
 * or null to defer to the greedy positive policy. The caller (chooseCombatAction)
 * first takes any net-positive face/trade; this function only fires when a
 * worthwhile GANG on a key body beats that — i.e. it authorizes purposeful
 * sacrifices the greedy gate would refuse.
 *
 * `gangAggression` is the active seat's gameplan scalar on the key-body value
 * multipliers (KEY_DEFENDER_VALUE / KEY_THREAT_VALUE). Default 1 (NEUTRAL ⇒
 * hardcoded constants) is a byte-identical no-op; higher = more eager to commit
 * multiple bodies into a wall.
 */
export function planGangAttack(
  attackers: readonly ReadyAttacker[],
  opponent: PlayerState,
  config: GameConfig | undefined,
  gangAggression: number = 1,
): { action: PlayerAction; value: number } | null {
  const keyBodies = keyEnemyBodies(attackers, opponent, gangAggression);
  let best: { action: PlayerAction; value: number } | null = null;

  for (const body of keyBodies) {
    const plan = gangPlanFor(body.card, attackers, config);
    if (plan === null) continue; // committed attackers cannot finish it
    // Value the removal in context, then subtract the bodies we lose doing it.
    const removalValue = power(body.card) * body.multiplier;
    const lost = plan.attackersLost.reduce((s, c) => s + power(c), 0);
    const net = removalValue - lost;
    if (net <= 0) continue; // not worth the sacrifice — leave it standing
    if (best === null || net > best.value) {
      best = {
        action: {
          type: 'declare_attack',
          attackerInstanceId: plan.next.instanceId,
          targetId: body.card.instanceId,
        },
        value: net,
      };
    }
  }
  return best;
}

interface KeyBody {
  readonly card: CardInstance;
  readonly multiplier: number;
}

/** Enemy bodies worth removing with a multi-body commitment, most valuable first:
 *  (1) Defenders that gate our board from the Hero (Defender priority forces all
 *      our attacks onto them — they wall the path to the face), and
 *  (2) high-power or regenerating recurring threats.
 * Deterministic order: higher multiplier, then power, then instanceId. */
function keyEnemyBodies(
  attackers: readonly ReadyAttacker[],
  opponent: PlayerState,
  gangAggression: number,
): readonly KeyBody[] {
  // Only consider bodies some ready attacker is actually allowed to target.
  const targetable = new Set<string>();
  for (const a of attackers) {
    for (const t of a.option.validTargets) {
      if (t.type === 'character' && t.instanceId !== null) targetable.add(t.instanceId);
    }
  }

  const seen = new Map<string, KeyBody>();
  const consider = (card: CardInstance, multiplier: number): void => {
    if (!targetable.has(card.instanceId)) return;
    const prev = seen.get(card.instanceId);
    if (prev === undefined || multiplier > prev.multiplier) {
      seen.set(card.instanceId, { card, multiplier });
    }
  };

  const all = [
    ...opponent.zones.reserve, ...opponent.zones.frontline, ...opponent.zones.highGround,
  ].filter((c): c is CardInstance => c !== null);

  for (const c of all) {
    if (hasTrait(c, 'defender')) consider(c, KEY_DEFENDER_VALUE * gangAggression);
    if (power(c) >= BIG_THREAT_POWER || hasRegen(c)) consider(c, KEY_THREAT_VALUE * gangAggression);
  }

  return [...seen.values()].sort(
    (a, b) =>
      b.multiplier - a.multiplier ||
      power(b.card) - power(a.card) ||
      a.card.instanceId.localeCompare(b.card.instanceId),
  );
}

interface GangPlan {
  /** The attacker to declare NEXT (first in the committed sequence). */
  readonly next: CardInstance;
  /** Attackers that die executing the full plan (for valuing the sacrifice). */
  readonly attackersLost: readonly CardInstance[];
}

/**
 * Simulate committing ready attackers into `target` in a deterministic order and
 * decide whether the gang KILLS it. Combat is sequential: each attacker strikes,
 * the target's HP drops, and the target deals return damage to that attacker. The
 * kill-simulation reuses the engine's REAL combat damage model
 * (`simulateCombatExchange`) so the target's ARM and −1 shield are consumed
 * correctly ACROSS the sequence: under EC-002/EC-003 only the FIRST swing is blunted
 * by the target's first-instance ARM/shield charge, and later swings see it spent —
 * matching how `combat-resolver` resolves a real gang. Charges are seeded from the
 * live card flags so a mid-turn (already-damaged) board is modelled correctly. We
 * commit attackers cheapest-body-first so the sacrifice spends our least valuable
 * pieces, stopping as soon as the target is dead. Returns null if even all eligible
 * attackers cannot finish it.
 */
function gangPlanFor(
  target: CardInstance,
  attackers: readonly ReadyAttacker[],
  config: GameConfig | undefined,
): GangPlan | null {
  const eligible = attackers
    .filter(a => a.option.validTargets.some(
      t => t.type === 'character' && t.instanceId === target.instanceId,
    ))
    .filter(a => a.card.currentAtk > 0)
    // Spend the cheapest bodies first; stable tie-break by instanceId.
    .sort((x, y) => power(x.card) - power(y.card) || x.card.instanceId.localeCompare(y.card.instanceId));

  // One target sim body shared across the sequence: its ARM/shield charges persist
  // from swing to swing exactly as the engine consumes them in real combat.
  const targetBody = asSimBody(target);
  let remainingHp = target.currentHp;
  const committed: CardInstance[] = [];
  const lost: CardInstance[] = [];

  for (const a of eligible) {
    if (remainingHp <= 0) break;
    const result = simulateCombatExchange(asSimBody(a.card), targetBody, remainingHp, config);
    committed.push(a.card);
    if (result.attackerDestroyed) lost.push(a.card);
    remainingHp -= result.damageToTarget;
  }

  // A regenerating target heals back at upkeep, so a gang that merely chips it is
  // pointless — only a kill THIS turn counts. (Combat damage still lands now, so
  // a lethal gang is fine; we just require the kill.)
  if (remainingHp > 0) return null;

  const next = committed[0];
  if (next === undefined) return null;
  return { next, attackersLost: lost };
}

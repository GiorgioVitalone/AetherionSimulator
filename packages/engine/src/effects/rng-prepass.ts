/**
 * RNG pre-pass for effect execution.
 *
 * The `dice` AmountExpr and `random` TargetExpr both need the engine's seeded RNG,
 * but the resolvers/evaluators that read them are pure (they take state and return a
 * value, never the advanced RNG). To keep determinism — same seed ⇒ same sequence —
 * the single roll/selection is performed HERE, once, before the effect's handler
 * runs: the RNG counter is advanced on the returned state and the resolved values
 * are threaded onto the EffectContext (`rolledDice` / `selectedTargets`) so the
 * handlers consume them instead of re-rolling.
 *
 * Pure: `(state, effect, context) => { state, context }`.
 */
import type { Effect } from '../types/effects.js';
import type { AmountExpr } from '../types/common.js';
import type { TargetExpr } from '../types/targets.js';
import type { GameState, EffectContext, CardInstance } from '../types/game-state.js';
import { randomInt } from '../setup/rng.js';
import { getAllCards } from '../zones/zone-manager.js';
import { applyFilter, excludeUntargetable } from './target-resolver.js';

export interface RngPrepassResult {
  readonly state: GameState;
  readonly context: EffectContext;
}

/** Roll any `dice` amount and resolve any `random` target on `effect`, advancing
 * the seeded RNG. Returns the (possibly) updated state + context. */
export function rngPrepass(
  state: GameState,
  effect: Effect,
  context: EffectContext,
): RngPrepassResult {
  let current = state;
  let ctx = context;

  const dice = findDiceAmount(effect);
  if (dice !== undefined && ctx.rolledDice === undefined) {
    const rolled = rollDice(current, dice.count, dice.sides);
    current = { ...current, rng: rolled.nextRng };
    ctx = { ...ctx, rolledDice: rolled.total };
  }

  const target = effectTarget(effect);
  if (target?.type === 'random' && ctx.selectedTargets === undefined) {
    const picked = pickRandomTargets(current, target, ctx, diceCount(effect, ctx));
    current = { ...current, rng: picked.nextRng };
    ctx = { ...ctx, selectedTargets: picked.ids };
  }

  return { state: current, context: ctx };
}

/** Roll `count` dice of `sides` via the seeded RNG, summing the faces. */
function rollDice(
  state: GameState,
  count: number,
  sides: number,
): { readonly total: number; readonly nextRng: GameState['rng'] } {
  let total = 0;
  let rng = state.rng;
  for (let i = 0; i < count; i++) {
    const roll = randomInt(rng, 1, sides);
    total += roll.value;
    rng = roll.nextRng;
  }
  return { total, nextRng: rng };
}

/** Pick `count` distinct random cards from the target's legal pool via seeded RNG. */
function pickRandomTargets(
  state: GameState,
  target: Extract<TargetExpr, { type: 'random' }>,
  context: EffectContext,
  count: number,
): { readonly ids: readonly string[]; readonly nextRng: GameState['rng'] } {
  const pool = randomPool(state, target, context);
  // Random targeting must honor the same legality as explicit targeting: a hexproof
  // or unacted-stealth enemy body cannot be hit by the opponent's effects (it is
  // excluded on the normal path via getCardsBySide). Filter battlefield pools the
  // same way; hand pools (random discard) are left alone since those keywords govern
  // being targeted in play, not hand cards.
  const eligible =
    target.zone === 'hand' ? pool : excludeUntargetable(pool, context.controllerId);
  const filtered = applyFilter(eligible, target.filter, context);
  const ids = filtered.map(c => c.instanceId);
  const picks: string[] = [];
  let rng = state.rng;
  const remaining = [...ids];
  const n = Math.min(count, remaining.length);
  for (let i = 0; i < n; i++) {
    const draw = randomInt(rng, 0, remaining.length - 1);
    rng = draw.nextRng;
    picks.push(remaining[draw.value]!);
    remaining.splice(draw.value, 1);
  }
  return { ids: picks, nextRng: rng };
}

/** Candidate cards for a `random` target before the filter is applied. */
function randomPool(
  state: GameState,
  target: Extract<TargetExpr, { type: 'random' }>,
  context: EffectContext,
): readonly CardInstance[] {
  const indices: (0 | 1)[] =
    target.side === 'any'
      ? [0, 1]
      : target.side === 'enemy'
        ? [context.controllerId === 0 ? 1 : 0]
        : [context.controllerId];
  return indices.flatMap(i => {
    const player = state.players[i]!;
    return target.zone === 'hand' ? player.hand : getAllCards(player.zones);
  });
}

/** The effect's primary TargetExpr, if it carries one. */
function effectTarget(effect: Effect): TargetExpr | undefined {
  return 'target' in effect ? effect.target : undefined;
}

/** How many random targets to pick — the effect's count where one applies (discard),
 * else 1. */
function diceCount(effect: Effect, _context: EffectContext): number {
  return effect.type === 'discard' ? effect.count : 1;
}

/** Find a `dice` AmountExpr on the effect: its own amount/count, or nested in an
 * `up_to` target count. Returns the dice node or undefined. */
function findDiceAmount(effect: Effect): Extract<AmountExpr, { type: 'dice' }> | undefined {
  const own = ownAmount(effect);
  if (own?.type === 'dice') return own;
  const target = effectTarget(effect);
  if (target?.type === 'up_to' && typeof target.count !== 'number' && target.count.type === 'dice') {
    return target.count;
  }
  return undefined;
}

/** The AmountExpr an effect carries directly (deal_damage/heal amount, draw count). */
function ownAmount(effect: Effect): AmountExpr | undefined {
  if (effect.type === 'deal_damage' || effect.type === 'heal') return effect.amount;
  if (effect.type === 'draw_cards') return effect.count;
  return undefined;
}

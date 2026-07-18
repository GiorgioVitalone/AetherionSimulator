/**
 * §S3: the detailed effect-valuation core — a [low, high] uncertainty band +
 * PowerFlags around the SAME point value effect-value.ts's plain EffectValue
 * uses. This IS the valuation (per-effect coefficients identical to the
 * pre-S3 scalar path); effect-value.ts's effectStaticValue/sumEffects are thin
 * derived views (`.value`/`.isRemoval` only) over effectStaticValueDetailed /
 * sumEffectsDetailed below — never a second computation, so the scalar can
 * never drift from the interval's midpoint.
 */
import type { AmountExpr, DynamicStatSource, StatModifier } from '../types/common.js';
import type { Duration } from '../types/durations.js';
import type { Effect } from '../types/effects.js';
import type { TargetExpr } from '../types/targets.js';
import type { EffectValue, EffectValueDetailed, PowerFlag } from './types.js';
import { isAlliedCharacter, isEnemyFacing, isEnemyHero, targetSide } from './target-util.js';
import { riskyFlagsOf } from './risky-effects.js';
import { regenerationValue, traitValue } from './trait-scaling.js';
import {
  AOE_WIDTH,
  AVG_BODY_HP,
  AVG_ENEMY_BODY,
  AVG_WEAK_BODY,
  BOUNCE_MULT,
  CARD_TO_HAND,
  CARD_VALUE,
  CONDITIONAL_P,
  CONDITION_DISCOUNT,
  DYNAMIC_AMOUNT_SPREAD,
  EMPTY_SLOTS_EXPECTED,
  EXPECTED_COUNT,
  EXPECTED_X,
  FACE_WEIGHT,
  FLAT_ONE,
  HEAL_URGENCY,
  MAX_EMPTY_SLOTS,
  REMOVAL_WEIGHT,
  RESERVE_TAP_VALUE,
  RESOURCE_VALUE,
  RESOURCE_VALUE_TEMP,
  SAC_COST,
  SELECTION_PREMIUM,
  SELECTION_PREMIUM_HIGH,
  SELECTION_PREMIUM_LOW,
  SHIELD_INSTANCES_PER_TURN,
  STATUS_HIGH_ESTIMATE,
  SYMMETRIC_COST_DISCOUNT,
  TEMPO_WEIGHT,
  TOKEN_BODY_FACTOR,
  triggerRecurrence,
  W_ARM,
  W_ATK,
  W_HP,
} from './weights.js';

const ZERO: EffectValue = { value: 0, isRemoval: false };
const NO_FLAGS: readonly PowerFlag[] = [];
const ZERO_D: EffectValueDetailed = {
  value: 0,
  low: 0,
  high: 0,
  isRemoval: false,
  flags: NO_FLAGS,
};
const FLAT_D: EffectValueDetailed = {
  value: FLAT_ONE,
  low: FLAT_ONE,
  high: FLAT_ONE,
  isRemoval: false,
  flags: NO_FLAGS,
};

/** §V2(c) (round-7): a flat-valued wrapper (scheduled/grant_ability/
 * replacement's `instead`) whose nested effects carry their OWN uncertainty
 * is itself uncertain — the wrapper's flat anchor is widened by the nested
 * effects' own ABSOLUTE spread (nested.low/high around nested.value), not
 * left flat.
 * §W2 (round-8 fix): the prior formulation divided by nested.value, which
 * collapses (or inverts) the spread whenever nested.value is negative or
 * zero — e.g. a negative-conditional probe {value:-0.3, low:-0.5, high:0}
 * produced ratios that flattened low===flat===high. Carrying the ABSOLUTE
 * distances instead (never a division by nested.value) is sign-agnostic:
 * low = flat − (how far nested.value sits above nested.low), high = flat +
 * (how far nested.high sits above nested.value). This provably preserves
 * low <= flat <= high (both max(0, …) terms are non-negative since low <=
 * value <= high is the nested interval's own invariant) and the resulting
 * spread (high − low) equals nested.high − nested.low EXACTLY — strictly
 * wider than the flat point whenever the nested range has any width, for
 * every positive/negative/zero/mixed-sign nested value. */
function widenFlatByNested(
  flat: number,
  nested: EffectValueDetailed,
): { readonly low: number; readonly high: number } {
  const low = flat - Math.max(0, nested.value - nested.low);
  // §H1-4/H1-6 (round-13 fix): the original high only widened by the nested
  // effects' OWN internal spread (nested.high − nested.value) — a wrapper
  // hiding a big but PERFECTLY CERTAIN nested payload (e.g. "next turn, deal
  // 6 to the enemy hero": nested.value === nested.high, no internal spread at
  // all) got NO widening whatsoever, leaving the flat anchor (FLAT_ONE) as a
  // falsely precise ceiling on an effect actually worth many times that. The
  // wrapper cannot be worth LESS than the payload it wraps, so the high bound
  // must also reach at least the nested payload's own magnitude (nested.high)
  // directly, on top of (never instead of) its internal-spread widening.
  const high = Math.max(flat + Math.max(0, nested.high - nested.value), nested.high);
  return { low, high };
}

/** §V2(c): union of the exhaustive risky-flag scan (cost_reduction/
 * search_deck/deploy_from_deck acquisition flags — never carried by
 * sumEffectsDetailed's own point valuation) and sumEffectsDetailed's own
 * flags (conditional/dynamic_amount — never carried by riskyFlagsOf, which
 * only classifies acquisition-shaped effect types). Neither scan alone is
 * exhaustive over PowerFlag; the union is. */
function nestedWrapperFlags(effects: readonly Effect[]): {
  readonly flags: readonly PowerFlag[];
  readonly nested: EffectValueDetailed;
} {
  const nested = sumEffectsDetailed(effects);
  const flags = new Set<PowerFlag>([...nested.flags, ...riskyFlagsOf(effects)]);
  return { flags: [...flags], nested };
}

function assertNever(x: never): never {
  throw new Error(`Unhandled effect node: ${JSON.stringify(x)}`);
}

/** §H1-1 (round-13 fix): `up_to` targets a variable-size CHOSEN set, not a
 * fixed single target — the old flat `isAoE(t) ? AOE_WIDTH : 1` priced
 * `up_to`-2 identically to a single target (isAoE was `false` for `up_to`;
 * see target-util.ts). `all_characters`/`_in_zone` keep the flat AOE_WIDTH
 * expectation (uncounted, board-wide); `up_to` scales with its OWN declared
 * count instead, capped at the same AOE_WIDTH ceiling other multi-target
 * effects use (a declared policy, not a second AoE model) — an `up_to`-N
 * effect is never priced above what a true board-wide AoE would be. A
 * dynamic (non-fixed) count falls back to EXPECTED_COUNT, the same
 * conservative single-estimate anchor other assumed dynamic amounts use. */
function aoeFactor(t: TargetExpr): number {
  if (t.type === 'all_characters' || t.type === 'all_characters_in_zone') return AOE_WIDTH;
  if (t.type === 'up_to') {
    const count = typeof t.count === 'number' ? t.count : EXPECTED_COUNT;
    return Math.min(Math.max(count, 1), AOE_WIDTH);
  }
  return 1;
}

/** §H1-1 (round-13 fix): an `up_to` target's realized count is uncertain even
 * when a fixed max is declared (fewer legal targets may be available at cast
 * time) — flagged the same way other assumed magnitudes are (`dynamic_amount`)
 * rather than inventing a second uncertainty taxonomy for "target-count
 * assumed." */
function targetFlags(t: TargetExpr): readonly PowerFlag[] {
  return t.type === 'up_to' ? ['dynamic_amount'] : NO_FLAGS;
}

function det(
  value: number,
  isRemoval: boolean,
  flags: readonly PowerFlag[] = NO_FLAGS,
): EffectValueDetailed {
  return { value, low: value, high: value, isRemoval, flags };
}

// ── Dynamic amounts (§S3: x_cost / count / event_value span 0..cap) ──────────
export interface AmountRange {
  readonly value: number;
  readonly low: number;
  readonly high: number;
  readonly flags: readonly PowerFlag[];
}

/** §X3 (round-9 fix): the interval machinery's own safety net — reorders/
 * clamps any [low, high] around `value` so low <= value <= high always
 * holds, regardless of what a branch above computed. This is a LAST-RESORT
 * catch-all (defense in depth for any future branch), not the primary fix
 * for a malformed DSL input — see the 'count' case below, which detects a
 * malformed `max` and widens conservatively BEFORE reaching here, rather
 * than letting a bad value collapse the spread into false precision. */
function normalizeRange(r: AmountRange): AmountRange {
  const low = Math.min(r.low, r.value, r.high);
  const high = Math.max(r.low, r.value, r.high);
  return { ...r, low, high };
}

function amountValDetailed(expr: AmountExpr): AmountRange {
  switch (expr.type) {
    case 'fixed':
      return { value: expr.value, low: expr.value, high: expr.value, flags: NO_FLAGS };
    case 'x_cost':
      return {
        value: EXPECTED_X,
        low: 0,
        high: EXPECTED_X * DYNAMIC_AMOUNT_SPREAD,
        flags: ['dynamic_amount'],
      };
    case 'dice': {
      // §R13-2 (round-15 fix): the runtime rolls `count` dice of `sides` and
      // sums the faces (rng-prepass.ts's rollDice, 1..sides per die) — a
      // genuinely variable runtime magnitude that was priced as a zero-width,
      // unflagged mean. The mean stays the midpoint (unchanged); low/high are
      // the honest roll range (all 1s / all max faces), flagged the same way
      // other variable-runtime sources here are.
      const v = expr.count * ((expr.sides + 1) / 2);
      return {
        value: v,
        low: expr.count * 1,
        high: expr.count * expr.sides,
        flags: ['dynamic_amount'],
      };
    }
    case 'count': {
      // §X3 (round-9 fix): the DSL types `max` as a bare optional number — the
      // engine does not validate it, and count max:-1 (or any max < 0) reached
      // here made `v = Math.min(EXPECTED_COUNT, max)` and `cap = max` both
      // negative, so low(0)/value/high(negative) were INVERTED (high < low).
      // Downstream, widenFlatByNested's `Math.max(0, …)` clamps collapsed that
      // inversion to value === low === high — false precision on a malformed
      // input, not a genuine narrow range. A malformed declared max is treated
      // as if absent: widen to the SAME conservative spread an undeclared max
      // gets (never invent a second dynamic-amount model), keeping the
      // dynamic_amount flag either way.
      const malformedMax = expr.max !== undefined && expr.max < 0;
      const declaredMax = malformedMax ? undefined : expr.max;
      const cap = declaredMax ?? EXPECTED_COUNT * DYNAMIC_AMOUNT_SPREAD;
      const v = Math.min(EXPECTED_COUNT, declaredMax ?? EXPECTED_COUNT);
      return normalizeRange({ value: v, low: 0, high: cap, flags: ['dynamic_amount'] });
    }
    case 'event_value':
      return {
        value: EXPECTED_COUNT,
        low: 0,
        high: EXPECTED_COUNT * DYNAMIC_AMOUNT_SPREAD,
        flags: ['dynamic_amount'],
      };
    default:
      return assertNever(expr);
  }
}

function modifierGain(m: StatModifier): number {
  return (m.atk ?? 0) + (m.hp ?? 0) + (m.arm ?? 0);
}

/** §V2(b) (round-7): exported so card-power.ts's stat_grant path can value
 * StatGrantDSL.dynamicModifier through the SAME dynamic-bonus computation
 * modify_stats effects use — never a second dynamic-amount model. */
export function dynamicBonusDetailed(dyn: DynamicStatSource | undefined): AmountRange {
  if (dyn === undefined) return { value: 0, low: 0, high: 0, flags: NO_FLAGS };
  switch (dyn.type) {
    case 'per_count': {
      const v = dyn.valuePerCount * EXPECTED_COUNT;
      const spread = dyn.valuePerCount * EXPECTED_COUNT * DYNAMIC_AMOUNT_SPREAD;
      return normalizeRange({
        value: v,
        low: Math.min(0, spread),
        high: Math.max(0, spread),
        flags: ['dynamic_amount'],
      });
    }
    case 'equals_stat':
      // §R12-4 (round-14 fix): the runtime (amount-evaluator.ts's
      // equals_stat evaluation) grants the TARGET'S LIVE stat, not a fixed
      // AVG_BODY_HP — a 0-stat target grants +0, a high-stat target grants
      // far more than the midpoint. Was priced as a zero-width, unflagged
      // fixed point; widened to the same [0, EXPECTED × SPREAD] policy the
      // other dynamic-amount cases here use (never a second model), midpoint
      // unchanged.
      return normalizeRange({
        value: AVG_BODY_HP,
        low: 0,
        high: AVG_BODY_HP * DYNAMIC_AMOUNT_SPREAD,
        flags: ['dynamic_amount'],
      });
    case 'x_cost':
      return {
        value: EXPECTED_X,
        low: 0,
        high: EXPECTED_X * DYNAMIC_AMOUNT_SPREAD,
        flags: ['dynamic_amount'],
      };
    case 'multiply': {
      // §13c repair (was 0 — zeroed Synthetic Evolution entirely): multiplying a
      // body's stats by k adds (k−1) × its stats. Priced per affected body at the
      // conservative AVG_WEAK_BODY anchor; AoE width multiplies in buffValueDetailed.
      // §R12-4 (round-14 fix): the real gain scales with each live target's
      // OWN stats, not the fixed AVG_WEAK_BODY anchor — was zero-width and
      // unflagged. Widened to the same [0, value × SPREAD] policy other
      // dynamic-amount cases use, midpoint unchanged.
      // §R13-2 (round-15 fix): `Math.max(0, factor - 1)` zeroed the ENTIRE case
      // for factor < 1 (a SHRINK/zero debuff — e.g. factor:0 zeroes the
      // target's stats — amount-evaluator.ts applies currentStat*(factor-1)
      // regardless of direction) — a body-shrink is worth its magnitude just
      // like a body-buff, not nothing. Switched to the absolute magnitude of
      // the stat change for BOTH directions; sign/target-side accounting
      // (allied-buff vs enemy-debuff) is left to the caller (valueForTotal),
      // the same sign-agnostic-magnitude convention `equals_stat` above
      // already uses — never a second sign model.
      const v = Math.abs(dyn.factor - 1) * AVG_WEAK_BODY;
      return normalizeRange({
        value: v,
        low: 0,
        high: v * DYNAMIC_AMOUNT_SPREAD,
        flags: ['dynamic_amount'],
      });
    }
    default:
      return assertNever(dyn);
  }
}

function dmgToEffectValue(dmg: number, target: TargetExpr): EffectValue {
  if (isEnemyHero(target)) return { value: dmg * FACE_WEIGHT, isRemoval: false };
  if (!isEnemyFacing(target)) return ZERO;
  const kill = dmg >= AVG_BODY_HP;
  const per = kill ? AVG_ENEMY_BODY * REMOVAL_WEIGHT : Math.min(dmg, AVG_BODY_HP);
  return { value: per * aoeFactor(target), isRemoval: kill };
}

function damageValueDetailed(amount: AmountExpr, target: TargetExpr): EffectValueDetailed {
  const a = amountValDetailed(amount);
  const pt = dmgToEffectValue(a.value, target);
  const lo = dmgToEffectValue(a.low, target);
  const hi = dmgToEffectValue(a.high, target);
  const values = [pt.value, lo.value, hi.value];
  return {
    value: pt.value,
    low: Math.min(...values),
    high: Math.max(...values),
    isRemoval: pt.isRemoval,
    flags: [...new Set<PowerFlag>([...a.flags, ...targetFlags(target)])],
  };
}

/** Core buff/debuff formula, shared by the point and the low/high bounds — the
 * ONLY place the sign-branch logic lives (§S3: no duplicated valuation). */
function valueForTotal(total: number, target: TargetExpr): EffectValue {
  if (total < 0) {
    if (targetSide(target) === 'allied') return ZERO; // self-drawback rider, not a weapon
    return { value: Math.min(Math.abs(total), AVG_BODY_HP) * aoeFactor(target), isRemoval: false };
  }
  if (targetSide(target) === 'enemy') return ZERO; // positive buff on enemies: worthless
  return { value: total * aoeFactor(target) * TEMPO_WEIGHT, isRemoval: false };
}

// Sign decides buff vs debuff (an `any`-side target says nothing — Haunting's
// -ATK is cast at enemies, a +stat "any" is cast at allies). §13 repair: the
// old enemy-facing branch dropped both the dynamic part and the AoE width.
function buffValueDetailed(
  modifier: StatModifier,
  dyn: DynamicStatSource | undefined,
  target: TargetExpr,
  duration: Duration,
): EffectValueDetailed {
  const mg = modifierGain(modifier);
  const d = dynamicBonusDetailed(dyn);
  const total = mg + d.value;
  const pt = valueForTotal(total, target);
  const lo = valueForTotal(mg + d.low, target);
  const hi = valueForTotal(mg + d.high, target);
  const values = [pt.value, lo.value, hi.value];
  let high = Math.max(...values);
  const flags = new Set<PowerFlag>([...d.flags, ...targetFlags(target)]);
  // §H1-9 (round-13 fix): `duration` was ignored entirely — a PERMANENT ally
  // buff (equipment-style, no expiry) priced identically to an
  // until-end-of-turn pump, both capped by the SAME TEMPO_WEIGHT-discounted
  // value. The scalar midpoint keeps that discount (a calibration ripple,
  // out of this fix's scope — see the file header's flat-family policy); the
  // HIGH bound for a PERMANENT, POSITIVE, non-enemy total widens toward the
  // undiscounted per-point unit statBase itself uses (W_ATK/W_HP=1.0, no
  // TEMPO_WEIGHT haircut beyond the target's own aoeFactor width) — the
  // honest ceiling for a stat gain that never expires. A PERMANENT debuff
  // keeps its existing AVG_BODY_HP-capped value (safe direction, already
  // conservative relative to a true permanent cripple — disclosed here
  // rather than additionally re-modeled, mirroring H1-12's disclosure-only
  // treatment of counter_spell's unlessPay).
  if (duration.type === 'permanent' && total > 0 && targetSide(target) !== 'enemy') {
    const undiscounted = (mg + Math.max(d.value, d.high)) * aoeFactor(target);
    high = Math.max(high, undiscounted);
    flags.add('dynamic_amount');
  }
  return {
    value: pt.value,
    low: Math.min(...values),
    high,
    isRemoval: pt.isRemoval,
    flags: [...flags],
  };
}

/** Detailed sibling of sumEffects — additive low/high bounds, unioned flags. */
export function sumEffectsDetailed(effects: readonly Effect[]): EffectValueDetailed {
  let value = 0;
  let low = 0;
  let high = 0;
  let isRemoval = false;
  const flagSet = new Set<PowerFlag>();
  for (const e of effects) {
    const part = effectStaticValueDetailed(e);
    value += part.value;
    low += part.low;
    high += part.high;
    if (part.isRemoval) isRemoval = true;
    for (const f of part.flags) flagSet.add(f);
  }
  return { value, low, high, isRemoval, flags: [...flagSet] };
}

/** Detailed sibling of effectStaticValue — the one core valuation path. */
export function effectStaticValueDetailed(effect: Effect): EffectValueDetailed {
  switch (effect.type) {
    case 'destroy':
    case 'sacrifice':
      return isEnemyFacing(effect.target)
        ? det(
            AVG_ENEMY_BODY * REMOVAL_WEIGHT * aoeFactor(effect.target),
            true,
            targetFlags(effect.target),
          )
        : isAlliedCharacter(effect.target)
          ? det(-AVG_WEAK_BODY * SAC_COST, false)
          : ZERO_D;
    case 'bounce':
      // §H1-10 (round-13 fix): a non-enemy-facing bounce (an ALLIED target)
      // was scored a flat 0 — the runtime lets you bounce your OWN character,
      // re-triggering its on_deploy / re-selling equipment (a real, if
      // situational, reuse tool), not a no-op. The point stays 0 (bouncing
      // your own body is a tempo LOSS most of the time — no honest single
      // anchor to replace the midpoint with), but the interval widens up to
      // CARD_TO_HAND (the shared acquisition primitive — at best, this is
      // "return one card to hand" reuse value), flagged as an assumed magnitude.
      return isEnemyFacing(effect.target)
        ? det(
            AVG_ENEMY_BODY * BOUNCE_MULT * REMOVAL_WEIGHT * aoeFactor(effect.target),
            true,
            targetFlags(effect.target),
          )
        : { value: 0, low: 0, high: CARD_TO_HAND, isRemoval: false, flags: ['dynamic_amount'] };
    case 'deal_damage':
      return damageValueDetailed(effect.amount, effect.target);
    case 'modify_stats':
      return buffValueDetailed(
        effect.modifier,
        effect.dynamicModifier,
        effect.target,
        effect.duration,
      );
    case 'draw_cards': {
      // §S1: routed through CARD_TO_HAND, the shared acquisition primitive (an
      // unselected card — no SELECTION_PREMIUM). CARD_TO_HAND === W_DRAW, so
      // this is numerically unchanged from the empirical 2026-07-14 anchor.
      if (effect.player === 'enemy') return ZERO_D;
      const a = amountValDetailed(effect.count);
      return {
        value: a.value * CARD_TO_HAND,
        low: a.low * CARD_TO_HAND,
        high: a.high * CARD_TO_HAND,
        isRemoval: false,
        flags: a.flags,
      };
    }
    case 'heal': {
      // §13 repair: `any`-side heals are cast on YOUR side (the enemy-facing
      // convention is for damage/removal); heal-ALL was missing the AoE width.
      if (targetSide(effect.target) === 'enemy') return ZERO_D;
      const a = amountValDetailed(effect.amount);
      const mult = HEAL_URGENCY * aoeFactor(effect.target);
      return {
        value: a.value * mult,
        low: a.low * mult,
        high: a.high * mult,
        isRemoval: false,
        flags: a.flags,
      };
    }
    case 'gain_resource': {
      // §13 repair: a banked resource ≈ ACCEL_RAMP_TEMPO stats of tempo (was 1.0).
      // §R13-2 (round-15 fix): mana/energy gains are genuinely spendable at
      // full value (cost-checker.ts's getAvailableResources counts them) —
      // unchanged, still a flat point. A `flexible` gain is NOT: the same
      // getAvailableResources only tallies mana/energy, so a banked flexible
      // resource cannot pay any cost today — its real utility is uncertain
      // (0 if the runtime is never fixed, full if it is), not a safe flat
      // point. Also ties to the loop detector's D24 treatment, which already
      // drops flexible resources to their LOW (unspendable) bound for the
      // same reason.
      const unit = effect.temporary === true ? RESOURCE_VALUE_TEMP : RESOURCE_VALUE;
      if (effect.resourceType === 'flexible') {
        const full = effect.amount * unit;
        return {
          value: full * 0.5,
          low: 0,
          high: full,
          isRemoval: false,
          flags: ['dynamic_amount'],
        };
      }
      return det(effect.amount * unit, false);
    }
    case 'deploy_token': {
      // §13 repair: tokens are real bodies (were priced at half stats, no traits,
      // no zone). A Reserve token additionally taps +1 temp resource per turn
      // (Rulebook 8 Upkeep 4) — the battery the §12c run measured.
      const t = effect.token;
      const stats = t.atk * W_ATK + t.hp * W_HP + (t.arm ?? 0) * W_ARM;
      let per = stats * TOKEN_BODY_FACTOR;
      const tokenStats = { atk: t.atk, hp: t.hp, arm: t.arm ?? 0 };
      for (const tr of t.traits ?? []) per += traitValue(tr, tokenStats, {});
      if (effect.zone === 'reserve') per += RESERVE_TAP_VALUE;
      // §R13-2 (round-15 fix): `inEachEmpty` deploys into the ACTUAL empty
      // slots at cast time (0 when the zone is already full, up to the zone's
      // capacity — interpreter.ts's executeDeployToken), not a fixed
      // EMPTY_SLOTS_EXPECTED count — was a zero-width, unflagged point. The
      // fixed-count branch (a declared, non-inEachEmpty count) stays
      // deterministic — that magnitude IS statically known.
      if (effect.inEachEmpty === true) {
        const v = per * EMPTY_SLOTS_EXPECTED;
        return {
          value: v,
          low: 0,
          high: per * MAX_EMPTY_SLOTS,
          isRemoval: false,
          flags: ['dynamic_amount'],
        };
      }
      return det(per * effect.count, false);
    }
    case 'counter_spell':
      // §13 repair: a counter trades 1-for-1 with the opponent's CHOSEN best
      // spell (≥ a card) plus initiative — 0.5 was the legacy bot's blind spot.
      // §H1-12 (round-13, disclosure only): `unlessPay` (a SOFT counter — the
      // opponent can pay to negate it) is not priced down here. Safe
      // direction (over-values soft counters rather than under-valuing hard
      // ones), left un-widened by design — the same disclosure-only
      // treatment as this file's other confirmed-safe-direction gaps.
      return det(CARD_VALUE + 0.5, false);
    case 'deploy_from_deck':
      return det(4, false);
    case 'composite':
      return sumEffectsDetailed(effect.effects);
    case 'conditional': {
      // §S3: the scalar keeps the CONDITIONAL_P-weighted midpoint; the interval
      // spans [ifFalse-only, ifTrue-only] (each bound itself widened by any
      // nested uncertainty in that branch).
      const t = sumEffectsDetailed(effect.ifTrue);
      const f = effect.ifFalse ? sumEffectsDetailed(effect.ifFalse) : ZERO_D;
      return {
        value: CONDITIONAL_P * t.value + (1 - CONDITIONAL_P) * f.value,
        low: Math.min(t.low, f.low),
        high: Math.max(t.high, f.high),
        isRemoval: t.isRemoval,
        flags: [...new Set<PowerFlag>(['conditional', ...t.flags, ...f.flags])],
      };
    }
    case 'choose_one': {
      // §P1 (R3 fix): the point/interval value keeps picking the best option
      // (unchanged semantics), but flags must union ALL options — a risky
      // shape (selection/recursion/dynamic_amount/...) sitting in a
      // non-selected branch is still a real, reachable shape of this card.
      let best = ZERO_D;
      const allFlags = new Set<PowerFlag>();
      for (const opt of effect.options) {
        const s = sumEffectsDetailed(opt.effects);
        for (const f of s.flags) allFlags.add(f);
        if (s.value > best.value) best = s;
      }
      return { ...best, flags: [...allFlags] };
    }
    case 'return_from_discard': {
      // §S1: reanimating a CHOSEN card from discard is a selection, not a blind
      // draw — the acquisition term is CARD_TO_HAND × SELECTION_PREMIUM whether
      // it lands in hand or on the battlefield (which additionally gets the body).
      // §S3: the acquisition premium spans [blind draw, premium²]; the body
      // component (battlefield destination) is not uncertain.
      const body = effect.destination === 'battlefield' ? AVG_WEAK_BODY : 0;
      const acquisition = CARD_TO_HAND * SELECTION_PREMIUM;
      const acqLow = CARD_TO_HAND * SELECTION_PREMIUM_LOW;
      const acqHigh = CARD_TO_HAND * SELECTION_PREMIUM_HIGH;
      return {
        value: body + acquisition,
        low: body + acqLow,
        high: body + acqHigh,
        isRemoval: false,
        flags: ['selection', 'recursion'],
      };
    }
    case 'search_deck': {
      // §S1: a tutor takes a CHOSEN card of the whole deck to hand — the shared
      // acquisition primitive with the selection premium (was CARD_VALUE ×
      // SELECTION_MULT_DECK). Battlefield destination unchanged (flat deploy value).
      // §H1-13 (round-13 fix): this local flag set omitted `castForFree`
      // (only checked `castFreeIfCost`), unlike risky-effects.ts's
      // classifyEffect scan of the SAME effect shape at the card level —
      // one-line consistency fix, no new policy.
      const flags: PowerFlag[] = ['selection'];
      if (effect.castFreeIfCost !== undefined || effect.castForFree === true) {
        flags.push('free_cast');
      }
      if (effect.destination === 'battlefield') return det(4, false, flags);
      return {
        value: CARD_TO_HAND * SELECTION_PREMIUM,
        low: CARD_TO_HAND * SELECTION_PREMIUM_LOW,
        high: CARD_TO_HAND * SELECTION_PREMIUM_HIGH,
        isRemoval: false,
        flags,
      };
    }
    case 'copy_card':
      // §S1: a copy of a CHOSEN card from a known pile ≈ a tutor (was CARD_VALUE
      // × SELECTION_MULT_DISCARD). The degenerate self-copy case is handled by
      // the loop guards, not by pricing it higher.
      return {
        value: CARD_TO_HAND * SELECTION_PREMIUM,
        low: CARD_TO_HAND * SELECTION_PREMIUM_LOW,
        high: CARD_TO_HAND * SELECTION_PREMIUM_HIGH,
        isRemoval: false,
        flags: ['selection', 'recursion'],
      };
    case 'scry': {
      // §S1: action-aware. Rearrange-only keeps the pure viewing value; any
      // action that lands cards in hand additionally prices those as CHOSEN
      // acquisitions (you saw the pile and picked) on top of the viewing value.
      const viewValue = Math.min(effect.lookCount, 3) * 0.3;
      const toHandCount =
        effect.action.type === 'pick_and_remainder'
          ? effect.action.pickCount
          : effect.action.type === 'distribute'
            ? effect.action.destinations.filter((d) => d === 'hand').length
            : 0;
      return {
        value: viewValue + toHandCount * CARD_TO_HAND * SELECTION_PREMIUM,
        low: viewValue + toHandCount * CARD_TO_HAND * SELECTION_PREMIUM_LOW,
        high: viewValue + toHandCount * CARD_TO_HAND * SELECTION_PREMIUM_HIGH,
        isRemoval: false,
        flags: toHandCount > 0 ? ['selection'] : NO_FLAGS,
      };
    }
    case 'discard':
      // §H1-7 (round-13 fix): `each_player` scored 0 (isEnemyFacing checks
      // `'side' in t`, and EachPlayer has no `side` field) even though the
      // runtime forces BOTH players — including the opponent — to discard
      // (effect-interval.ts's caller). Valued as the shared enemy-facing
      // discard anchor, discounted for the symmetric cost (weights.ts's
      // SYMMETRIC_COST_DISCOUNT) since you pay the same price.
      if (effect.target.type === 'each_player') {
        return det(effect.count * CARD_VALUE * 0.8 * SYMMETRIC_COST_DISCOUNT, false, [
          'dynamic_amount',
        ]);
      }
      return det(isEnemyFacing(effect.target) ? effect.count * CARD_VALUE * 0.8 : 0, false);
    case 'replacement':
      // §S2 round-5 correction: an EC-003 shield (on_would_take_damage
      // reduction — Shieldbearer Paladin id48, Radiant Shield id66) is NOT
      // covered by the v1 lock (only armFirstInstanceOnly is locked — see
      // valuation-profile.ts); shieldFirstInstanceOnly is unset in v1, so the
      // engine's per-instance default applies: the shield mitigates EVERY
      // combat instance the body takes in a turn, not just one. Valued as its
      // reduction amount x SHIELD_INSTANCES_PER_TURN (the Rulebook's own
      // worked ARM example — two attacks landing on one body in a turn —
      // reused as the expected per-turn instance count, not invented); the
      // wrapping ability's OWN recurrence (almost always 'aura' ->
      // card-power.ts's abilityContribution -> AURA_REC, "active every turn
      // in play") supplies the separate "over ~N expected active turns"
      // multiplier, so no second turns-counter is invented here.
      // on_would_be_destroyed is a different (rarer) replacement mechanic,
      // unrelated to the ARM/shield rule, and keeps the generic FLAT bucket.
      // §S3: flagged rules_sensitive — this value hangs on the locked v1 profile.
      // §V1 (round-7): oncePerTurn:true (Radiant Shield id66) mitigates only
      // ONE combat instance per turn — the runtime honors this in
      // replacement-handler.ts (`if (repl.oncePerTurn && repl.usedThisTurn)
      // continue`), so the static ×SHIELD_INSTANCES_PER_TURN multiplier only
      // applies when the shield is UNTHROTTLED (absent/false — Shieldbearer
      // Paladin id48); a throttled shield is ×1.
      // §V1: `reduction` absent is NOT "reduction=1" — replacement-handler.ts's
      // applyDamageReplacements treats an undefined reduction as full
      // prevention ("no reduction value ⇒ prevent all"), a fundamentally
      // different, incoming-damage-dependent mechanic. Priced at the generic
      // FLAT anchor (not derived from instances), widened
      // [FLAT_ONE, AVG_BODY_HP × instances] to span "barely relevant" through
      // "prevents a full average hit every instance."
      // reduction clamped ≥ 0: the DSL types it as a bare number, and a negative
      // value would otherwise SUBTRACT defense ×2 — nonsense data must not
      // underprice a card (round-5 review hunt, 2026-07-16).
      if (effect.replaces.type === 'on_would_take_damage') {
        const instances = effect.oncePerTurn === true ? 1 : SHIELD_INSTANCES_PER_TURN;
        const reduction = effect.replaces.reduction;
        if (reduction === undefined) {
          return {
            value: FLAT_ONE,
            low: FLAT_ONE,
            high: AVG_BODY_HP * instances,
            isRemoval: false,
            flags: ['rules_sensitive'],
          };
        }
        return det(Math.max(0, reduction) * instances, false, ['rules_sensitive']);
      }
      // §P1 (R3 fix): on_would_be_destroyed keeps the generic FLAT bucket for
      // its VALUE, but must still surface any risky flag (e.g. a nested
      // cost_reduction/acquisition inside `instead`) instead of dropping it.
      // §V2(c) (round-7): flags AND interval now come from the full union scan
      // (conditional/dynamic_amount included, not just acquisition flags).
      {
        const { flags, nested } = nestedWrapperFlags(effect.instead);
        const { low, high } = widenFlatByNested(FLAT_ONE, nested);
        return { value: FLAT_ONE, low, high, isRemoval: false, flags };
      }
    case 'scheduled': {
      // §P1 (R3 fix): flat VALUE by design (§S2/§S3), but nested flags
      // (e.g. a cost_reduction wrapped in a scheduled effect) must propagate.
      // §V2(c) (round-7): full union flags + interval widened by the nested
      // effects' own uncertainty (a scheduled conditional/dynamic_amount is
      // still uncertain, even though the wrapper's own value is flat).
      const { flags, nested } = nestedWrapperFlags(effect.effects);
      const { low, high } = widenFlatByNested(FLAT_ONE, nested);
      // §X1 (round-9 fix): ScheduledEffect can carry its OWN `condition` (the
      // runtime enforces it — scheduled-handler.ts's executeScheduled stores
      // it on the ScheduledEntry and processScheduledEffects gates firing on
      // it), which static valuation previously ignored entirely — a
      // conditionally-scheduled effect (Mana Tide) scored flat/flagless just
      // like an unconditional one. Same policy as GrantedAbilityRef.condition
      // (§W1, round-8): midpoint discounted by CONDITION_DISCOUNT (may not
      // always fire), low collapses to 0 (may never fire), high is the
      // UNDISCOUNTED nested-widened high (always firing can at most reach the
      // full value).
      if (effect.condition !== undefined) {
        return {
          value: FLAT_ONE * CONDITION_DISCOUNT,
          low: 0,
          high,
          isRemoval: false,
          flags: [...new Set<PowerFlag>([...flags, 'conditional'])],
        };
      }
      return { value: FLAT_ONE, low, high, isRemoval: false, flags };
    }
    case 'grant_ability': {
      // §P1 (R3 fix): same — the granted ability's OWN effects (a nested
      // cost_reduction/acquisition) must surface, not just this wrapper's flat
      // catch-all value. §V2(c): full union flags + interval widening.
      const { flags, nested } = nestedWrapperFlags(effect.ability.effects);
      const { low, high: rawHigh } = widenFlatByNested(FLAT_ONE, nested);
      // §H1-5 (round-13 fix): the granted ability, once attached, fires at
      // its OWN trigger's expected recurrence (weights.ts's triggerRecurrence
      // — the SAME per-Trigger lookup card-power.ts's recurrence() uses for a
      // card's native abilities, never a second recurrence model), not just
      // once — the prior widenFlatByNested-only high capped a REPEATABLE
      // granted ability (e.g. "gains: on_deal_damage, deal 2 damage") at a
      // single firing's worth.
      const grantedRec = triggerRecurrence(effect.ability.trigger);
      const high = Math.max(FLAT_ONE, rawHigh * grantedRec);
      // §W1 (round-8 fix): a GrantedAbilityRef can carry its OWN `condition`
      // (the runtime enforces it — grantAbilityToCard/interpreter.ts wires
      // ref.condition straight into the registered trigger's condition), which
      // static valuation previously ignored entirely — a conditionally-granted
      // ability scored flat/flagless just like an unconditional one. Mirrors
      // the ability-level Condition treatment card-power.ts's
      // Granted-ability `condition` (§W1, round-8): midpoint discounted by
      // CONDITION_DISCOUNT (may not always fire), low collapses to 0 (may never
      // fire), high is the UNDISCOUNTED nested-widened high (always fires can at
      // most reach the full value — round-8 review corrected an erroneous
      // `high / CONDITION_DISCOUNT` here that over-widened 1.43x; safe direction,
      // but not the exact [never, always] band this comment promises).
      if (effect.ability.condition !== undefined) {
        return {
          value: FLAT_ONE * CONDITION_DISCOUNT,
          low: 0,
          high,
          isRemoval: false,
          flags: [...new Set<PowerFlag>([...flags, 'conditional'])],
        };
      }
      return { value: FLAT_ONE, low, high, isRemoval: false, flags };
    }
    case 'grant_trait': {
      // §H1-2 (round-13 fix): FLAT_ONE ignored WHICH trait, how many bodies
      // (AoE/up_to), and how long (duration) — a "grant Flying to all allies
      // permanently" and a "grant Swift to one ally this turn" priced
      // identically. Scalar midpoint stays the flat anchor (policy: flat
      // midpoints unchanged — see file header); the HIGH bound widens toward
      // an honest magnitude proxy: traitValue's OWN per-trait formula
      // (trait-scaling.ts, already used for token traits above), evaluated
      // against a generic average body (AVG_BODY_HP for both atk/hp — no
      // fresh stat anchor invented) and the target's own aoeFactor width.
      const avgStats = { atk: AVG_BODY_HP, hp: AVG_BODY_HP, arm: 0 };
      const estimate = Math.abs(traitValue(effect.trait, avgStats, {})) * aoeFactor(effect.target);
      return {
        value: FLAT_ONE,
        low: FLAT_ONE,
        high: Math.max(FLAT_ONE, estimate),
        isRemoval: false,
        flags: [...new Set<PowerFlag>(['dynamic_amount', ...targetFlags(effect.target)])],
      };
    }
    case 'apply_status': {
      // §H1-3 (round-13 fix): FLAT_ONE ignored the status/value/duration/AoE
      // — same false-precision family as grant_trait above. Scalar midpoint
      // unchanged; the HIGH bound widens via a declared per-status table
      // (weights.ts's STATUS_HIGH_ESTIMATE) — `regeneration` instead routes
      // through the existing regenerationValue formula (never a second regen
      // model), scaled by the target's own aoeFactor width.
      const base =
        effect.status === 'regeneration'
          ? regenerationValue(effect.value ?? 1, AVG_BODY_HP)
          : STATUS_HIGH_ESTIMATE[effect.status];
      const estimate = base * aoeFactor(effect.target);
      return {
        value: FLAT_ONE,
        low: FLAT_ONE,
        high: Math.max(FLAT_ONE, estimate),
        isRemoval: false,
        flags: [...new Set<PowerFlag>(['dynamic_amount', ...targetFlags(effect.target)])],
      };
    }
    case 'cost_reduction': {
      // §H1-8 (round-13 fix): FLAT_ONE ignored the reduction amount and how
      // broadly/long it applies — the RISK channel (a free/near-free cast) is
      // already covered by the `free_cast` flag (risky-effects.ts scans this
      // exact shape); this widens the remaining TEMPO magnitude gap. Reused
      // primitives only: RESOURCE_VALUE (a banked resource's tempo worth) and
      // EXPECTED_COUNT (the same "assumed dynamic count" anchor dynamic
      // amounts use) as the expected-uses multiplier for a broad, persisting
      // reducer (no tag filter, permanent/while-in-play duration); a
      // one-shot or tag-narrowed reducer is assumed to apply once.
      const isPersistent =
        effect.duration.type === 'permanent' || effect.duration.type === 'while_in_play';
      const isBroad = effect.appliesTo.tag === undefined;
      const expectedUses = isPersistent && isBroad ? EXPECTED_COUNT : 1;
      const estimate = effect.reduction * RESOURCE_VALUE * expectedUses;
      return {
        value: FLAT_ONE,
        low: FLAT_ONE,
        high: Math.max(FLAT_ONE, estimate),
        isRemoval: false,
        flags: ['dynamic_amount'],
      };
    }
    case 'move':
    case 'cleanse':
    case 'shuffle_into_deck':
    case 'attach_as_equipment':
      return FLAT_D;
    default:
      return assertNever(effect);
  }
}

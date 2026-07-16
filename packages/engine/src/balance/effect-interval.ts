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
import type { Effect } from '../types/effects.js';
import type { TargetExpr } from '../types/targets.js';
import type { EffectValue, EffectValueDetailed, PowerFlag } from './types.js';
import { isAlliedCharacter, isAoE, isEnemyFacing, isEnemyHero, targetSide } from './target-util.js';
import { riskyFlagsOf } from './risky-effects.js';
import { traitValue } from './trait-scaling.js';
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
  REMOVAL_WEIGHT,
  RESERVE_TAP_VALUE,
  RESOURCE_VALUE,
  RESOURCE_VALUE_TEMP,
  SAC_COST,
  SELECTION_PREMIUM,
  SELECTION_PREMIUM_HIGH,
  SELECTION_PREMIUM_LOW,
  SHIELD_INSTANCES_PER_TURN,
  TEMPO_WEIGHT,
  TOKEN_BODY_FACTOR,
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
  const high = flat + Math.max(0, nested.high - nested.value);
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

function aoeFactor(t: TargetExpr): number {
  return isAoE(t) ? AOE_WIDTH : 1;
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
      const v = expr.count * ((expr.sides + 1) / 2);
      return { value: v, low: v, high: v, flags: NO_FLAGS };
    }
    case 'count': {
      const cap = expr.max ?? EXPECTED_COUNT * DYNAMIC_AMOUNT_SPREAD;
      const v = Math.min(EXPECTED_COUNT, expr.max ?? EXPECTED_COUNT);
      return { value: v, low: 0, high: cap, flags: ['dynamic_amount'] };
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
      return {
        value: v,
        low: Math.min(0, spread),
        high: Math.max(0, spread),
        flags: ['dynamic_amount'],
      };
    }
    case 'equals_stat':
      return { value: AVG_BODY_HP, low: AVG_BODY_HP, high: AVG_BODY_HP, flags: NO_FLAGS };
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
      const v = Math.max(0, dyn.factor - 1) * AVG_WEAK_BODY;
      return { value: v, low: v, high: v, flags: NO_FLAGS };
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
    flags: a.flags,
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
): EffectValueDetailed {
  const mg = modifierGain(modifier);
  const d = dynamicBonusDetailed(dyn);
  const pt = valueForTotal(mg + d.value, target);
  const lo = valueForTotal(mg + d.low, target);
  const hi = valueForTotal(mg + d.high, target);
  const values = [pt.value, lo.value, hi.value];
  return {
    value: pt.value,
    low: Math.min(...values),
    high: Math.max(...values),
    isRemoval: pt.isRemoval,
    flags: d.flags,
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
        ? det(AVG_ENEMY_BODY * REMOVAL_WEIGHT * aoeFactor(effect.target), true)
        : isAlliedCharacter(effect.target)
          ? det(-AVG_WEAK_BODY * SAC_COST, false)
          : ZERO_D;
    case 'bounce':
      return isEnemyFacing(effect.target)
        ? det(AVG_ENEMY_BODY * BOUNCE_MULT * REMOVAL_WEIGHT * aoeFactor(effect.target), true)
        : ZERO_D;
    case 'deal_damage':
      return damageValueDetailed(effect.amount, effect.target);
    case 'modify_stats':
      return buffValueDetailed(effect.modifier, effect.dynamicModifier, effect.target);
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
    case 'gain_resource':
      // §13 repair: a banked resource ≈ ACCEL_RAMP_TEMPO stats of tempo (was 1.0).
      return det(
        effect.amount * (effect.temporary === true ? RESOURCE_VALUE_TEMP : RESOURCE_VALUE),
        false,
      );
    case 'deploy_token': {
      // §13 repair: tokens are real bodies (were priced at half stats, no traits,
      // no zone). A Reserve token additionally taps +1 temp resource per turn
      // (Rulebook 8 Upkeep 4) — the battery the §12c run measured.
      const n = effect.inEachEmpty === true ? EMPTY_SLOTS_EXPECTED : effect.count;
      const t = effect.token;
      const stats = t.atk * W_ATK + t.hp * W_HP + (t.arm ?? 0) * W_ARM;
      let per = stats * TOKEN_BODY_FACTOR;
      const tokenStats = { atk: t.atk, hp: t.hp, arm: t.arm ?? 0 };
      for (const tr of t.traits ?? []) per += traitValue(tr, tokenStats, {});
      if (effect.zone === 'reserve') per += RESERVE_TAP_VALUE;
      return det(per * n, false);
    }
    case 'counter_spell':
      // §13 repair: a counter trades 1-for-1 with the opponent's CHOSEN best
      // spell (≥ a card) plus initiative — 0.5 was the legacy bot's blind spot.
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
      const flags: PowerFlag[] = ['selection'];
      if (effect.castFreeIfCost !== undefined) flags.push('free_cast');
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
      return { value: FLAT_ONE, low, high, isRemoval: false, flags };
    }
    case 'grant_ability': {
      // §P1 (R3 fix): same — the granted ability's OWN effects (a nested
      // cost_reduction/acquisition) must surface, not just this wrapper's flat
      // catch-all value. §V2(c): full union flags + interval widening.
      const { flags, nested } = nestedWrapperFlags(effect.ability.effects);
      const { low, high } = widenFlatByNested(FLAT_ONE, nested);
      // §W1 (round-8 fix): a GrantedAbilityRef can carry its OWN `condition`
      // (the runtime enforces it — grantAbilityToCard/interpreter.ts wires
      // ref.condition straight into the registered trigger's condition), which
      // static valuation previously ignored entirely — a conditionally-granted
      // ability scored flat/flagless just like an unconditional one. Mirrors
      // the ability-level Condition treatment card-power.ts's
      // abilityContributionDetailed gives triggered/aura `condition` (§V2(a),
      // round-7): the midpoint is discounted by CONDITION_DISCOUNT (may not
      // always fire), low collapses to 0 (may never fire), and high removes
      // the discount off the nested-widened high (may always fire) — the same
      // [never fires, always fires] band around the discounted midpoint.
      if (effect.ability.condition !== undefined) {
        return {
          value: FLAT_ONE * CONDITION_DISCOUNT,
          low: 0,
          high: high / CONDITION_DISCOUNT,
          isRemoval: false,
          flags: [...new Set<PowerFlag>([...flags, 'conditional'])],
        };
      }
      return { value: FLAT_ONE, low, high, isRemoval: false, flags };
    }
    case 'cost_reduction':
    case 'grant_trait':
    case 'move':
    case 'apply_status':
    case 'cleanse':
    case 'shuffle_into_deck':
    case 'attach_as_equipment':
      return FLAT_D;
    default:
      return assertNever(effect);
  }
}

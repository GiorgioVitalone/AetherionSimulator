/**
 * Static (context-free) effect valuation — the analog of src/bot/spell-eval.ts's
 * scoreEffect, valued against EXPECTED targets instead of a live board. Same
 * per-effect coefficients, so static scores stay consistent with the bot's
 * worldview. Always full value-mode (it is an analysis tool, not the legacy bot).
 */
import type { AmountExpr, DynamicStatSource, StatModifier } from '../types/common.js';
import type { Effect } from '../types/effects.js';
import type { TargetExpr } from '../types/targets.js';
import type { EffectValue } from './types.js';
import { isAlliedCharacter, isAoE, isEnemyFacing, isEnemyHero, targetSide } from './target-util.js';
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
  TEMPO_WEIGHT,
  TOKEN_BODY_FACTOR,
  W_ARM,
  W_ATK,
  W_HP,
} from './weights.js';

const ZERO: EffectValue = { value: 0, isRemoval: false };
const FLAT: EffectValue = { value: FLAT_ONE, isRemoval: false };

function assertNever(x: never): never {
  throw new Error(`Unhandled effect node: ${JSON.stringify(x)}`);
}

function aoeFactor(t: TargetExpr): number {
  return isAoE(t) ? AOE_WIDTH : 1;
}

function amountVal(expr: AmountExpr): number {
  switch (expr.type) {
    case 'fixed':
      return expr.value;
    case 'x_cost':
      return EXPECTED_X;
    case 'dice':
      return expr.count * ((expr.sides + 1) / 2);
    case 'count':
      return Math.min(EXPECTED_COUNT, expr.max ?? EXPECTED_COUNT);
    case 'event_value':
      return EXPECTED_COUNT;
    default:
      return assertNever(expr);
  }
}

function modifierGain(m: StatModifier): number {
  return (m.atk ?? 0) + (m.hp ?? 0) + (m.arm ?? 0);
}

function dynamicBonus(dyn: DynamicStatSource | undefined): number {
  if (dyn === undefined) return 0;
  switch (dyn.type) {
    case 'per_count':
      return dyn.valuePerCount * EXPECTED_COUNT;
    case 'equals_stat':
      return AVG_BODY_HP;
    case 'x_cost':
      return EXPECTED_X;
    case 'multiply':
      // §13c repair (was 0 — zeroed Synthetic Evolution entirely): multiplying a
      // body's stats by k adds (k−1) × its stats. Priced per affected body at the
      // conservative AVG_WEAK_BODY anchor; AoE width multiplies in buffValue.
      return Math.max(0, dyn.factor - 1) * AVG_WEAK_BODY;
    default:
      return assertNever(dyn);
  }
}

function damageValue(amount: AmountExpr, target: TargetExpr): EffectValue {
  const dmg = amountVal(amount);
  if (isEnemyHero(target)) return { value: dmg * FACE_WEIGHT, isRemoval: false };
  if (!isEnemyFacing(target)) return ZERO;
  const kill = dmg >= AVG_BODY_HP;
  const per = kill ? AVG_ENEMY_BODY * REMOVAL_WEIGHT : Math.min(dmg, AVG_BODY_HP);
  return { value: per * aoeFactor(target), isRemoval: kill };
}

function buffValue(
  modifier: StatModifier,
  dyn: DynamicStatSource | undefined,
  target: TargetExpr,
): EffectValue {
  // Sign decides buff vs debuff (an `any`-side target says nothing — Haunting's
  // -ATK is cast at enemies, a +stat "any" is cast at allies). §13 repair: the
  // old enemy-facing branch dropped both the dynamic part and the AoE width.
  const total = modifierGain(modifier) + dynamicBonus(dyn);
  if (total < 0) {
    if (targetSide(target) === 'allied') return ZERO; // self-drawback rider, not a weapon
    // Debuff: per-body value capped at neutralizing an average body; AoE multiplies.
    return { value: Math.min(Math.abs(total), AVG_BODY_HP) * aoeFactor(target), isRemoval: false };
  }
  if (targetSide(target) === 'enemy') return ZERO; // positive buff on enemies: worthless
  return { value: total * aoeFactor(target) * TEMPO_WEIGHT, isRemoval: false };
}

/** Sum a list of effects; isRemoval propagates if ANY sub-effect is removal. */
export function sumEffects(effects: readonly Effect[]): EffectValue {
  let value = 0;
  let isRemoval = false;
  for (const e of effects) {
    const part = effectStaticValue(e);
    value += part.value;
    if (part.isRemoval) isRemoval = true;
  }
  return { value, isRemoval };
}

/** Expected context-free value of a single effect node. */
export function effectStaticValue(effect: Effect): EffectValue {
  switch (effect.type) {
    case 'destroy':
    case 'sacrifice':
      return isEnemyFacing(effect.target)
        ? { value: AVG_ENEMY_BODY * REMOVAL_WEIGHT * aoeFactor(effect.target), isRemoval: true }
        : isAlliedCharacter(effect.target)
          ? { value: -AVG_WEAK_BODY * SAC_COST, isRemoval: false }
          : ZERO;
    case 'bounce':
      return isEnemyFacing(effect.target)
        ? {
            value: AVG_ENEMY_BODY * BOUNCE_MULT * REMOVAL_WEIGHT * aoeFactor(effect.target),
            isRemoval: true,
          }
        : ZERO;
    case 'deal_damage':
      return damageValue(effect.amount, effect.target);
    case 'modify_stats':
      return buffValue(effect.modifier, effect.dynamicModifier, effect.target);
    case 'draw_cards':
      // §S1: routed through CARD_TO_HAND, the shared acquisition primitive (an
      // unselected card — no SELECTION_PREMIUM). CARD_TO_HAND === W_DRAW, so
      // this is numerically unchanged from the empirical 2026-07-14 anchor.
      return effect.player === 'enemy'
        ? ZERO
        : { value: amountVal(effect.count) * CARD_TO_HAND, isRemoval: false };
    case 'heal':
      // §13 repair: `any`-side heals are cast on YOUR side (the enemy-facing
      // convention is for damage/removal); heal-ALL was missing the AoE width.
      return targetSide(effect.target) === 'enemy'
        ? ZERO
        : {
            value: amountVal(effect.amount) * HEAL_URGENCY * aoeFactor(effect.target),
            isRemoval: false,
          };
    case 'gain_resource':
      // §13 repair: a banked resource ≈ ACCEL_RAMP_TEMPO stats of tempo (was 1.0).
      return {
        value: effect.amount * (effect.temporary === true ? RESOURCE_VALUE_TEMP : RESOURCE_VALUE),
        isRemoval: false,
      };
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
      return { value: per * n, isRemoval: false };
    }
    case 'counter_spell':
      // §13 repair: a counter trades 1-for-1 with the opponent's CHOSEN best
      // spell (≥ a card) plus initiative — 0.5 was the legacy bot's blind spot.
      return { value: CARD_VALUE + 0.5, isRemoval: false };
    case 'deploy_from_deck':
      return { value: 4, isRemoval: false };
    case 'composite':
      return sumEffects(effect.effects);
    case 'conditional': {
      const t = sumEffects(effect.ifTrue);
      const f = effect.ifFalse ? sumEffects(effect.ifFalse) : ZERO;
      return {
        value: CONDITIONAL_P * t.value + (1 - CONDITIONAL_P) * f.value,
        isRemoval: t.isRemoval,
      };
    }
    case 'choose_one': {
      let best = ZERO;
      for (const opt of effect.options) {
        const s = sumEffects(opt.effects);
        if (s.value > best.value) best = s;
      }
      return best;
    }
    case 'return_from_discard': {
      // §S1: reanimating a CHOSEN card from discard is a selection, not a blind
      // draw — the acquisition term is CARD_TO_HAND × SELECTION_PREMIUM whether
      // it lands in hand or on the battlefield (which additionally gets the body).
      const acquisition = CARD_TO_HAND * SELECTION_PREMIUM;
      return {
        value: effect.destination === 'battlefield' ? AVG_WEAK_BODY + acquisition : acquisition,
        isRemoval: false,
      };
    }
    case 'search_deck':
      // §S1: a tutor takes a CHOSEN card of the whole deck to hand — the shared
      // acquisition primitive with the selection premium (was CARD_VALUE ×
      // SELECTION_MULT_DECK). Battlefield destination unchanged (flat deploy value).
      return {
        value: effect.destination === 'battlefield' ? 4 : CARD_TO_HAND * SELECTION_PREMIUM,
        isRemoval: false,
      };
    case 'copy_card':
      // §S1: a copy of a CHOSEN card from a known pile ≈ a tutor (was CARD_VALUE
      // × SELECTION_MULT_DISCARD). The degenerate self-copy case is handled by
      // the loop guards, not by pricing it higher.
      return { value: CARD_TO_HAND * SELECTION_PREMIUM, isRemoval: false };
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
        isRemoval: false,
      };
    }
    case 'discard':
      return {
        value: isEnemyFacing(effect.target) ? effect.count * CARD_VALUE * 0.8 : 0,
        isRemoval: false,
      };
    case 'replacement':
      // §S2: an EC-003 shield (on_would_take_damage reduction — Shieldbearer
      // Paladin id48, Radiant Shield id66) mitigates ONE combat instance per
      // turn under the locked v1 rule (shieldFirstInstanceOnly) — see
      // valuation-profile.ts. Valued as its reduction amount, i.e. one
      // mitigated hit; the wrapping ability's OWN recurrence (almost always
      // 'aura' -> card-power.ts's abilityContribution -> AURA_REC, "active
      // every turn in play") supplies the "over ~N expected active turns"
      // multiplier, so no second turns-counter is invented here.
      // on_would_be_destroyed is a different (rarer) replacement mechanic,
      // unrelated to the ARM/shield rule, and keeps the generic FLAT bucket.
      return effect.replaces.type === 'on_would_take_damage'
        ? { value: effect.replaces.reduction ?? FLAT_ONE, isRemoval: false }
        : FLAT;
    case 'cost_reduction':
    case 'grant_trait':
    case 'grant_ability':
    case 'move':
    case 'apply_status':
    case 'cleanse':
    case 'shuffle_into_deck':
    case 'attach_as_equipment':
    case 'scheduled':
      return FLAT;
    default:
      return assertNever(effect);
  }
}

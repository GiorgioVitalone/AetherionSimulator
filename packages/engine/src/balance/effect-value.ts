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
import { isAlliedCharacter, isAoE, isEnemyFacing, isEnemyHero } from './target-util.js';
import {
  AOE_WIDTH,
  AVG_BODY_HP,
  AVG_ENEMY_BODY,
  AVG_WEAK_BODY,
  BOUNCE_MULT,
  CARD_VALUE,
  CONDITIONAL_P,
  EXPECTED_COUNT,
  EXPECTED_X,
  FACE_WEIGHT,
  FLAT_ONE,
  HEAL_URGENCY,
  REMOVAL_WEIGHT,
  SAC_COST,
  TEMPO_WEIGHT,
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
      return 0; // multiplies the base modifier (already counted); board-dependent, kept conservative
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
  if (isEnemyFacing(target)) {
    return { value: Math.min(Math.abs(modifierGain(modifier)), AVG_BODY_HP), isRemoval: false };
  }
  const gain = Math.max(0, modifierGain(modifier)) + dynamicBonus(dyn);
  return { value: gain * (isAoE(target) ? AOE_WIDTH : 1) * TEMPO_WEIGHT, isRemoval: false };
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
      return effect.player === 'enemy'
        ? ZERO
        : { value: amountVal(effect.count) * CARD_VALUE, isRemoval: false };
    case 'heal':
      return isEnemyFacing(effect.target)
        ? ZERO
        : { value: amountVal(effect.amount) * HEAL_URGENCY, isRemoval: false };
    case 'gain_resource':
      return { value: effect.amount * (effect.temporary === true ? 0.5 : 1.0), isRemoval: false };
    case 'deploy_token': {
      const n = effect.inEachEmpty === true ? 2 : effect.count;
      const stats = effect.token.atk + effect.token.hp + (effect.token.arm ?? 0);
      return { value: stats * n * 0.5, isRemoval: false };
    }
    case 'counter_spell':
      return { value: 0.5, isRemoval: false };
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
    case 'return_from_discard':
      return {
        value: effect.destination === 'battlefield' ? CARD_VALUE * 1.5 : CARD_VALUE,
        isRemoval: false,
      };
    case 'search_deck':
      return {
        value: effect.destination === 'battlefield' ? 4 : CARD_VALUE * 1.2,
        isRemoval: false,
      };
    case 'copy_card':
      return { value: CARD_VALUE, isRemoval: false };
    case 'scry':
      return { value: Math.min(effect.lookCount, 3) * 0.3, isRemoval: false };
    case 'discard':
      return {
        value: isEnemyFacing(effect.target) ? effect.count * CARD_VALUE * 0.8 : 0,
        isRemoval: false,
      };
    case 'cost_reduction':
    case 'grant_trait':
    case 'grant_ability':
    case 'move':
    case 'apply_status':
    case 'cleanse':
    case 'shuffle_into_deck':
    case 'attach_as_equipment':
    case 'replacement':
    case 'scheduled':
      return FLAT;
    default:
      return assertNever(effect);
  }
}

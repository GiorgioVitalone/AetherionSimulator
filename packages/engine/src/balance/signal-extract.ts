/**
 * Effect / trigger / condition scanners that map DSL nodes to Signal/Demand
 * specs (kind + weight + optional tag, without provenance — the orchestrator in
 * signals.ts adds the `source`). Wrapper effects are flattened first so a value
 * buried inside conditional/composite/choose_one is still seen.
 */
import type {
  Effect,
  DealDamageEffect,
  DeployTokenEffect,
  ModifyStatsEffect,
} from '../types/effects.js';
import type { Condition } from '../types/conditions.js';
import type { Trigger } from '../types/triggers.js';
import type { ProvideKind, WantKind } from './types.js';
import { AOE_WIDTH } from './weights.js';
import { isAoE, isEnemyFacing, isEnemyHero, targetSide } from './target-util.js';

export interface ProvideSpec {
  readonly kind: ProvideKind;
  readonly weight: number;
  readonly tag?: string;
}
export interface DemandSpec {
  readonly kind: WantKind;
  readonly weight: number;
  readonly tag?: string;
}

/** Flatten wrapper effects (composite/conditional/choose_one/replacement/
 * scheduled/grant_ability) into a single list for scanning. */
export function flattenEffects(effects: readonly Effect[]): Effect[] {
  const out: Effect[] = [];
  for (const e of effects) {
    out.push(e);
    switch (e.type) {
      case 'composite':
        out.push(...flattenEffects(e.effects));
        break;
      case 'conditional':
        out.push(...flattenEffects(e.ifTrue));
        if (e.ifFalse) out.push(...flattenEffects(e.ifFalse));
        break;
      case 'choose_one':
        for (const o of e.options) out.push(...flattenEffects(o.effects));
        break;
      case 'replacement':
        out.push(...flattenEffects(e.instead));
        break;
      case 'scheduled':
        out.push(...flattenEffects(e.effects));
        break;
      case 'grant_ability':
        out.push(...flattenEffects(e.ability.effects));
        break;
      default:
        break;
    }
  }
  return out;
}

function tokenProvides(e: DeployTokenEffect): ProvideSpec[] {
  const n = e.inEachEmpty === true ? 2 : e.count;
  const stats = e.token.atk + e.token.hp + (e.token.arm ?? 0);
  const out: ProvideSpec[] = [
    { kind: n >= 2 ? 'wide_bodies' : 'body', weight: Math.max(1, stats) },
  ];
  // §13 repair: a token parked in Reserve taps for +1 temporary resource each
  // upkeep (Rulebook 8.4) — deploy-to-Reserve IS ramp, at temp-resource weight.
  if (e.zone === 'reserve') out.push({ kind: 'ramp', weight: n * 0.75 });
  for (const tag of e.token.tags ?? []) {
    out.push({ kind: 'tag', weight: n, tag });
    out.push({ kind: 'death_trigger', weight: n, tag });
  }
  return out;
}

function dealProvides(e: DealDamageEffect): ProvideSpec[] {
  if (isEnemyHero(e.target)) return [{ kind: 'reach', weight: 2 }];
  return isEnemyFacing(e.target) ? [{ kind: 'removal', weight: 3 }] : [];
}

function modifyProvides(e: ModifyStatsEffect): ProvideSpec[] {
  if (targetSide(e.target) === 'enemy') return [];
  const gain = (e.modifier.atk ?? 0) + (e.modifier.hp ?? 0) + (e.modifier.arm ?? 0);
  return [{ kind: 'buff', weight: Math.max(1, gain) }];
}

/** What a single (flattened) effect OFFERS to the board/deck. */
export function effectProvides(e: Effect): ProvideSpec[] {
  switch (e.type) {
    case 'heal':
    case 'replacement':
      return [{ kind: 'sustain', weight: 2 }];
    case 'apply_status':
      return e.status === 'regeneration' ? [{ kind: 'sustain', weight: 2 }] : [];
    case 'draw_cards':
      return e.player === 'enemy' ? [] : [{ kind: 'card_flow', weight: 2 }];
    case 'return_from_discard':
    case 'search_deck':
    case 'copy_card':
    case 'scry':
      return [{ kind: 'card_flow', weight: 2 }];
    case 'gain_resource':
      // Temporary gains ramp at half weight — burst, not banked acceleration.
      return [{ kind: 'ramp', weight: Math.max(1, e.amount) * (e.temporary === true ? 0.5 : 1) }];
    case 'modify_stats':
      return modifyProvides(e);
    case 'grant_trait':
      return [{ kind: 'buff', weight: 1 }];
    case 'deploy_token':
      return tokenProvides(e);
    case 'deal_damage':
      return dealProvides(e);
    case 'destroy':
    case 'sacrifice':
    case 'bounce':
      return isEnemyFacing(e.target) ? [{ kind: 'removal', weight: 3 }] : [];
    default:
      return [];
  }
}

function modifyDemands(e: ModifyStatsEffect): DemandSpec[] {
  if (targetSide(e.target) === 'enemy') return [];
  const out: DemandSpec[] = [];
  const tag = 'filter' in e.target ? e.target.filter?.tag : undefined;
  if (tag !== undefined) out.push({ kind: 'tag_tribal', weight: 2, tag });
  else if (isAoE(e.target)) out.push({ kind: 'bodies_to_buff', weight: AOE_WIDTH });
  if ((e.modifier.arm ?? 0) > 0)
    out.push({ kind: 'frontline_arm', weight: Math.max(1, e.modifier.arm ?? 0) });
  return out;
}

/** What a single (flattened) effect WANTS from the board/deck. */
export function effectDemands(e: Effect): DemandSpec[] {
  switch (e.type) {
    case 'sacrifice':
      return targetSide(e.target) === 'allied' ? [{ kind: 'wide_to_sacrifice', weight: 1 }] : [];
    case 'modify_stats':
      return modifyDemands(e);
    case 'cost_reduction':
      return e.appliesTo.cardType === 'E' ? [{ kind: 'equipment_count', weight: 2 }] : [];
    case 'attach_as_equipment':
      return [{ kind: 'attach_target', weight: 2 }];
    default:
      return [];
  }
}

/** What a trigger implies the ability WANTS (an aristocrats/spell-count engine). */
export function triggerDemands(t: Trigger): DemandSpec[] {
  switch (t.type) {
    case 'on_spell_cast':
      return [{ kind: 'spell_density', weight: 2 }];
    case 'on_ally_destroyed':
    case 'on_ally_dies':
    case 'on_ally_leaves_battlefield': {
      const tag = t.filter?.tag;
      return tag !== undefined
        ? [{ kind: 'death_of_tag', weight: 2, tag }]
        : [{ kind: 'wide_to_sacrifice', weight: 2 }];
    }
    case 'on_sacrifice':
      return [{ kind: 'wide_to_sacrifice', weight: 2 }];
    case 'on_ally_deployed':
      return [{ kind: 'bodies_to_buff', weight: 2 }];
    case 'on_equipment_attached':
      return [{ kind: 'equipment_count', weight: 2 }];
    case 'on_gain_resource':
      return [{ kind: 'temp_resource', weight: 2 }];
    case 'on_stat_modified':
      return [{ kind: 'bodies_to_buff', weight: 1 }];
    default:
      return [];
  }
}

/** What an ability-level Condition implies it WANTS (hand size, temp resource…). */
export function conditionDemands(c: Condition): DemandSpec[] {
  switch (c.type) {
    case 'card_count':
      return c.zone === 'hand' &&
        (c.comparison === 'greater_equal' || c.comparison === 'greater_than')
        ? [{ kind: 'large_hand', weight: 2 }]
        : [];
    case 'event_context':
      return [{ kind: 'temp_resource', weight: 2 }];
    case 'controls_character':
      return c.tag !== undefined ? [{ kind: 'tag_tribal', weight: 1, tag: c.tag }] : [];
    case 'and':
    case 'or':
      return c.conditions.flatMap(conditionDemands);
    default:
      return [];
  }
}

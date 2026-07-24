/**
 * §P1 (certification round 3) — the ONE exhaustive risky-effect scan.
 *
 * Prior rounds fixed flattenEffects to recurse through every wrapper
 * (composite/conditional-both-branches/choose_one-ALL-options/replacement/
 * scheduled/grant_ability), but two consumers still gated on ability KIND
 * instead of using that full recursion: card-power.ts's free_cast flag only
 * fired for `aura` abilities, and loop-graph.ts's collectCostReducers only
 * scanned `aura` abilities. The runtime genuinely supports triggered/activated
 * one-shot cost reductions (effects/cost-reduction-handler.ts), so a triggered
 * ability with a nested cost_reduction — or a self-discounting on_cast copier —
 * was invisible to both.
 *
 * scanRiskyEffects walks EVERY ability kind (aura/triggered/stat_grant — the
 * exhaustive switch below breaks the build if AbilityDSL grows a new kind)
 * and, via flattenEffects, EVERY effect wrapper, reporting the risky shapes
 * that matter for balance gating: cost_reduction nodes (for free_cast +
 * loop-graph's cost-reducer collection) and free-cast/acquisition effects
 * (search_deck/copy_card/return_from_discard/deploy_from_deck). The exhaustive
 * switch over Effect (classifyEffect) means a future DSL addition that
 * introduces a new risky shape breaks this file's build, not silently falls
 * through as flags: [].
 */
import type { Effect, CostReductionEffect } from '../types/effects.js';
import type { AbilityDSL } from '../types/ability.js';
import type { PowerFlag } from './types.js';
import { flattenEffects } from './signal-extract.js';

function assertNever(x: never): never {
  throw new Error(`Unhandled node: ${JSON.stringify(x)}`);
}

export interface RiskyEffectScan {
  readonly flags: readonly PowerFlag[];
  readonly costReducers: readonly CostReductionEffect[];
}

/** Every ability kind carries its effects the same way (stat_grant has none) —
 * exhaustive so a new AbilityDSL variant breaks this build. */
function abilityEffects(ab: AbilityDSL): readonly Effect[] {
  switch (ab.type) {
    case 'triggered':
    case 'aura':
      return ab.effects;
    case 'stat_grant':
      return [];
    default:
      return assertNever(ab);
  }
}

/** Which PowerFlags a single (already-flattened) effect node contributes.
 * Exhaustive over Effect — a new effect variant must be triaged here. */
function classifyEffect(e: Effect): readonly PowerFlag[] {
  switch (e.type) {
    case 'cost_reduction':
      return ['free_cast'];
    case 'search_deck': {
      const flags: PowerFlag[] = ['selection'];
      if (e.castFreeIfCost !== undefined || e.castForFree === true) flags.push('free_cast');
      return flags;
    }
    case 'copy_card':
    case 'return_from_discard':
      return ['selection', 'recursion'];
    case 'deploy_from_deck':
      return ['selection'];
    case 'deal_damage':
    case 'heal':
    case 'modify_stats':
    case 'draw_cards':
    case 'scry':
    case 'deploy_token':
    case 'destroy':
    case 'sacrifice':
    case 'bounce':
    case 'discard':
    case 'counter_spell':
    case 'gain_resource':
    case 'grant_trait':
    case 'grant_ability':
    case 'move':
    case 'apply_status':
    case 'cleanse':
    case 'shuffle_into_deck':
    case 'attach_as_equipment':
    case 'choose_one':
    case 'conditional':
    case 'composite':
    case 'replacement':
    case 'scheduled':
      return [];
    default:
      return assertNever(e);
  }
}

/** Which PowerFlags an arbitrary effects list contributes, once fully
 * flattened through every wrapper. Shared by scanRiskyEffects (whole
 * abilities) and effect-interval.ts's wrapper cases (scheduled, replacement's
 * `instead`, grant_ability's nested ability) — those cases keep a FLAT point
 * value by design (§S2/§S3), but must still surface nested flags instead of
 * silently dropping them. */
export function riskyFlagsOf(effects: readonly Effect[]): readonly PowerFlag[] {
  const flagSet = new Set<PowerFlag>();
  for (const e of flattenEffects(effects)) for (const f of classifyEffect(e)) flagSet.add(f);
  return [...flagSet];
}

function costReducersOf(effects: readonly Effect[]): readonly CostReductionEffect[] {
  const out: CostReductionEffect[] = [];
  for (const e of flattenEffects(effects)) if (e.type === 'cost_reduction') out.push(e);
  return out;
}

/** §P1 — scan a set of abilities (a whole card's `.abilities`, or a single
 * ability wrapped in an array) for every risky effect shape, regardless of
 * which ability kind carries it or how deep a wrapper buries it. */
export function scanRiskyEffects(abilities: readonly AbilityDSL[]): RiskyEffectScan {
  const flagSet = new Set<PowerFlag>();
  const costReducers: CostReductionEffect[] = [];
  for (const ab of abilities) {
    const effects = abilityEffects(ab);
    for (const f of riskyFlagsOf(effects)) flagSet.add(f);
    costReducers.push(...costReducersOf(effects));
  }
  return { flags: [...flagSet], costReducers };
}

/**
 * AbilityDSL — top-level wrapper for card abilities.
 * Three structural patterns:
 * - triggered: event-driven (Deploy, Last Breath, activated costs, etc.)
 * - aura: continuous passive (buffs, cost reductions while in play)
 * - stat_grant: equipment stat bonuses (no trigger, no condition)
 */
import type { StatModifier, DynamicStatSource, ResourceType } from './common.js';
import type { Effect } from './effects.js';
import type { Trigger } from './triggers.js';
import type { Condition } from './conditions.js';

export type AbilityDSL = TriggeredAbilityDSL | AuraAbilityDSL | StatGrantDSL;

export interface TriggeredAbilityDSL {
  readonly type: 'triggered';
  readonly trigger: Trigger;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
  readonly cooldown?: number;
  readonly oncePerTurn?: boolean;
  readonly xCostResource?: ResourceType;
  readonly abilityKind?:
    | 'activated'
    | 'trigger'
    | 'counter'
    | 'flash'
    | 'ultimate';
  /** [React]: event-driven ability that exhausts its source card when it procs, and
   * cannot proc while its source is already exhausted (effectively once per turn,
   * exhaust-gated rather than counter-gated). Contrast [Aura], which may also use
   * "when" phrasing but procs unlimited times and never exhausts. No [React] on
   * Heroes — HeroState has no `exhausted` field. Absent/false ⇒ semantically invariant no-op. */
  readonly react?: boolean;
}

export interface AuraAbilityDSL {
  readonly type: 'aura';
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
}

export interface StatGrantDSL {
  readonly type: 'stat_grant';
  readonly modifier: StatModifier;
  readonly dynamicModifier?: DynamicStatSource;
}

/**
 * AbilityDSL — top-level wrapper for card abilities.
 * Three structural patterns:
 * - triggered: event-driven (Deploy, Last Breath, activated costs, etc.)
 * - aura: continuous passive (buffs, cost reductions while in play)
 * - stat_grant: equipment stat bonuses (no trigger, no condition)
 */
import type { StatModifier } from './common.js';
import type { Effect } from './effects.js';
import type { Trigger } from './triggers.js';
import type { Condition } from './conditions.js';

export type AbilityDSL = TriggeredAbilityDSL | AuraAbilityDSL | StatGrantDSL;

export interface TriggeredAbilityDSL {
  readonly type: 'triggered';
  readonly trigger: Trigger;
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
}

export interface AuraAbilityDSL {
  readonly type: 'aura';
  readonly effects: readonly Effect[];
  readonly condition?: Condition;
}

export interface StatGrantDSL {
  readonly type: 'stat_grant';
  readonly modifier: StatModifier;
}

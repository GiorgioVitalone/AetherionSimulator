/**
 * Effect DSL — Discriminated union for card effects.
 * Phase 1 will expand this with all effect variants.
 */
export type Effect = DealDamageEffect;

export interface DealDamageEffect {
  readonly type: 'deal_damage';
  readonly amount: number;
  readonly target: TargetExpr;
}

/**
 * Target expression — describes what an effect targets.
 */
export type TargetExpr =
  | { readonly type: 'self' }
  | { readonly type: 'target_character'; readonly zone?: ZoneType }
  | { readonly type: 'all_characters'; readonly side: 'allied' | 'enemy' | 'any' };

/**
 * Trigger — when an effect activates.
 */
export type Trigger =
  | { readonly type: 'on_deploy' }
  | { readonly type: 'on_destroy' }
  | { readonly type: 'on_turn_start' }
  | { readonly type: 'on_turn_end' }
  | { readonly type: 'on_attack' }
  | { readonly type: 'on_condition'; readonly condition: Condition };

/**
 * Condition — boolean expressions for trigger guards and ability costs.
 */
export type Condition =
  | { readonly type: 'hp_below'; readonly threshold: number }
  | { readonly type: 'zone_is'; readonly zone: ZoneType }
  | { readonly type: 'has_trait'; readonly trait: string };

/**
 * Duration — how long an effect persists.
 */
export type Duration =
  | { readonly type: 'instant' }
  | { readonly type: 'until_end_of_turn' }
  | { readonly type: 'permanent' };

/**
 * Zone types on the battlefield.
 */
export type ZoneType = 'reserve' | 'frontline' | 'high_ground';

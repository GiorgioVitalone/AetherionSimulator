/**
 * Foundation types for the Effect DSL.
 * No imports — all other type files depend on this.
 */

export type ZoneType = 'reserve' | 'frontline' | 'high_ground';
export type Side = 'allied' | 'enemy' | 'any';
export type ResourceType = 'mana' | 'energy' | 'flexible';
export type CardTypeCode = 'C' | 'S' | 'E' | 'H' | 'T' | 'R';
export type Stat = 'atk' | 'hp' | 'arm';

export type Trait =
  | 'haste'
  | 'rush'
  | 'sniper'
  | 'elite'
  | 'flying'
  | 'defender'
  | 'stealth'
  | 'recycle'
  | 'swift'
  | 'volatile'
  | 'first_strike';

/**
 * Numeric expression that can be either a fixed value or a dynamic count.
 * Used on deal_damage.amount, heal.amount, draw_cards.count where scaling
 * is observed in the card database. All other numeric fields use plain number.
 */
export type AmountExpr =
  | { readonly type: 'fixed'; readonly value: number }
  | { readonly type: 'count'; readonly counting: CountingExpr; readonly max?: number }
  | { readonly type: 'x_cost'; readonly resource: ResourceType }
  | { readonly type: 'event_value'; readonly event: 'damage_taken' }
  | { readonly type: 'dice'; readonly count: number; readonly sides: number };

export type CountingExpr =
  | {
      readonly type: 'cards_in_zone';
      readonly zone: 'hand' | 'discard' | 'battlefield' | 'resource_bank';
      readonly side: Side;
      readonly filter?: CountingFilter;
    }
  | { readonly type: 'characters_destroyed_this_turn' }
  | { readonly type: 'spells_cast_this_turn' }
  | { readonly type: 'empty_slots'; readonly zone: ZoneType; readonly side: Side };

export interface CountingFilter {
  readonly cardType?: CardTypeCode;
  readonly trait?: Trait;
  readonly tag?: string;
  readonly maxCost?: number;
}

export interface ResourceCost {
  readonly mana: number;
  readonly energy: number;
  readonly flexible: number;
}

export interface StatModifier {
  readonly atk?: number;
  readonly hp?: number;
  readonly arm?: number;
}

export type DynamicStatSource =
  | { readonly type: 'per_count'; readonly stat: Stat; readonly counting: CountingExpr; readonly valuePerCount: number }
  | { readonly type: 'equals_stat'; readonly stat: Stat; readonly sourceRef: Stat }
  | { readonly type: 'multiply'; readonly factor: number }
  | { readonly type: 'x_cost'; readonly stat: Stat; readonly resource: ResourceType };

export interface TokenDef {
  readonly name: string;
  readonly atk: number;
  readonly hp: number;
  readonly arm?: number;
  readonly traits?: readonly Trait[];
  readonly tags?: readonly string[];
}

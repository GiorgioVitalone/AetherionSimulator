/**
 * Target expressions — describe what an effect targets.
 * 16 variants covering all targeting patterns in the card database.
 */
import type { ZoneType, Side, CardTypeCode, Trait } from './common.js';

export type TargetExpr =
  | SelfTarget
  | HeroTarget
  | TargetCharacter
  | TargetEquipment
  | AllCharacters
  | AllCharactersInZone
  | UpToTargets
  | AdjacentToSelf
  | EquippedCharacter
  | OwnerHero
  | TargetCardInDiscard
  | TargetSpell
  | CopyTarget
  | RandomTarget
  | EachPlayer
  | SourceCharacter;

export interface SelfTarget {
  readonly type: 'self';
}
export interface HeroTarget {
  readonly type: 'hero';
  readonly side: Side;
}
export interface TargetCharacter {
  readonly type: 'target_character';
  readonly side: Side;
  readonly zone?: ZoneType;
  readonly filter?: TargetFilter;
}
export interface TargetEquipment {
  readonly type: 'target_equipment';
  readonly side: Side;
}
export interface AllCharacters {
  readonly type: 'all_characters';
  readonly side: Side;
  readonly filter?: TargetFilter;
}
export interface AllCharactersInZone {
  readonly type: 'all_characters_in_zone';
  readonly zone: ZoneType;
  readonly side: Side;
  readonly filter?: TargetFilter;
}
export interface UpToTargets {
  readonly type: 'up_to';
  readonly count: number;
  readonly side: Side;
  readonly filter?: TargetFilter;
}
/** Adjacent to the effect source's (self's) current zone, resolved at runtime. */
export interface AdjacentToSelf {
  readonly type: 'adjacent_to_self';
}
export interface EquippedCharacter {
  readonly type: 'equipped_character';
}
export interface OwnerHero {
  readonly type: 'owner_hero';
}
export interface TargetCardInDiscard {
  readonly type: 'target_card_in_discard';
  readonly side: Side;
  readonly filter?: TargetFilter;
}
export interface TargetSpell {
  readonly type: 'target_spell';
}
export interface CopyTarget {
  readonly type: 'copy_of';
  readonly base: TargetExpr;
}
export interface RandomTarget {
  readonly type: 'random';
  readonly side: Side;
  readonly zone: 'hand' | 'battlefield';
  readonly filter?: TargetFilter;
}
export interface EachPlayer {
  readonly type: 'each_player';
}
export interface SourceCharacter {
  readonly type: 'source_character';
}

export interface TargetFilter {
  readonly trait?: Trait;
  readonly maxCost?: number;
  readonly minCost?: number;
  readonly maxHp?: number;
  readonly maxAtk?: number;
  readonly cardType?: CardTypeCode;
  readonly tag?: string;
}

/**
 * Simulator-specific card types.
 * Leaner than the CMS DB schema — no artUrl, timestamps, audit fields, etc.
 * Generated from the PostgreSQL database via `pnpm generate:cards`.
 */

export type CardTypeCode = 'C' | 'S' | 'E' | 'H' | 'T' | 'R';

export type Rarity = 'Common' | 'Ethereal' | 'Mythic' | 'Legendary';

export type Alignment =
  | 'Crimson'
  | 'Sapphire'
  | 'Verdant'
  | 'Onyx'
  | 'Radiant'
  | 'Amethyst';

export interface Cost {
  readonly mana: number;
  readonly energy: number;
  readonly flexible: number;
  readonly xMana: boolean;
  readonly xEnergy: boolean;
}

export interface Stats {
  readonly hp: number;
  readonly atk: number;
  readonly arm: number;
}

export interface Ability {
  readonly name: string;
  readonly cost: string | null;
  readonly effect: string;
  readonly trigger: string | null;
  readonly abilityType: string | null;
  readonly dsl: unknown;
}

export interface SimCard {
  readonly id: number;
  readonly name: string;
  readonly cardType: CardTypeCode;
  readonly rarity: Rarity;
  readonly alignment: readonly Alignment[];
  readonly cost: Cost;
  readonly stats: Stats | null;
  readonly abilities: readonly Ability[];
  readonly traits: readonly string[];
  readonly artUrl: string | null;
  readonly flavorText: string | null;
  readonly setCode: string | null;
  readonly transformsInto: number | null;
}

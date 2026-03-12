/**
 * Engine-agnostic display prop types for UI components.
 * These decouple the UI package from the game engine — consumers
 * map engine state to these plain interfaces before rendering.
 */

export type CardDisplayMode = 'battlefield' | 'hand' | 'detail';

export interface CardDisplayProps {
  readonly mode: CardDisplayMode;
  readonly name: string;
  readonly cardType: 'C' | 'S' | 'E' | 'H' | 'T' | 'R';
  readonly faction: string;
  readonly cost: CostDisplay;
  readonly stats: StatsDisplay | null;
  readonly abilities: readonly AbilityDisplay[];
  readonly traits: readonly string[];
  readonly artUrl?: string;
  readonly rarity?: string;
  readonly flavorText?: string;

  // Runtime state (battlefield/hand modes)
  readonly exhausted?: boolean;
  readonly summoningSick?: boolean;
  readonly playable?: boolean;
  readonly selected?: boolean;
  readonly highlighted?: boolean;
  readonly hovered?: boolean;

  // Stat modifiers (for showing buffed/debuffed)
  readonly modifiedStats?: StatsDisplay;

  // Equipment attached to this character
  readonly equipmentName?: string;

  // Event handlers
  readonly onClick?: () => void;
  readonly onMouseEnter?: () => void;
  readonly onMouseLeave?: () => void;
}

export interface CostDisplay {
  readonly mana: number;
  readonly energy: number;
  readonly flexible: number;
  readonly xMana?: boolean;
  readonly xEnergy?: boolean;
}

export interface StatsDisplay {
  readonly hp: number;
  readonly atk: number;
  readonly arm: number;
}

export interface AbilityDisplay {
  readonly name: string;
  readonly cost: string | null;
  readonly effect: string;
  readonly trigger: string | null;
  readonly abilityType: string | null;
}

export interface HeroDisplayProps {
  readonly name: string;
  readonly faction: string;
  readonly currentLp: number;
  readonly maxLp: number;
  readonly transformed: boolean;
  readonly canTransform: boolean;
  readonly abilities: readonly AbilityDisplay[];
}

export interface ResourceCardDisplay {
  readonly instanceId: string;
  readonly resourceType: 'mana' | 'energy';
  readonly exhausted: boolean;
}

/**
 * Faction utility — resolves alignment arrays to faction identifiers
 * for CSS theming via the data-faction attribute.
 */

export const FACTION_NAMES = [
  'crimson',
  'sapphire',
  'verdant',
  'onyx',
  'radiant',
  'amethyst',
] as const;

export type FactionName = (typeof FACTION_NAMES)[number] | 'none';

export const FACTION_COLORS: Record<FactionName, { base: string; light: string; dark: string }> = {
  crimson:  { base: '#e63946', light: '#ff6b6b', dark: '#8b1a22' },
  sapphire: { base: '#4895ef', light: '#7ec8e3', dark: '#1a5276' },
  verdant:  { base: '#52b788', light: '#95d5b2', dark: '#1b5e3a' },
  onyx:     { base: '#6c6c6c', light: '#adb5bd', dark: '#2e2e2e' },
  radiant:  { base: '#f4d35e', light: '#fff3b0', dark: '#9e8420' },
  amethyst: { base: '#b185db', light: '#d4b5f0', dark: '#6a3d7d' },
  none:     { base: '#b2ac9e', light: '#d4d0c8', dark: '#7a7567' },
};

/**
 * Extract a lowercase faction string from an alignment array.
 * alignment is always string[] per the engine contract.
 */
export function getFaction(alignment: readonly string[]): FactionName {
  const first = alignment[0]?.toLowerCase();
  if (first && (FACTION_NAMES as readonly string[]).includes(first)) {
    return first as FactionName;
  }
  return 'none';
}

/**
 * The general signal->demand interaction matrix W[provide][want] in [0,1].
 *
 * SPARSE by design: only the listed cells are non-zero. Critically, `removal` and
 * `reach` are ALL-ZERO provider rows — their value lives only in card power, so
 * the synergy term can never re-count it (the central double-count guard). Each
 * coefficient is the fraction of min(provide.weight, demand.weight) that becomes
 * synergy; anchors are documented in docs/balance-valuation.md.
 */
import type { InteractionMatrix, ProvideKind, WantKind } from './types.js';

const PROVIDE_KINDS: readonly ProvideKind[] = [
  'wall',
  'body',
  'wide_bodies',
  'sustain',
  'removal',
  'reach',
  'card_flow',
  'ramp',
  'buff',
  'spell_cast',
  'equipment',
  'death_trigger',
  'tag',
];

const WANT_KINDS: readonly WantKind[] = [
  'wall_to_sustain',
  'bodies_to_buff',
  'wide_to_sacrifice',
  'spell_density',
  'large_hand',
  'equipment_count',
  'death_of_tag',
  'tag_tribal',
  'frontline_arm',
  'temp_resource',
  'attach_target',
];

// Non-zero cells only; everything else defaults to 0. (removal / reach absent.)
const ROWS: Partial<Record<ProvideKind, Partial<Record<WantKind, number>>>> = {
  // A wall is a durable body (carries ARM, rides equipment); it DEMANDS sustain
  // (see signals), it does not provide it.
  wall: { frontline_arm: 0.4, attach_target: 0.3 },
  body: {
    bodies_to_buff: 0.5,
    wide_to_sacrifice: 0.4,
    tag_tribal: 0.2,
    frontline_arm: 0.5,
    attach_target: 0.7,
  },
  wide_bodies: { bodies_to_buff: 0.7, wide_to_sacrifice: 0.8, death_of_tag: 0.3, tag_tribal: 0.3 },
  // Healing/regen satisfies a wall's desire to be kept alive (the Defender+heal combo).
  sustain: { wall_to_sustain: 0.9 },
  card_flow: { spell_density: 0.3, large_hand: 0.8 },
  ramp: { equipment_count: 0.3, temp_resource: 0.7 },
  buff: { frontline_arm: 0.5, attach_target: 0.4 },
  spell_cast: { spell_density: 0.9, large_hand: 0.3 },
  equipment: { equipment_count: 0.9, frontline_arm: 0.2 },
  death_trigger: { wide_to_sacrifice: 0.6, death_of_tag: 0.85 },
  tag: { tag_tribal: 0.9 },
};

function buildMatrix(): InteractionMatrix {
  const out = {} as Record<ProvideKind, Record<WantKind, number>>;
  for (const p of PROVIDE_KINDS) {
    const row = {} as Record<WantKind, number>;
    for (const w of WANT_KINDS) row[w] = ROWS[p]?.[w] ?? 0;
    out[p] = row;
  }
  return out;
}

export const INTERACTION_MATRIX: InteractionMatrix = buildMatrix();

export function interactionWeight(provide: ProvideKind, want: WantKind): number {
  return INTERACTION_MATRIX[provide][want];
}

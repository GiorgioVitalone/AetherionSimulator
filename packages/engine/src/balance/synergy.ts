/**
 * Synergy scoring through the interaction matrix. The core primitive pairs every
 * Signal against every Demand: W[provide][want] * min(weights) (min keeps a tiny
 * provider from inflating a big demand and keeps units in stat-value space).
 * Tag-keyed wants (death_of_tag / tag_tribal) additionally require tag equality.
 */
import type { Demand, Signal, SynergyBreakdown, SynergyPair } from './types.js';
import { interactionWeight } from './interaction-matrix.js';
import { GLOBAL_SYN_FRACTION, PAIR_CAP } from './weights.js';

const TAG_GATED: ReadonlySet<string> = new Set<Demand['kind']>(['death_of_tag', 'tag_tribal']);

function tagAgrees(p: Signal, d: Demand): boolean {
  return TAG_GATED.has(d.kind) ? p.tag !== undefined && p.tag === d.tag : true;
}

function accumulate(
  provides: readonly Signal[],
  demands: readonly Demand[],
  crossSourceOnly: boolean,
): number {
  let total = 0;
  for (const p of provides) {
    for (const d of demands) {
      if (crossSourceOnly && p.source === d.source) continue;
      const w = interactionWeight(p.kind, d.kind);
      if (w > 0 && tagAgrees(p, d)) total += w * Math.min(p.weight, d.weight);
    }
  }
  return total;
}

/** All signal->demand interactions between two sets (used inter-card + hero). */
export function pairSynergy(provides: readonly Signal[], demands: readonly Demand[]): number {
  return accumulate(provides, demands, false);
}

/** A card's OWN provides against its OWN demands, restricted to cross-source
 * pairs so a single ability cannot self-satisfy (the Defender + self-heal combo). */
export function intraSynergy(provides: readonly Signal[], demands: readonly Demand[]): number {
  return accumulate(provides, demands, true);
}

export interface CardSignals {
  readonly id: number;
  readonly name: string;
  readonly copies: number;
  readonly provides: readonly Signal[];
  readonly demands: readonly Demand[];
}

/** More copies ⇒ both cards more reliably present together (capped at a playset). */
function presence(copies: number): number {
  return Math.min(copies, 3) / 3;
}

/** Inter-card synergy over DISTINCT cards: bidirectional pair value scaled by
 * presence, per-pair capped, then globally capped to a fraction of card power. */
export function deckInterSynergy(
  cards: readonly CardSignals[],
  cardPowerSum: number,
): SynergyBreakdown {
  const pairs: SynergyPair[] = [];
  let raw = 0;
  for (let i = 0; i < cards.length; i++) {
    const a = cards[i]!;
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j]!;
      const both =
        (pairSynergy(a.provides, b.demands) + pairSynergy(b.provides, a.demands)) *
        presence(a.copies) *
        presence(b.copies);
      const capped = Math.min(both, PAIR_CAP);
      if (capped > 0) {
        raw += capped;
        pairs.push({ a: a.name, b: b.name, value: capped });
      }
    }
  }
  const capped = Math.min(raw, GLOBAL_SYN_FRACTION * cardPowerSum);
  const topPairs = [...pairs]
    .sort((x, y) => y.value - x.value || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, 8);
  return { raw, capped, topPairs };
}

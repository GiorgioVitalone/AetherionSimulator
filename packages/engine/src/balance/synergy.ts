/**
 * Synergy scoring through the interaction matrix. The core primitive pairs every
 * Signal against every Demand: W[provide][want] * min(weights) (min keeps a tiny
 * provider from inflating a big demand and keeps units in stat-value space).
 * Tag-keyed wants (death_of_tag / tag_tribal) additionally require tag equality.
 */
import type { Demand, Signal, SynergyBreakdown, SynergyPair } from './types.js';
import { interactionWeight } from './interaction-matrix.js';
import { GLOBAL_SYN_FRACTION, PAIR_CAP, SATURATION_DECAY, SATURATION_FREE } from './weights.js';

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

/** A bidirectional, presence-scaled, per-pair-capped synergy edge, tagged with the
 * indices of the two cards it touches (so saturation can find a card's edges). */
interface SynergyEdge {
  readonly i: number;
  readonly j: number;
  readonly a: string;
  readonly b: string;
  readonly value: number;
}

function synergyEdges(cards: readonly CardSignals[]): SynergyEdge[] {
  const edges: SynergyEdge[] = [];
  for (let i = 0; i < cards.length; i++) {
    const a = cards[i]!;
    for (let j = i + 1; j < cards.length; j++) {
      const b = cards[j]!;
      const both =
        (pairSynergy(a.provides, b.demands) + pairSynergy(b.provides, a.demands)) *
        presence(a.copies) *
        presence(b.copies);
      const value = Math.min(both, PAIR_CAP);
      if (value > 0) edges.push({ i, j, a: a.name, b: b.name, value });
    }
  }
  return edges;
}

/** A card's first SATURATION_FREE edges count fully; its k-th extra edge decays. */
function edgeFactor(rank: number): number {
  return rank < SATURATION_FREE ? 1 : SATURATION_DECAY ** (rank - SATURATION_FREE + 1);
}

/** Diminishing returns on a card's redundant synergies: walking edges strongest
 * first, each card spends a free quota then decays. An edge keeps the smaller of
 * its two endpoints' factors (the more-saturated card gates it), so a hub fed by
 * many partners (a lone sac outlet, one shield for the board) stops scaling
 * linearly while a coherent few-partner package is untouched. Returns a multiplier
 * per edge, parallel to `edges`. */
function saturate(edges: readonly SynergyEdge[]): number[] {
  const used = new Map<number, number>();
  const order = edges.map((_, k) => k).sort((x, y) => edges[y]!.value - edges[x]!.value || x - y);
  const mult = new Array<number>(edges.length).fill(0);
  for (const k of order) {
    const { i, j } = edges[k]!;
    const ri = used.get(i) ?? 0;
    const rj = used.get(j) ?? 0;
    mult[k] = Math.min(edgeFactor(ri), edgeFactor(rj));
    used.set(i, ri + 1);
    used.set(j, rj + 1);
  }
  return mult;
}

/** Inter-card synergy over DISTINCT cards: bidirectional pair value scaled by
 * presence, per-pair capped, per-card saturated (diminishing returns on a card's
 * redundant combos), then globally capped to a fraction of card power. */
export function deckInterSynergy(
  cards: readonly CardSignals[],
  cardPowerSum: number,
): SynergyBreakdown {
  const edges = synergyEdges(cards);
  const mult = saturate(edges);
  let raw = 0;
  const pairs: SynergyPair[] = edges.map((e, k) => {
    const value = e.value * mult[k]!;
    raw += value;
    return { a: e.a, b: e.b, value };
  });
  const capped = Math.min(raw, GLOBAL_SYN_FRACTION * cardPowerSum);
  const topPairs = [...pairs]
    .sort((x, y) => y.value - x.value || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, 8);
  return { raw, capped, topPairs };
}

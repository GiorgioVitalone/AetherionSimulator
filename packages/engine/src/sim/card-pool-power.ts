// Card-pool power summary for the WS-C deck sampler.
//
// Given the per-deck win% of a faction's sampled decklists, summarize the
// faction's reachable power as the MEDIAN (typical legal deck) and the
// BEST-OF-K (the strongest sampled deck — what a deckbuilder converges to).
// Pure, additive output; nothing here touches the hashed sim path.

export interface DeckWinRate {
  /** Identifier for the deck (e.g. its multiset hash). */
  readonly deckKey: string;
  /** Win fraction in [0,1]. */
  readonly winPct: number;
  /** Number of decided games behind winPct (for weighting / reporting). */
  readonly games: number;
}

export interface CardPoolPower {
  readonly decks: number;
  /** Median win% across sampled decks (typical legal deck). */
  readonly median: number;
  /** Best sampled deck's win% (best-of-K reachable power). */
  readonly bestOfK: number;
  /** Worst sampled deck's win%. */
  readonly worst: number;
  /** deckKey of the best-of-K deck. */
  readonly bestDeckKey: string | null;
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

/** Summarize the faction's deck win-rates into median + best-of-K power. */
export function cardPoolPower(rates: readonly DeckWinRate[]): CardPoolPower {
  if (rates.length === 0) {
    return { decks: 0, median: 0, bestOfK: 0, worst: 0, bestDeckKey: null };
  }
  const sorted = [...rates].map((r) => r.winPct).sort((a, b) => a - b);
  let best = rates[0] as DeckWinRate;
  for (const r of rates) if (r.winPct > best.winPct) best = r;
  return {
    decks: rates.length,
    median: median(sorted),
    bestOfK: best.winPct,
    worst: sorted[0] as number,
    bestDeckKey: best.deckKey,
  };
}

/**
 * Seeded PRNG — deterministic random number generation for game state.
 * Uses a simple mulberry32 algorithm — fast, good distribution, and
 * produces identical sequences from the same seed for replay support.
 */
import type { RngState } from '../types/game-state.js';

/** Create initial RNG state from a seed. */
export function createRng(seed: number): RngState {
  return { seed, counter: 0 };
}

/** Generate next random float [0, 1) and return new RNG state. */
export function nextRandom(rng: RngState): {
  readonly value: number;
  readonly nextRng: RngState;
} {
  const nextCounter = rng.counter + 1;
  const value = mulberry32(rng.seed + nextCounter);
  return {
    value,
    nextRng: { seed: rng.seed, counter: nextCounter },
  };
}

/** Generate a random integer in [min, max] inclusive. */
export function randomInt(
  rng: RngState,
  min: number,
  max: number,
): { readonly value: number; readonly nextRng: RngState } {
  const { value, nextRng } = nextRandom(rng);
  const result = min + Math.floor(value * (max - min + 1));
  return { value: result, nextRng };
}

/** Fisher-Yates shuffle with deterministic PRNG. */
export function shuffle<T>(
  items: readonly T[],
  rng: RngState,
): { readonly result: readonly T[]; readonly nextRng: RngState } {
  const arr = [...items];
  let currentRng = rng;

  for (let i = arr.length - 1; i > 0; i--) {
    const { value, nextRng } = randomInt(currentRng, 0, i);
    currentRng = nextRng;
    const temp = arr[i]!;
    arr[i] = arr[value]!;
    arr[value] = temp;
  }

  return { result: arr, nextRng: currentRng };
}

/** Mulberry32: simple 32-bit PRNG with good statistical properties. */
function mulberry32(seed: number): number {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

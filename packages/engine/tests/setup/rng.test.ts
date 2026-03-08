import { describe, it, expect } from 'vitest';
import { createRng, nextRandom, randomInt, shuffle } from '../../src/setup/rng.js';

describe('Seeded PRNG', () => {
  describe('nextRandom', () => {
    it('should produce deterministic values from same seed', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(42);

      const r1 = nextRandom(rng1);
      const r2 = nextRandom(rng2);

      expect(r1.value).toBe(r2.value);
    });

    it('should produce different values from different seeds', () => {
      const rng1 = createRng(42);
      const rng2 = createRng(99);

      const r1 = nextRandom(rng1);
      const r2 = nextRandom(rng2);

      expect(r1.value).not.toBe(r2.value);
    });

    it('should produce values in [0, 1)', () => {
      let rng = createRng(1);
      for (let i = 0; i < 100; i++) {
        const { value, nextRng } = nextRandom(rng);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
        rng = nextRng;
      }
    });

    it('should advance counter', () => {
      const rng = createRng(42);
      const { nextRng } = nextRandom(rng);
      expect(nextRng.counter).toBe(1);
      const { nextRng: nextRng2 } = nextRandom(nextRng);
      expect(nextRng2.counter).toBe(2);
    });
  });

  describe('randomInt', () => {
    it('should produce integers in [min, max]', () => {
      let rng = createRng(123);
      const seen = new Set<number>();
      for (let i = 0; i < 100; i++) {
        const { value, nextRng } = randomInt(rng, 1, 5);
        expect(value).toBeGreaterThanOrEqual(1);
        expect(value).toBeLessThanOrEqual(5);
        seen.add(value);
        rng = nextRng;
      }
      // Should see all values 1-5 in 100 iterations
      expect(seen.size).toBe(5);
    });
  });

  describe('shuffle', () => {
    it('should produce deterministic order from same seed', () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const rng1 = createRng(42);
      const rng2 = createRng(42);

      const s1 = shuffle(items, rng1);
      const s2 = shuffle(items, rng2);

      expect(s1.result).toEqual(s2.result);
    });

    it('should not modify original array', () => {
      const items = [1, 2, 3, 4, 5];
      const rng = createRng(42);
      shuffle(items, rng);
      expect(items).toEqual([1, 2, 3, 4, 5]);
    });

    it('should contain all original elements', () => {
      const items = [1, 2, 3, 4, 5];
      const rng = createRng(42);
      const { result } = shuffle(items, rng);
      expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle empty array', () => {
      const rng = createRng(42);
      const { result } = shuffle([], rng);
      expect(result).toEqual([]);
    });

    it('should handle single element', () => {
      const rng = createRng(42);
      const { result } = shuffle([42], rng);
      expect(result).toEqual([42]);
    });
  });
});

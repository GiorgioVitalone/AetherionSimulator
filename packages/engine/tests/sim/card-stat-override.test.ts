/**
 * EC-006 — per-card stat OVERRIDE toggle on the sim runner (sim-runner.mjs).
 *
 * The override is a default-OFF, sim-time-only hydration lever: a map of
 * cardId → { atk?, hp?, arm? } signed DELTAS, applied to matching card instances'
 * base + current stats at setup. Card data (aetherion-cards.json / DB) is NEVER
 * edited. We verify:
 *   1. an ON override mutates a matching card's hydrated base+current stats by the
 *      delta (and applies the HP>=1 / ATK,ARM>=0 floors), leaving non-matching
 *      cards and non-character cards untouched,
 *   2. OFF (undefined) and an empty / all-zero map leave every card's stats
 *      byte-identical (no-op), and
 *   3. an empty / all-zero override hashes identically to OFF in a real runSim,
 *      while a real override changes the hash and stays deterministic.
 *
 * Skips gracefully if the built dist + cards JSON aren't present (mirrors the
 * other sim tests).
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(here, '..', '..', 'sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = '/Users/gvitalone/Projects/personal/temp/aetherion-cards.json';

const ready = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const d = ready ? describe : describe.skip;

interface Stats {
  cardDefId: number;
  cardType: string;
  baseHp: number;
  baseAtk: number;
  baseArm: number;
  currentHp: number;
  currentAtk: number;
  currentArm: number;
}
// Minimal GameState fixture — applyCardStatOverride only reads the fields above.
function card(cardDefId: number, cardType: string, atk: number, hp: number, arm: number): Stats {
  return { cardDefId, cardType, baseAtk: atk, baseHp: hp, baseArm: arm, currentAtk: atk, currentHp: hp, currentArm: arm };
}
function gameState(handA: Stats[], deckB: Stats[]) {
  return {
    players: [
      { hand: handA, mainDeck: [] as Stats[] },
      { hand: [] as Stats[], mainDeck: deckB },
    ],
  };
}

d('EC-006 cardStatOverride hydration override', () => {
  it('applies signed deltas to a matching card (base + current), with floors, leaving others untouched', async () => {
    const { applyCardStatOverride } = (await import(runnerPath)) as {
      applyCardStatOverride: (gs: unknown, map: unknown) => { players: { hand: Stats[]; mainDeck: Stats[] }[] };
    };
    // id48 Shieldbearer Paladin 2/3 → −1 hp; id42 Blessed Squire 1/1 → −1 atk (floors to 0);
    // id99 a 1/1 with −5 hp must floor to 1; a non-character (S) must be ignored.
    const paladin = card(48, 'C', 2, 3, 0);
    const squire = card(42, 'C', 1, 1, 0);
    const floored = card(99, 'C', 1, 1, 0);
    const spell = card(48, 'S', 9, 9, 9); // same id but not a character → untouched
    const bystander = card(7, 'C', 3, 4, 1); // not in the override → untouched
    const gs = gameState([paladin, squire, floored, spell], [bystander]);

    const out = applyCardStatOverride(gs, {
      48: { hp: -1 },
      42: { atk: -1 },
      99: { hp: -5 },
    });

    const [p, s, f, sp] = out.players[0].hand;
    const [by] = out.players[1].mainDeck;
    // Paladin 2/3 → 2/2 on base AND current.
    expect([p.baseAtk, p.baseHp, p.baseArm]).toEqual([2, 2, 0]);
    expect([p.currentAtk, p.currentHp, p.currentArm]).toEqual([2, 2, 0]);
    // Squire 1/1 → 0/1 (ATK floored at 0).
    expect([s.baseAtk, s.baseHp]).toEqual([0, 1]);
    expect([s.currentAtk, s.currentHp]).toEqual([0, 1]);
    // 1/1 − 5 hp floors at HP 1 (never born dead).
    expect(f.baseHp).toBe(1);
    expect(f.currentHp).toBe(1);
    // Non-character with the same id is untouched.
    expect([sp.baseAtk, sp.baseHp, sp.baseArm]).toEqual([9, 9, 9]);
    // Card not in the override is untouched.
    expect([by.baseAtk, by.baseHp, by.baseArm]).toEqual([3, 4, 1]);
  });

  it('OFF (undefined) and empty / all-zero maps are a no-op (stats byte-identical)', async () => {
    const { applyCardStatOverride } = (await import(runnerPath)) as {
      applyCardStatOverride: (gs: unknown, map: unknown) => unknown;
    };
    const make = () => gameState([card(48, 'C', 2, 3, 0)], [card(42, 'C', 1, 1, 0)]);
    const ref = JSON.stringify(make());
    for (const m of [undefined, {}, { 48: {} }, { 48: { hp: 0, atk: 0, arm: 0 } }]) {
      expect(JSON.stringify(applyCardStatOverride(make(), m))).toBe(ref);
    }
  });

  it('OFF and an empty/all-zero override reproduce the same runHash; a real override changes it deterministically', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string; factionWinPct: Record<string, number> };
    };
    const base = {
      matchups: ['Onyx', 'Radiant'] as string[],
      gamesPerPairing: 6,
      turnCap: 60,
      abilitiesOn: true,
      botPolicy: 'heuristic' as const,
      seedBase: 31337,
    };
    const off = runSim(base);
    // Empty / all-zero override must be byte-identical to OFF (default-off no-op).
    expect(runSim({ ...base, cardStatOverride: {} }).runHash).toBe(off.runHash);
    expect(runSim({ ...base, cardStatOverride: { 48: { hp: 0 } } }).runHash).toBe(off.runHash);
    // A real override changes the hash and is deterministic across two calls.
    const on1 = runSim({ ...base, cardStatOverride: { 48: { hp: -1 } } });
    const on2 = runSim({ ...base, cardStatOverride: { 48: { hp: -1 } } });
    expect(on1.runHash).toBe(on2.runHash);
    expect(on1.runHash).not.toBe(off.runHash);
  }, 30000);
});

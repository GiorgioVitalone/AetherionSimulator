/**
 * §13q seat-asymmetry fix — two related knobs:
 *   - apnapAnyOrderFix (engine, GameConfig): side:'any' target resolution returns
 *     [activePlayer, nonActivePlayer] (APNAP) instead of seat order [0,1].
 *   - seatAlternation (sim-runner harness config): swaps which deck sits in seat 0
 *     on a 4-phase cycle, uncorrelated with firstPlayer:'alternating'.
 *
 * Both default OFF and must be byte-identical no-ops; both must deterministically
 * diverge from baseline when ON.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargets } from '../../src/effects/target-resolver.js';
import type { EffectContext, GameConfig } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import { deployToZone } from '../../src/zones/zone-manager.js';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

// ── apnapAnyOrderFix (engine: target-resolver) ────────────────────────────────
describe('apnapAnyOrderFix knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWith(config: GameConfig) {
    const c0 = mockCard({ owner: 0 });
    const c1 = mockCard({ owner: 1 });
    const p0 = deployToZone(emptyZones(), c0, 'frontline');
    const p1 = deployToZone(emptyZones(), c1, 'frontline');
    const state = mockGameState({
      activePlayerIndex: 1,
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      config,
    });
    return { state, c0: c0.instanceId, c1: c1.instanceId };
  }

  it('OFF (default): side:"any" resolves in SEAT order regardless of active player', () => {
    const { state, c0, c1 } = stateWith({ terminationMode: 'turn_cap' });
    const res = resolveTargets(state, { type: 'all_characters', side: 'any' }, ctx(c1, 1));
    expect(res.resolved).toBe(true);
    expect(res.resolved ? res.targetIds : []).toEqual([c0, c1]);
  });

  it('ON: side:"any" resolves [activePlayer, nonActivePlayer] (APNAP order)', () => {
    const { state, c0, c1 } = stateWith({ terminationMode: 'turn_cap', apnapAnyOrderFix: true });
    const res = resolveTargets(state, { type: 'all_characters', side: 'any' }, ctx(c1, 1));
    expect(res.resolved).toBe(true);
    // activePlayerIndex is 1, so player 1's card comes first.
    expect(res.resolved ? res.targetIds : []).toEqual([c1, c0]);
  });

  it('ON with active player 0: order matches the unflagged seat order (same members)', () => {
    const c0 = mockCard({ owner: 0 });
    const c1 = mockCard({ owner: 1 });
    const p0 = deployToZone(emptyZones(), c0, 'frontline');
    const p1 = deployToZone(emptyZones(), c1, 'frontline');
    const state = mockGameState({
      activePlayerIndex: 0,
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      config: { terminationMode: 'turn_cap', apnapAnyOrderFix: true },
    });
    const res = resolveTargets(
      state,
      { type: 'all_characters', side: 'any' },
      ctx(c0.instanceId, 0),
    );
    expect(res.resolved).toBe(true);
    expect(res.resolved ? res.targetIds : []).toEqual([c0.instanceId, c1.instanceId]);
  });
});

// ── runSim: byte-identical no-op + deterministic divergence ──────────────────
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('§13q seat-fix knobs: byte-identical no-op + determinism (runSim)', () => {
  it('apnapAnyOrderFix: absent/false ⇒ baseline hash; true ⇒ diverges deterministically', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = {
      matchups: 'all-pairs',
      gamesPerPairing: 3,
      seedBase: 4242,
      abilitiesOn: true,
    } as const;
    const off = runSim(base).runHash;

    expect(runSim({ ...base, apnapAnyOrderFix: false }).runHash).toBe(off);

    const on = runSim({ ...base, apnapAnyOrderFix: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, apnapAnyOrderFix: true }).runHash).toBe(on);
  }, 30000);

  it('seatAlternation: absent/false ⇒ baseline hash; true ⇒ diverges deterministically', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = {
      matchups: 'all-pairs',
      gamesPerPairing: 4,
      seedBase: 4242,
      firstPlayer: 'alternating',
      abilitiesOn: true,
    } as const;
    const off = runSim(base).runHash;

    expect(runSim({ ...base, seatAlternation: false }).runHash).toBe(off);

    const on = runSim({ ...base, seatAlternation: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, seatAlternation: true }).runHash).toBe(on);
  }, 30000);

  // runHash covers only {fA,fB,seed,winner,firstPlayer,turns,timedOut,leaderAt10},
  // NOT dx/spellsCast — so a remap regression on telemetry fields would be invisible
  // to the hash tests above. This unit test closes that class.
  it('remapSeatSwap: flips every seat-indexed field, preserves scalars', async () => {
    const { remapSeatSwap } = (await import(runnerPath)) as {
      remapSeatSwap: (r: Record<string, unknown>, a: string, b: string) => Record<string, unknown>;
    };
    const raw = {
      fA: 'Onyx',
      fB: 'Verdant',
      seed: 7,
      winner: 0,
      firstPlayer: 1,
      turns: 30,
      timedOut: false,
      leaderAt10: 1,
      firstPlayerWon: false,
      spellsCastA: 3,
      spellsCastB: 8,
      dx: {
        winMethod: 'kill',
        winnerLp: 12,
        transformed: [true, false],
        transformTurn: [22, null],
        resAt: [
          [2, 5, 8],
          [3, 5, 7],
        ],
        deploys: [14, 17],
        discards: [0, 2],
      },
    };
    const r = remapSeatSwap(raw, 'Verdant', 'Onyx');
    expect(r.fA).toBe('Verdant');
    expect(r.fB).toBe('Onyx');
    expect(r.winner).toBe(1);
    expect(r.firstPlayer).toBe(0);
    expect(r.leaderAt10).toBe(0);
    expect(r.spellsCastA).toBe(8);
    expect(r.spellsCastB).toBe(3);
    const dx = r.dx as Record<string, unknown>;
    expect(dx.transformed).toEqual([false, true]);
    expect(dx.transformTurn).toEqual([null, 22]);
    expect(dx.resAt).toEqual([
      [3, 5, 7],
      [2, 5, 8],
    ]); // outer seats flip, inner buckets intact
    expect(dx.deploys).toEqual([17, 14]);
    expect(dx.discards).toEqual([2, 0]);
    expect(dx.winMethod).toBe('kill');
    expect(dx.winnerLp).toBe(12);
    // invariants under a both-operand flip
    expect(r.firstPlayerWon).toBe(false);
    expect(r.turns).toBe(30);
    expect(r.seed).toBe(7);
  });
});

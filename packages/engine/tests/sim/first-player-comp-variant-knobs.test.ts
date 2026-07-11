/**
 * §13r first-player-compensation CANDIDATE variants — under evaluation as an
 * alternative to the locked `firstPlayerCompensation: 'card'` rule. Two
 * independent flags, both default OFF:
 *   - firstPlayerSkipsFirstResource (engine, GameConfig): the first player draws
 *     no Resource Card on their FIRST Upkeep only (drawResourceCard).
 *   - firstPlayerDrawsNormally (engine, GameConfig): disables ONLY the
 *     first-player-first-turn Main Deck draw skip (game-machine.ts); the
 *     turn-1 attack restriction is untouched.
 *
 * Both default OFF and must be byte-identical no-ops; both must deterministically
 * diverge from baseline when ON.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createActor } from 'xstate';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { drawResourceCard } from '../../src/state-machine/actions.js';
import type { GameConfig, GameState, ResourceCard } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);

function resDeck(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `r_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

// ── firstPlayerSkipsFirstResource (engine: drawResourceCard) ─────────────────
describe('firstPlayerSkipsFirstResource knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function stateWith(config: GameConfig, firstPlayerFirstTurn: boolean): GameState {
    return mockGameState({
      players: [mockPlayerState(0, { resourceDeck: resDeck(10) }), mockPlayerState(1)],
      turnState: { discardedForEnergy: false, firstPlayerFirstTurn },
      config,
    });
  }

  it("OFF (default/absent): draws exactly 1 resource on the first player's first turn", () => {
    const r = drawResourceCard(stateWith({ terminationMode: 'turn_cap' }, true));
    expect(r.state.players[0]!.resourceBank).toHaveLength(1);
    expect(r.state.players[0]!.resourceDeck).toHaveLength(9);
    expect(r.events).toHaveLength(1);
  });

  it('ON + firstPlayerFirstTurn: draws 0 resources (skipped)', () => {
    const r = drawResourceCard(
      stateWith({ terminationMode: 'turn_cap', firstPlayerSkipsFirstResource: true }, true),
    );
    expect(r.state.players[0]!.resourceBank).toHaveLength(0);
    expect(r.state.players[0]!.resourceDeck).toHaveLength(10);
    expect(r.events).toHaveLength(0);
  });

  it('ON + NOT firstPlayerFirstTurn: draws normally (unaffected)', () => {
    const r = drawResourceCard(
      stateWith({ terminationMode: 'turn_cap', firstPlayerSkipsFirstResource: true }, false),
    );
    expect(r.state.players[0]!.resourceBank).toHaveLength(1);
    expect(r.state.players[0]!.resourceDeck).toHaveLength(9);
  });
});

// ── firstPlayerDrawsNormally (engine: game-machine draw-skip guard) ──────────
describe('firstPlayerDrawsNormally knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function makeUpkeepState(config?: GameConfig): GameState {
    const deck = Array.from({ length: 20 }, (_, i) =>
      mockCard({ name: `Deck${String(i)}`, owner: 0 }),
    );
    return mockGameState({
      phase: 'upkeep',
      pendingChoice: null,
      turnState: { discardedForEnergy: false, firstPlayerFirstTurn: true },
      players: [
        mockPlayerState(0, { hand: [mockCard({ owner: 0 })], mainDeck: deck }),
        mockPlayerState(1, { hand: [mockCard({ owner: 1 })], mainDeck: [] }),
      ],
      config,
    });
  }

  it("OFF (default/absent): main deck draw is still skipped on first player's first turn", () => {
    const state = makeUpkeepState();
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    const ctx = actor.getSnapshot().context;
    expect(ctx.gameState.players[0]!.hand.length).toBe(1);
    expect(ctx.gameState.players[0]!.mainDeck.length).toBe(20);
  });

  it('ON: first player draws a Main Deck card like any other turn', () => {
    const state = makeUpkeepState({ firstPlayerDrawsNormally: true });
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    const ctx = actor.getSnapshot().context;
    expect(ctx.gameState.players[0]!.hand.length).toBe(2);
    expect(ctx.gameState.players[0]!.mainDeck.length).toBe(19);
  });

  it('ON: the turn-1 attack restriction is untouched (firstPlayerFirstTurn flag stays true)', () => {
    const state = makeUpkeepState({ firstPlayerDrawsNormally: true });
    const actor = createActor(gameMachine, { input: { gameState: state } });
    actor.start();
    expect(actor.getSnapshot().context.gameState.turnState.firstPlayerFirstTurn).toBe(true);
  });
});

// ── runSim: byte-identical no-op + deterministic divergence ──────────────────
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('§13r first-player-comp variant knobs: byte-identical no-op + determinism (runSim)', () => {
  it('firstPlayerSkipsFirstResource: absent/false ⇒ baseline hash; true ⇒ diverges deterministically', async () => {
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

    expect(runSim({ ...base, firstPlayerSkipsFirstResource: false }).runHash).toBe(off);

    const on = runSim({ ...base, firstPlayerSkipsFirstResource: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, firstPlayerSkipsFirstResource: true }).runHash).toBe(on);
  }, 30000);

  it('firstPlayerDrawsNormally: absent/false ⇒ baseline hash; true ⇒ diverges deterministically', async () => {
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

    expect(runSim({ ...base, firstPlayerDrawsNormally: false }).runHash).toBe(off);

    const on = runSim({ ...base, firstPlayerDrawsNormally: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, firstPlayerDrawsNormally: true }).runHash).toBe(on);
  }, 30000);
});

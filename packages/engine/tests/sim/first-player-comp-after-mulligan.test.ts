/**
 * §? firstPlayerCompAfterMulligan (harness-only, sim-runner.mjs) — the
 * second-player compensation card should be dealt AFTER mulligans resolve
 * (Rulebook: "after any mulligans"), not before. Default OFF ⇒ byte-identical
 * to the current (pre-mulligan) ordering.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createGame,
  applyMulligan,
  resetSetupInstanceCounter,
} from '../../src/setup/game-setup.js';
import type {
  CardDefinition,
  HeroDefinition,
  CardDefinitionRegistry,
} from '../../src/setup/game-setup.js';
import { MULLIGAN_HAND_SIZE, INITIAL_HAND_SIZE } from '../../src/types/game-state.js';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

// All-Equipment decks so shouldKeepHand's `plays.length >= 2` (C/S cards only)
// is guaranteed false for BOTH players ⇒ both mulligan deterministically,
// regardless of which seat ends up "second" (first-player is randomized by
// createGame's own rng draw).
function makeCardDef(id: number): CardDefinition {
  return {
    id,
    name: `Equip ${String(id)}`,
    cardType: 'E',
    cost: { mana: 1, energy: 0, flexible: 0 },
  };
}

function makeHeroDef(id: number): HeroDefinition {
  return { id, name: `Hero ${String(id)}`, lp: 25, alignment: ['Onyx'] };
}

function makeResourceDef(id: number): CardDefinition {
  return {
    id,
    name: `Mana Crystal ${String(id)}`,
    cardType: 'R',
    cost: { mana: 0, energy: 0, flexible: 0 },
  };
}

function createTestRegistry(): CardDefinitionRegistry {
  const cards = new Map<number, CardDefinition>();
  const heroes = new Map<number, HeroDefinition>();
  for (let i = 1; i <= 40; i++) cards.set(i, makeCardDef(i));
  for (let i = 101; i <= 115; i++) cards.set(i, makeResourceDef(i));
  heroes.set(200, makeHeroDef(200));
  return { getCard: (id) => cards.get(id), getHero: (id) => heroes.get(id) };
}

const mainDeckIds = Array.from({ length: 40 }, (_, i) => i + 1);
const resourceDeckIds = Array.from({ length: 15 }, (_, i) => i + 101);
const deckSelection = {
  heroDefId: 200,
  mainDeckDefIds: mainDeckIds,
  resourceDeckDefIds: resourceDeckIds,
};

ds('firstPlayerCompAfterMulligan knob (harness: sim-runner.mjs)', () => {
  beforeEach(() => resetSetupInstanceCounter());

  it('OFF (default/current order): compensating BEFORE a forced mulligan loses the bonus card', async () => {
    const { applyCompensation } = (await import(runnerPath)) as {
      applyCompensation: (gs: unknown, mode: string, faction: string) => any;
    };
    const registry = createTestRegistry();
    const gs = createGame(deckSelection, deckSelection, registry, 4242);
    const second = gs.activePlayerIndex === 0 ? 1 : 0;

    let state = applyCompensation(gs, 'card', 'Onyx');
    expect(state.players[second]!.hand.length).toBe(INITIAL_HAND_SIZE + 1);

    // Both players mulligan (redraw), losing whatever they were holding.
    state = applyMulligan(state, 0, false);
    state = applyMulligan(state, 1, false);
    expect(state.players[second]!.hand.length).toBe(MULLIGAN_HAND_SIZE);
  });

  it('ON: compensating AFTER mulligans resolve preserves the bonus card', async () => {
    const { applyCompensation, resolveMulligans } = (await import(runnerPath)) as {
      applyCompensation: (gs: unknown, mode: string, faction: string) => any;
      resolveMulligans: (gs: unknown, policyForSeat: (seat: 0 | 1) => string) => any;
    };
    const registry = createTestRegistry();
    const gs = createGame(deckSelection, deckSelection, registry, 4242);
    const second = gs.activePlayerIndex === 0 ? 1 : 0;

    let state = resolveMulligans(gs, () => 'heuristic');
    expect(state.players[second]!.hand.length).toBe(MULLIGAN_HAND_SIZE);

    state = applyCompensation(state, 'card', 'Onyx');
    expect(state.players[second]!.hand.length).toBe(MULLIGAN_HAND_SIZE + 1);
  });

  it('runSim: firstPlayerCompAfterMulligan absent/false ⇒ baseline hash; true ⇒ diverges deterministically', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = {
      matchups: 'all-pairs',
      gamesPerPairing: 3,
      seedBase: 4242,
      abilitiesOn: true,
      firstPlayerCompensation: 'card',
    } as const;
    const off = runSim(base).runHash;

    expect(runSim({ ...base, firstPlayerCompAfterMulligan: false }).runHash).toBe(off);

    const on = runSim({ ...base, firstPlayerCompAfterMulligan: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, firstPlayerCompAfterMulligan: true }).runHash).toBe(on);
  }, 30000);
});

// ── runSim contract for an engine-core flag (endPhaseOrderFix) ───────────────
ds('endPhaseOrderFix knob: byte-identical no-op + determinism (runSim)', () => {
  it('endPhaseOrderFix: absent/false ⇒ baseline hash; true ⇒ diverges deterministically', async () => {
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

    expect(runSim({ ...base, endPhaseOrderFix: false }).runHash).toBe(off);

    const on = runSim({ ...base, endPhaseOrderFix: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, endPhaseOrderFix: true }).runHash).toBe(on);
  }, 30000);
});

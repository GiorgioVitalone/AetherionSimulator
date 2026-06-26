/**
 * Design knobs (default-OFF no-ops) added for the 28-hypothesis balance sweep:
 *   - equalizeHeroLp:  sim-time — set EVERY hero's starting+max LP to a fixed value.
 *   - atkBonus:        sim-time — flat +N to every CHARACTER's ATK (base+current).
 *   - startingCardBonus: sim-time — +N opening-hand cards per player.
 *   - noOverheal:      engine — suppress the CHARACTER_OVERHEALED signal (no payoff).
 *   - resourceRampBonus: engine — draw 1+N Resource cards per Upkeep.
 *   - directHighGroundDeploy: engine — any character may deploy direct to High Ground.
 *
 * Engine-read knobs are asserted via their engine entry points; the sim-time knobs
 * via the exported pure transforms. The byte-identical-no-op + determinism guarantee
 * is asserted through runSim (explicit-default values reproduce the baseline runHash;
 * real values diverge deterministically).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeEffect } from '../../src/effects/interpreter.js';
import { drawResourceCard } from '../../src/state-machine/actions.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type {
  EffectContext,
  GameConfig,
  GameState,
  ResourceCard,
} from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  mockHero,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

// ── noOverheal (engine: interpreter) ──────────────────────────────────────────
describe('noOverheal knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  const overheal: Effect = {
    type: 'heal',
    amount: { type: 'fixed', value: 5 },
    target: { type: 'self' },
  };
  // A 1-HP body with 3 max, healed for 5 → 2 healed, 3 excess (overheal).
  function stateWith(config: GameConfig) {
    const src = mockCard({ owner: 0, currentHp: 1, baseHp: 3 });
    const p0 = deployToZone(emptyZones(), src, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1)],
      config,
    });
    return { state, src: src.instanceId };
  }

  it('OFF (default): HP caps at max AND a CHARACTER_OVERHEALED event fires', () => {
    const { state, src } = stateWith({ terminationMode: 'turn_cap' });
    const res = executeEffect(state, overheal, ctx(src));
    const c = res.newState.players[0]!.zones.frontline.find(x => x?.instanceId === src);
    expect(c!.currentHp).toBe(3); // capped at baseHp
    const ev = res.events.find(e => e.type === 'CHARACTER_OVERHEALED');
    expect(ev && ev.type === 'CHARACTER_OVERHEALED' ? ev.excess : 0).toBe(3);
  });

  it('ON: HP still caps at max but the CHARACTER_OVERHEALED event is suppressed', () => {
    const { state, src } = stateWith({ terminationMode: 'turn_cap', noOverheal: true });
    const res = executeEffect(state, overheal, ctx(src));
    const c = res.newState.players[0]!.zones.frontline.find(x => x?.instanceId === src);
    expect(c!.currentHp).toBe(3); // identical cap
    expect(res.events.some(e => e.type === 'CHARACTER_OVERHEALED')).toBe(false);
    // The realized (capped) CHARACTER_HEALED still fires — only the overheal is gone.
    expect(res.events.some(e => e.type === 'CHARACTER_HEALED')).toBe(true);
  });
});

// ── resourceRampBonus (engine: drawResourceCard) ──────────────────────────────
describe('resourceRampBonus knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function deck(n: number): ResourceCard[] {
    return Array.from({ length: n }, (_, i) => ({
      instanceId: `r_${String(i)}`,
      resourceType: 'mana' as const,
      exhausted: false,
    }));
  }
  function stateWith(config: GameConfig, deckSize: number) {
    return mockGameState({
      players: [mockPlayerState(0, { resourceDeck: deck(deckSize) }), mockPlayerState(1)],
      config,
    });
  }

  it('OFF (default/absent): draws exactly 1 resource', () => {
    const r = drawResourceCard(stateWith({ terminationMode: 'turn_cap' }, 10));
    expect(r.state.players[0]!.resourceBank).toHaveLength(1);
    expect(r.state.players[0]!.resourceDeck).toHaveLength(9);
    expect(r.events).toHaveLength(1);
  });

  it('bonus 1: draws 2 resources (1 standard + 1 bonus)', () => {
    const r = drawResourceCard(stateWith({ terminationMode: 'turn_cap', resourceRampBonus: 1 }, 10));
    expect(r.state.players[0]!.resourceBank).toHaveLength(2);
    expect(r.state.players[0]!.resourceDeck).toHaveLength(8);
    expect(r.events).toHaveLength(2);
  });

  it('never draws past the live Resource Deck', () => {
    const r = drawResourceCard(stateWith({ terminationMode: 'turn_cap', resourceRampBonus: 5 }, 2));
    expect(r.state.players[0]!.resourceBank).toHaveLength(2); // deck had only 2
    expect(r.state.players[0]!.resourceDeck).toHaveLength(0);
  });
});

// ── directHighGroundDeploy (engine: available-actions) ────────────────────────
describe('directHighGroundDeploy knob (engine)', () => {
  beforeEach(() => resetInstanceCounter());

  function bank(n: number): ResourceCard[] {
    return Array.from({ length: n }, (_, i) => ({
      instanceId: `b_${String(i)}`,
      resourceType: 'mana' as const,
      exhausted: false,
    }));
  }
  function stateWith(config: GameConfig | undefined) {
    // A plain (non-Elite) 1-cost character with plenty of resources.
    const handCard = mockCard({
      name: 'Footsoldier',
      cardType: 'C',
      cost: { mana: 1, energy: 0, flexible: 0 },
      owner: 0,
      traits: [],
    });
    return mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hand: [handCard], resourceBank: bank(5) }), mockPlayerState(1)],
      ...(config ? { config } : {}),
    });
  }

  it('OFF (default): a non-Elite character is NOT offered a High Ground slot', () => {
    const acts = computeAvailableActions(stateWith(undefined));
    const zones = acts.canDeploy[0]!.validSlots.map(g => g.zone);
    expect(zones).toContain('frontline');
    expect(zones).toContain('reserve');
    expect(zones).not.toContain('high_ground');
  });

  it('ON: a non-Elite character may deploy directly to High Ground at surcharge 0', () => {
    const acts = computeAvailableActions(
      stateWith({ terminationMode: 'turn_cap', directHighGroundDeploy: true }),
    );
    const hg = acts.canDeploy[0]!.validSlots.find(g => g.zone === 'high_ground');
    expect(hg).toBeDefined();
    expect(hg!.surcharge).toBe(0);
  });
});

// ── sim-time transforms (sim-runner pure helpers) ─────────────────────────────
const ready = existsSync(runnerPath);
const d = ready ? describe : describe.skip;

d('sim-time knobs (pure transforms)', () => {
  interface MiniHero { currentLp: number; maxLp: number }
  interface MiniCard { cardType: string; baseAtk: number; currentAtk: number }
  function gs(p0Hero: MiniHero, p1Hero: MiniHero, hand: MiniCard[], deck: MiniCard[]): unknown {
    return {
      players: [
        { hero: p0Hero, hand, mainDeck: deck },
        { hero: p1Hero, hand: [], mainDeck: [] },
      ],
    };
  }

  it('equalizeHeroLp sets every hero current+max LP to the value; absent ⇒ no-op', async () => {
    const { applyEqualizeHeroLp } = (await import(runnerPath)) as {
      applyEqualizeHeroLp: (gs: unknown, lp?: number) => { players: { hero: MiniHero }[] };
    };
    const state = gs({ currentLp: 35, maxLp: 35 }, { currentLp: 30, maxLp: 30 }, [], []);
    const eq = applyEqualizeHeroLp(state, 25);
    expect(eq.players[0]!.hero).toEqual({ currentLp: 25, maxLp: 25 });
    expect(eq.players[1]!.hero).toEqual({ currentLp: 25, maxLp: 25 });
    // No-op: absent/non-number returns the same object.
    expect(applyEqualizeHeroLp(state, undefined)).toBe(state);
  });

  it('atkBonus adds flat ATK to characters only (base+current); 0/absent ⇒ no-op', async () => {
    const { applyAtkBonus } = (await import(runnerPath)) as {
      applyAtkBonus: (gs: unknown, b?: number) => { players: { hand: MiniCard[]; mainDeck: MiniCard[] }[] };
    };
    const hand = [{ cardType: 'C', baseAtk: 1, currentAtk: 1 }, { cardType: 'S', baseAtk: 0, currentAtk: 0 }];
    const deck = [{ cardType: 'C', baseAtk: 3, currentAtk: 3 }];
    const state = gs({ currentLp: 30, maxLp: 30 }, { currentLp: 30, maxLp: 30 }, hand, deck);
    const out = applyAtkBonus(state, 1);
    expect(out.players[0]!.hand[0]).toMatchObject({ baseAtk: 2, currentAtk: 2 }); // creature +1
    expect(out.players[0]!.hand[1]).toMatchObject({ baseAtk: 0, currentAtk: 0 }); // spell untouched
    expect(out.players[0]!.mainDeck[0]).toMatchObject({ baseAtk: 4, currentAtk: 4 });
    expect(applyAtkBonus(state, 0)).toBe(state); // no-op
  });

  it('startingCardBonus moves N cards deck→hand per player; 0/absent ⇒ no-op', async () => {
    const { applyStartingCardBonus } = (await import(runnerPath)) as {
      applyStartingCardBonus: (gs: unknown, b?: number) => { players: { hand: MiniCard[]; mainDeck: MiniCard[] }[] };
    };
    const deck = [
      { cardType: 'C', baseAtk: 1, currentAtk: 1 },
      { cardType: 'C', baseAtk: 2, currentAtk: 2 },
    ];
    const state = gs({ currentLp: 30, maxLp: 30 }, { currentLp: 30, maxLp: 30 }, [], deck);
    const out = applyStartingCardBonus(state, 1);
    expect(out.players[0]!.hand).toHaveLength(1);
    expect(out.players[0]!.mainDeck).toHaveLength(1);
    expect(applyStartingCardBonus(state, 0)).toBe(state); // no-op
  });
});

// ── runSim: byte-identical no-op + determinism ────────────────────────────────
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('design knobs: byte-identical no-op + determinism (runSim)', () => {
  it('explicit-default knobs reproduce the locked-base hash; real knobs diverge deterministically', async () => {
    const { runSim } = (await import(runnerPath)) as { runSim: (c: unknown) => { runHash: string } };
    // LOCKED BASE adopted for the sweep.
    const base = {
      matchups: 'all-pairs',
      gamesPerPairing: 3,
      seedBase: 4242,
      armBuffsTakeMax: true,
      defenderHighGroundOnly: true,
    } as const;
    const off = runSim(base).runHash;

    // Explicit-default values collapse to the no-op baseline (not emitted into the hash).
    expect(runSim({ ...base, atkBonus: 0 }).runHash).toBe(off);
    expect(runSim({ ...base, startingCardBonus: 0 }).runHash).toBe(off);
    expect(runSim({ ...base, resourceRampBonus: 0 }).runHash).toBe(off);
    expect(runSim({ ...base, noOverheal: false }).runHash).toBe(off);
    expect(runSim({ ...base, directHighGroundDeploy: false }).runHash).toBe(off);

    // Real knob values diverge from the baseline, and are deterministic across calls.
    for (const o of [
      { equalizeHeroLp: 25 },
      { atkBonus: 1 },
      { startingCardBonus: 1 },
      { noOverheal: true },
      { resourceRampBonus: 1 },
      { directHighGroundDeploy: true },
    ]) {
      const h = runSim({ ...base, ...o }).runHash;
      expect(h, JSON.stringify(o)).not.toBe(off);
      expect(runSim({ ...base, ...o }).runHash, JSON.stringify(o)).toBe(h);
    }
  }, 30000);
});

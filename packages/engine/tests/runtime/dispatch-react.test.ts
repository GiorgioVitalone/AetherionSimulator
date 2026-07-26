import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchTriggers } from '../../src/runtime/dispatch.js';
import {
  registerCardTriggers,
  getAllRegisteredTriggers,
  resetRegistrationCounter,
} from '../../src/events/trigger-registry.js';
import { applyAuraNonStatEffect } from '../../src/runtime/aura-nonstat.js';
import { refreshCards } from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, GameEvent, GameState } from '../../src/types/game-state.js';

// [React]: event-driven ability that exhausts its source when it procs, and cannot
// proc while the source is already exhausted (exhaust-gated, not counter-gated).

const reactDrawOnStatMod: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_stat_modified', side: 'allied' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
  react: true,
};

const reactDrawWithFailingCondition: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_stat_modified', side: 'allied' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
  condition: { type: 'hp_threshold', comparison: 'less_equal', value: 1 },
  react: true,
};

function deck(n: number): ReturnType<typeof mockCard>[] {
  return Array.from({ length: n }, () => mockCard({ owner: 0, name: 'Top' }));
}

function statModEvent(id: string): GameEvent {
  return { type: 'STAT_MODIFIED', cardInstanceId: id, modifier: { atk: 1 }, playerId: 0 };
}

function buildState(
  reactor: ReturnType<typeof mockCard>,
  ally: ReturnType<typeof mockCard>,
  configOverrides?: Partial<GameState['config']>,
): GameState {
  return mockGameState({
    players: [
      mockPlayerState(0, {
        zones: zonesWithCards({ frontline: [reactor, ally, null] }),
        mainDeck: deck(5),
      }),
      mockPlayerState(1),
    ],
    log: [{ type: 'TURN_START', playerId: 0, turnNumber: 1 }],
    config: configOverrides,
  });
}

describe('[React] abilities', () => {
  beforeEach(() => {
    resetInstanceCounter();
    resetRegistrationCounter();
  });

  it('flag OFF: react is inert — procs repeatedly and never exhausts the source', () => {
    const reactor = mockCard({ owner: 0, name: 'Reactor', abilities: [reactDrawOnStatMod] });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = buildState(reactor, ally); // no config ⇒ reactAbilities absent
    const registered = registerCardTriggers(base, reactor.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(1);
    const source1 = r1.newState.players[0]!.zones.frontline[0];
    expect(source1?.exhausted).toBe(false);

    const r2 = dispatchTriggers(r1.newState, [statModEvent(ally.instanceId)], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(2);
    const source2 = r2.newState.players[0]!.zones.frontline[0];
    expect(source2?.exhausted).toBe(false);
  });

  it('flag ON: procs once, exhausts the source, and does not proc again that turn', () => {
    const reactor = mockCard({ owner: 0, name: 'Reactor', abilities: [reactDrawOnStatMod] });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = buildState(reactor, ally, { reactAbilities: true });
    const registered = registerCardTriggers(base, reactor.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(1);
    const source1 = r1.newState.players[0]!.zones.frontline[0];
    expect(source1?.exhausted).toBe(true);

    // Second stat-mod event, same turn: the source is exhausted, so it cannot React.
    const r2 = dispatchTriggers(r1.newState, [statModEvent(ally.instanceId)], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(1);
  });

  it('flag ON: a failed condition does not exhaust or consume the React', () => {
    const reactor = mockCard({
      owner: 0,
      name: 'Reactor',
      abilities: [reactDrawWithFailingCondition],
    });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = buildState(reactor, ally, { reactAbilities: true });
    const registered = registerCardTriggers(base, reactor.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    // currentHp defaults to 3, so `hp_threshold <= 1` fails: no draw, no exhaust.
    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(0);
    const source = r1.newState.players[0]!.zones.frontline[0];
    expect(source?.exhausted).toBe(false);
  });

  it('flag ON: a source already exhausted (e.g. by attacking) cannot React', () => {
    const reactor = mockCard({
      owner: 0,
      name: 'Reactor',
      abilities: [reactDrawOnStatMod],
      exhausted: true,
    });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = buildState(reactor, ally, { reactAbilities: true });
    const registered = registerCardTriggers(base, reactor.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(0);
  });

  it('flag ON: a React granted via equipment (aura -> grant_ability) still respects the limit', () => {
    const carrier = mockCard({ owner: 0, name: 'Equipped Character' });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = buildState(carrier, ally, { reactAbilities: true });

    // Simulate the equipment-aura grant path: aura -> grant_ability -> equipped_character
    // (the same applyAuraNonStatEffect / applyGrantAbility routine equipment auras use).
    const grantEffect: Extract<Effect, { type: 'grant_ability' }> = {
      type: 'grant_ability',
      ability: {
        trigger: { type: 'on_stat_modified', side: 'allied' },
        effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
        react: true,
      },
      target: { type: 'self' },
      duration: { type: 'while_in_play' },
    };
    const context: EffectContext = {
      sourceInstanceId: carrier.instanceId,
      controllerId: 0,
      triggerDepth: 0,
    };
    const granted = applyAuraNonStatEffect(base, grantEffect, context, 0);
    const grantedCarrier = granted.players[0]!.zones.frontline[0];
    expect(grantedCarrier?.registeredTriggers.some((t) => t.react === true)).toBe(true);

    const pool = getAllRegisteredTriggers(granted);
    const r1 = dispatchTriggers(granted, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.hand).toHaveLength(1);
    expect(r1.newState.players[0]!.zones.frontline[0]?.exhausted).toBe(true);

    const r2 = dispatchTriggers(r1.newState, [statModEvent(ally.instanceId)], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(1);
  });

  it("resets on the owner's Upkeep (refreshCards)", () => {
    const reactor = mockCard({ owner: 0, name: 'Reactor', abilities: [reactDrawOnStatMod] });
    const ally = mockCard({ owner: 0, name: 'Ally' });
    const base = buildState(reactor, ally, { reactAbilities: true });
    const registered = registerCardTriggers(base, reactor.instanceId);
    const pool = getAllRegisteredTriggers(registered);

    const r1 = dispatchTriggers(registered, [statModEvent(ally.instanceId)], 0, pool);
    expect(r1.newState.players[0]!.zones.frontline[0]?.exhausted).toBe(true);

    // refreshCards only refreshes the ACTIVE player (activePlayerIndex: 0 here, same
    // seat as the reactor's owner), matching "the owner's Upkeep".
    const refreshed = refreshCards(r1.newState);
    expect(refreshed.players[0]!.zones.frontline[0]?.exhausted).toBe(false);

    const r2 = dispatchTriggers(refreshed, [statModEvent(ally.instanceId)], 0, pool);
    expect(r2.newState.players[0]!.hand).toHaveLength(2);
  });
});

// ── runSim: byte-identical no-op + deterministic divergence ──────────────────
const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('reactAbilities (runSim)', () => {
  it('absent/false ⇒ baseline runHash; true ⇒ deterministic divergence', async () => {
    const { runSim } = (await import(runnerPath)) as {
      runSim: (c: unknown) => { runHash: string };
    };
    const base = {
      rulesProfile: 'legacy-v1',
      matchups: 'all-pairs',
      gamesPerPairing: 3,
      seedBase: 4242,
      abilitiesOn: true,
    } as const;
    const off = runSim(base).runHash;

    expect(runSim({ ...base, reactAbilities: false }).runHash).toBe(off);

    const on = runSim({ ...base, reactAbilities: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, reactAbilities: true }).runHash).toBe(on);
  }, 30000);
});

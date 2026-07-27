/**
 * BUG FIX regression: registerCardTriggers had NO production call site — a
 * deployed card's PRINTED event triggers (on_destroy/Last Breath,
 * on_ally_destroyed, etc. — everything except on_cast/on_deploy) were never
 * registered, so the dispatch runtime could never see or fire them.
 *
 * These tests exercise the PRODUCTION path only — deploy via executePlayerAction
 * and destroy via a real declare_attack — and never call registerCardTriggers
 * directly (that would mask the bug, as the pre-fix suite did).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { registerHeroTriggers } from '../../src/events/trigger-registry.js';
import {
  mockCard,
  mockHero,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import type { GameConfig } from '../../src/types/game-state.js';

const FREE = { mana: 0, energy: 0, flexible: 0 };

/** A tiny deck so `draw_cards` (Last Breath / on_ally_destroyed effects) has
 * something to draw. */
function deck(n: number): ReturnType<typeof mockCard>[] {
  return Array.from({ length: n }, () => mockCard({ name: 'Deck', owner: 1 }));
}

const lastBreath: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_destroy' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
};

const onAllyDestroyed: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_ally_destroyed' },
  effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
};

describe('registerPrintedTriggers: on_destroy (Last Breath)', () => {
  beforeEach(() => resetInstanceCounter());

  function deployLastBreathCard(config?: GameConfig) {
    const card = mockCard({
      name: 'Last Breath Body',
      cardType: 'C',
      currentHp: 2,
      cost: FREE,
      abilities: [lastBreath],
    });
    const state = mockGameState({
      phase: 'strategy',
      activePlayerIndex: 1,
      players: [mockPlayerState(0), mockPlayerState(1, { hand: [card], mainDeck: deck(3) })],
      config,
    });
    const deployed = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: card.instanceId,
      zone: 'frontline',
      slotIndex: 0,
    });
    return { card, state: deployed.state };
  }

  function killViaAttack(
    state: ReturnType<typeof deployLastBreathCard>['state'],
    targetId: string,
  ) {
    const attacker = mockCard({ instanceId: 'ATK', cardType: 'C', owner: 0, currentAtk: 5 });
    const withAttacker = {
      ...state,
      activePlayerIndex: 0 as const,
      phase: 'action' as const,
      players: [
        { ...state.players[0], zones: zonesWithCards({ frontline: [attacker, null, null] }) },
        state.players[1],
      ] as const,
      turnState: { ...state.turnState, firstPlayerFirstTurn: false },
    };
    return executePlayerAction(withAttacker, {
      type: 'declare_attack',
      attackerInstanceId: 'ATK',
      targetId,
    });
  }

  it('OFF (default/absent): deploy never registers the printed trigger, and it never fires on destroy', () => {
    const { card, state: afterDeploy } = deployLastBreathCard(undefined);
    const deployedCard = afterDeploy.players[1]!.zones.frontline[0]!;
    expect(deployedCard.registeredTriggers).toHaveLength(0); // documents the bug

    const afterAttack = killViaAttack(afterDeploy, card.instanceId);
    expect(afterAttack.state.players[1]!.zones.frontline[0]).toBeNull(); // it died
    expect(afterAttack.state.players[1]!.hand).toHaveLength(0); // Last Breath never fired
  });

  it('ON: deploy registers the printed trigger, which fires on a real combat kill', () => {
    const { card, state: afterDeploy } = deployLastBreathCard({
      terminationMode: 'turn_cap',
      registerPrintedTriggers: true,
    });
    const deployedCard = afterDeploy.players[1]!.zones.frontline[0]!;
    // Registered at deploy time, via the production path — registerCardTriggers
    // was never called directly in this test.
    expect(deployedCard.registeredTriggers).toHaveLength(1);
    expect(deployedCard.registeredTriggers[0]!.trigger.type).toBe('on_destroy');

    const afterAttack = killViaAttack(afterDeploy, card.instanceId);
    expect(afterAttack.state.players[1]!.zones.frontline[0]).toBeNull(); // it died
    expect(afterAttack.state.players[1]!.hand).toHaveLength(1); // Last Breath fired
  });
});

describe('registerPrintedTriggers: on_ally_destroyed', () => {
  beforeEach(() => resetInstanceCounter());

  function deployPair(config?: GameConfig) {
    const victim = mockCard({ name: 'Victim', cardType: 'C', currentHp: 2, cost: FREE });
    const watcher = mockCard({
      name: 'Watcher',
      cardType: 'C',
      cost: FREE,
      abilities: [onAllyDestroyed],
    });
    let state = mockGameState({
      phase: 'strategy',
      activePlayerIndex: 1,
      players: [
        mockPlayerState(0),
        mockPlayerState(1, { hand: [victim, watcher], mainDeck: deck(3) }),
      ],
      config,
    });
    state = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: victim.instanceId,
      zone: 'frontline',
      slotIndex: 0,
    }).state;
    state = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: watcher.instanceId,
      zone: 'frontline',
      slotIndex: 1,
    }).state;
    return { victim, watcher, state };
  }

  it('ON: the watcher registers at deploy and draws when its ally is destroyed in real combat', () => {
    const { victim, watcher, state } = deployPair({ registerPrintedTriggers: true });
    const watcherOnBoard = state.players[1]!.zones.frontline[1]!;
    expect(watcherOnBoard.registeredTriggers).toHaveLength(1);
    expect(watcherOnBoard.instanceId).toBe(watcher.instanceId);

    const attacker = mockCard({ instanceId: 'ATK', cardType: 'C', owner: 0, currentAtk: 5 });
    const withAttacker = {
      ...state,
      activePlayerIndex: 0 as const,
      phase: 'action' as const,
      players: [
        { ...state.players[0], zones: zonesWithCards({ frontline: [attacker, null, null] }) },
        state.players[1],
      ] as const,
      turnState: { ...state.turnState, firstPlayerFirstTurn: false },
    };
    const afterAttack = executePlayerAction(withAttacker, {
      type: 'declare_attack',
      attackerInstanceId: 'ATK',
      targetId: victim.instanceId,
    });
    expect(afterAttack.state.players[1]!.zones.frontline[0]).toBeNull(); // victim died
    expect(afterAttack.state.players[1]!.hand).toHaveLength(1); // watcher drew
  });
});

describe('registerPrintedTriggers: base Hero abilities (registerHeroTriggers, used by hydration)', () => {
  const heroUltimate: AbilityDSL = {
    type: 'triggered',
    trigger: { type: 'on_turn_start' },
    effects: [{ type: 'draw_cards', count: { type: 'fixed', value: 1 }, player: 'allied' }],
  };

  it('registers a Hero printed trigger onto registeredTriggers, keyed to the given seat', () => {
    const hero = mockHero({ abilities: [heroUltimate] });
    const registered = registerHeroTriggers(hero, 1);
    expect(registered.registeredTriggers).toHaveLength(1);
    expect(registered.registeredTriggers[0]!.ownerPlayerId).toBe(1);
    expect(registered.registeredTriggers[0]!.trigger.type).toBe('on_turn_start');
  });

  it('is idempotent — re-running does not double-register the same ability', () => {
    const hero = mockHero({ abilities: [heroUltimate] });
    const once = registerHeroTriggers(hero, 0);
    const twice = registerHeroTriggers(once, 0);
    expect(twice.registeredTriggers).toHaveLength(1);
  });
});

// ── runSim: byte-identical no-op + deterministic divergence ──────────────────
const here = dirname(fileURLToPath(import.meta.url));
const runnerPath = resolve(here, '../../sim-runner.mjs');
const distPath = join(here, '..', '..', 'dist', 'index.js');
const cardsPath = new URL('../../sim-data/aetherion-cards.json', import.meta.url);
const simReady = existsSync(runnerPath) && existsSync(distPath) && existsSync(cardsPath);
const ds = simReady ? describe : describe.skip;

ds('registerPrintedTriggers (runSim)', () => {
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

    expect(runSim({ ...base, registerPrintedTriggers: false }).runHash).toBe(off);

    const on = runSim({ ...base, registerPrintedTriggers: true }).runHash;
    expect(on).not.toBe(off);
    expect(runSim({ ...base, registerPrintedTriggers: true }).runHash).toBe(on);
  }, 30000);
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import {
  tickStatusEffects,
  isStunned,
  isSlowed,
  consumeStun,
} from '../../src/runtime/status-tick.js';
import { tickUpkeepStatuses } from '../../src/state-machine/actions.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import type {
  ActiveStatus,
  CardInstance,
  GameState,
  ResourceCard,
} from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function withStatuses(statuses: ActiveStatus[], overrides?: Partial<CardInstance>): CardInstance {
  return mockCard({ statusEffects: statuses, ...overrides });
}

function stateWith(card: CardInstance, playerIndex: 0 | 1 = 0) {
  const players =
    playerIndex === 0
      ? ([
          mockPlayerState(0, { zones: zonesWithCards({ frontline: [card] }) }),
          mockPlayerState(1),
        ] as const)
      : ([
          mockPlayerState(0),
          mockPlayerState(1, { zones: zonesWithCards({ frontline: [card] }) }),
        ] as const);
  return mockGameState({ players: [players[0], players[1]], activePlayerIndex: playerIndex });
}

function findCard(
  state: ReturnType<typeof stateWith>,
  id: string,
  playerIndex: 0 | 1 = 0,
): CardInstance | null {
  const z = state.players[playerIndex].zones;
  for (const c of [...z.reserve, ...z.frontline, ...z.highGround]) {
    if (c !== null && c.instanceId === id) return c;
  }
  return null;
}

describe('status-tick — Regeneration', () => {
  beforeEach(resetInstanceCounter);

  it('heals X (capped at baseHp) and decrements the value each upkeep', () => {
    const card = withStatuses([{ statusType: 'regeneration', value: 2, remainingTurns: null }], {
      currentHp: 2,
      baseHp: 5,
    });
    const r1 = tickStatusEffects(stateWith(card), 0);
    const after1 = findCard(r1.state, card.instanceId)!;
    expect(after1.currentHp).toBe(4);
    expect(after1.statusEffects).toEqual([
      { statusType: 'regeneration', value: 1, remainingTurns: null },
    ]);
    expect(r1.events).toContainEqual({
      type: 'CHARACTER_HEALED',
      cardInstanceId: card.instanceId,
      amount: 2,
    });
  });

  it('expires when its value reaches 0', () => {
    const card = withStatuses([{ statusType: 'regeneration', value: 1, remainingTurns: null }], {
      currentHp: 1,
      baseHp: 5,
    });
    const r = tickStatusEffects(stateWith(card), 0);
    const after = findCard(r.state, card.instanceId)!;
    expect(after.currentHp).toBe(2);
    expect(after.statusEffects).toEqual([]);
  });

  it('never overheals past baseHp', () => {
    const card = withStatuses([{ statusType: 'regeneration', value: 3, remainingTurns: null }], {
      currentHp: 4,
      baseHp: 5,
    });
    const r = tickStatusEffects(stateWith(card), 0);
    expect(findCard(r.state, card.instanceId)!.currentHp).toBe(5);
  });
});

describe('status-tick — Persistent', () => {
  beforeEach(resetInstanceCounter);

  it('deals X damage, decrements, and destroys at 0 HP', () => {
    const card = withStatuses([{ statusType: 'persistent', value: 3, remainingTurns: null }], {
      currentHp: 2,
      baseHp: 5,
    });
    const r = tickStatusEffects(stateWith(card), 0);
    expect(findCard(r.state, card.instanceId)).toBeNull();
    expect(r.events).toContainEqual(
      expect.objectContaining({
        type: 'CARD_DESTROYED',
        cardInstanceId: card.instanceId,
        cardDefId: card.cardDefId,
        cause: 'effect',
        playerId: 0,
      }),
    );
  });

  it('decrements its value when the character survives', () => {
    const card = withStatuses([{ statusType: 'persistent', value: 1, remainingTurns: null }], {
      currentHp: 5,
      baseHp: 5,
    });
    const r = tickStatusEffects(stateWith(card), 0);
    const after = findCard(r.state, card.instanceId)!;
    expect(after.currentHp).toBe(4);
    expect(after.statusEffects).toEqual([]);
  });
});

describe('status-tick — Stunned (refresh interaction)', () => {
  beforeEach(resetInstanceCounter);

  it('isStunned detects a stun status', () => {
    const card = withStatuses([{ statusType: 'stunned', value: 1, remainingTurns: 1 }], {
      exhausted: true,
    });
    expect(isStunned(card)).toBe(true);
  });

  it('consumeStun decrements the duration and removes it at 0', () => {
    const oneTurn = withStatuses([{ statusType: 'stunned', value: 1, remainingTurns: 1 }]);
    expect(consumeStun(oneTurn).statusEffects).toEqual([]);
    const twoTurns = withStatuses([{ statusType: 'stunned', value: 1, remainingTurns: 2 }]);
    expect(consumeStun(twoTurns).statusEffects).toEqual([
      { statusType: 'stunned', value: 1, remainingTurns: 1 },
    ]);
  });
});

describe('status-tick — Slowed', () => {
  beforeEach(resetInstanceCounter);

  it('isSlowed detects the status', () => {
    const card = withStatuses([{ statusType: 'slowed', value: 1, remainingTurns: 2 }]);
    expect(isSlowed(card)).toBe(true);
  });

  it('counts down remainingTurns and expires at 0', () => {
    const card = withStatuses([{ statusType: 'slowed', value: 1, remainingTurns: 1 }]);
    const r = tickStatusEffects(stateWith(card), 0);
    expect(findCard(r.state, card.instanceId)!.statusEffects).toEqual([]);
  });
});

describe('status-tick — aura-sourced statuses are never ticked', () => {
  beforeEach(resetInstanceCounter);

  it('leaves a continuous (sourceAuraId) status untouched', () => {
    const card = withStatuses(
      [
        { statusType: 'hexproof', value: 1, remainingTurns: null, sourceAuraId: 'aura_x' },
        { statusType: 'persistent', value: 2, remainingTurns: null, sourceAuraId: 'aura_x' },
      ],
      { currentHp: 5, baseHp: 5 },
    );
    const r = tickStatusEffects(stateWith(card), 0);
    const after = findCard(r.state, card.instanceId)!;
    expect(after.currentHp).toBe(5); // aura persistent did not damage
    expect(after.statusEffects).toHaveLength(2);
    expect(r.events).toEqual([]);
  });
});

describe('tickUpkeepStatuses — only ticks the active player', () => {
  beforeEach(resetInstanceCounter);

  it("does not tick the opponent's statuses", () => {
    const enemy = withStatuses([{ statusType: 'persistent', value: 5, remainingTurns: null }], {
      currentHp: 2,
      baseHp: 5,
      owner: 1,
    });
    const state = stateWith(enemy, 1);
    // active player is 0; ticking should leave player-1's character alone
    const activeZero = mockGameState({ ...state, activePlayerIndex: 0 });
    const r = tickUpkeepStatuses(activeZero);
    expect(r.events).toEqual([]);
    expect(findCard(r.state, enemy.instanceId, 1)).not.toBeNull();
  });
});

// ── End-to-end through the actual upkeep state machine ──────────────────────────

function makeUpkeepState(card: CardInstance): GameState {
  const deck = Array.from({ length: 10 }, (_, i) => mockCard({ name: `D${String(i)}`, owner: 0 }));
  const resDeck: ResourceCard[] = Array.from({ length: 5 }, (_, i) => ({
    instanceId: `rd_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
  return mockGameState({
    phase: 'upkeep',
    pendingChoice: null,
    activePlayerIndex: 0,
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
    players: [
      mockPlayerState(0, {
        zones: zonesWithCards({ frontline: [card] }),
        mainDeck: deck,
        resourceDeck: resDeck,
      }),
      mockPlayerState(1, { mainDeck: [...deck], resourceDeck: [...resDeck] }),
    ],
  });
}

describe('Upkeep lifecycle (state machine)', () => {
  beforeEach(resetInstanceCounter);

  it("Regeneration heals during the controller's Upkeep", () => {
    const card = mockCard({
      owner: 0,
      currentHp: 2,
      baseHp: 5,
      exhausted: true,
      statusEffects: [{ statusType: 'regeneration', value: 2, remainingTurns: null }],
    });
    const actor = createActor(gameMachine, { input: { gameState: makeUpkeepState(card) } });
    actor.start();
    const live = actor.getSnapshot().context.gameState.players[0].zones.frontline[0]!;
    expect(live.currentHp).toBe(4);
    expect(live.statusEffects).toEqual([
      { statusType: 'regeneration', value: 1, remainingTurns: null },
    ]);
  });

  it('a Stunned character does NOT refresh, and the stun is consumed', () => {
    const card = mockCard({
      owner: 0,
      exhausted: true,
      summoningSick: false,
      statusEffects: [{ statusType: 'stunned', value: 1, remainingTurns: 1 }],
    });
    const actor = createActor(gameMachine, { input: { gameState: makeUpkeepState(card) } });
    actor.start();
    const live = actor.getSnapshot().context.gameState.players[0].zones.frontline[0]!;
    expect(live.exhausted).toBe(true); // did not untap
    expect(live.statusEffects).toEqual([]); // stun consumed (1 -> 0)
  });

  it('a non-Stunned character refreshes normally', () => {
    const card = mockCard({ owner: 0, exhausted: true, summoningSick: true });
    const actor = createActor(gameMachine, { input: { gameState: makeUpkeepState(card) } });
    actor.start();
    const live = actor.getSnapshot().context.gameState.players[0].zones.frontline[0]!;
    expect(live.exhausted).toBe(false);
    expect(live.summoningSick).toBe(false);
  });
});

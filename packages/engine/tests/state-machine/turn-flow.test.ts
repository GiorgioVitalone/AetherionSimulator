import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { registerInitialTriggers } from '../../src/events/index.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { GameState, ResourceCard } from '../../src/types/game-state.js';

function makeBank(resources: readonly { type: 'mana' | 'energy' }[]): ResourceCard[] {
  return resources.map((r, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: r.type,
    exhausted: false,
  }));
}

function makePlayableState(overrides?: Partial<GameState>): GameState {
  const deck = Array.from({ length: 20 }, (_, i) =>
    mockCard({ name: `Deck${String(i)}`, owner: 0 }),
  );
  const deck2 = Array.from({ length: 20 }, (_, i) =>
    mockCard({ name: `Deck2_${String(i)}`, owner: 1 }),
  );
  const resDeck = Array.from({ length: 10 }, (_, i) => ({
    instanceId: `rd_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));

  return mockGameState({
    phase: 'upkeep',
    pendingChoice: null,
    players: [
      mockPlayerState(0, {
        hand: [mockCard({ owner: 0 })],
        mainDeck: deck,
        resourceDeck: resDeck,
        resourceBank: makeBank([{ type: 'mana' }, { type: 'mana' }]),
      }),
      mockPlayerState(1, {
        hand: [mockCard({ owner: 1 })],
        mainDeck: deck2,
        resourceDeck: [...resDeck],
        resourceBank: makeBank([{ type: 'energy' }]),
      }),
    ],
    ...overrides,
  });
}

describe('Turn Flow State Machine', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('upkeep → strategy → action → end', () => {
    it('should auto-transition through upkeep to strategy', () => {
      const state = makePlayableState();
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      const snapshot = actor.getSnapshot();
      // After upkeep auto-transitions, should be in strategy
      // The machine goes upkeep → drawMain → strategy
      expect(snapshot.value).toEqual({ playing: 'strategy' });
    });

    it('should transition from strategy to action on END_PHASE', () => {
      const state = makePlayableState();
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      actor.send({ type: 'END_PHASE' });
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toEqual({ playing: 'action' });
    });

    it('should transition from action to end phase on END_PHASE', () => {
      const state = makePlayableState();
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      actor.send({ type: 'END_PHASE' }); // strategy → action
      actor.send({ type: 'END_PHASE' }); // action → endPhase → passTurn → upkeep → strategy

      const snapshot = actor.getSnapshot();
      // Should have cycled through end phase back to strategy (next turn)
      expect(snapshot.value).toEqual({ playing: 'strategy' });
    });
  });

  describe('first player first turn', () => {
    it('should skip main deck draw on first turn', () => {
      const state = makePlayableState({
        turnState: { discardedForEnergy: false, firstPlayerFirstTurn: true },
      });
      const initialHandSize = state.players[0]!.hand.length;
      const initialDeckSize = state.players[0]!.mainDeck.length;

      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      const snapshot = actor.getSnapshot();
      const ctx = snapshot.context;
      // Hand size should not have increased (no main draw)
      expect(ctx.gameState.players[0]!.hand.length).toBe(initialHandSize);
      expect(ctx.gameState.players[0]!.mainDeck.length).toBe(initialDeckSize);
    });
  });

  describe('strategy phase actions', () => {
    it('should deploy a character from hand', () => {
      const handCard = mockCard({
        name: 'Warrior',
        cardType: 'C',
        cost: { mana: 1, energy: 0, flexible: 0 },
        owner: 0,
      });
      const state = makePlayableState();
      // Replace hand with our specific card
      const modState = {
        ...state,
        players: [
          { ...state.players[0]!, hand: [handCard] },
          state.players[1]!,
        ] as const,
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      actor.send({
        type: 'PLAYER_ACTION',
        action: {
          type: 'deploy',
          cardInstanceId: handCard.instanceId,
          zone: 'frontline',
          slotIndex: 0,
        },
      });

      const ctx = actor.getSnapshot().context;
      // Card should be on the battlefield now
      expect(ctx.gameState.players[0]!.zones.frontline[0]).not.toBeNull();
      // Hand should not contain the deployed card (may contain cards drawn during upkeep)
      expect(ctx.gameState.players[0]!.hand.find(
        c => c.instanceId === handCard.instanceId,
      )).toBeUndefined();
    });

    it('should resolve on_deploy triggered abilities immediately', () => {
      const handCard = mockCard({
        name: 'Invoker',
        cardType: 'C',
        cost: { mana: 1, energy: 0, flexible: 0 },
        owner: 0,
        abilities: [{
          type: 'triggered',
          trigger: { type: 'on_deploy' },
          effects: [{
            type: 'gain_resource',
            resourceType: 'mana',
            amount: 1,
          }],
        }],
      });

      const state = makePlayableState();
      const modState = {
        ...state,
        players: [
          { ...state.players[0]!, hand: [handCard] },
          state.players[1]!,
        ] as const,
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      const bankBefore = actor.getSnapshot().context.gameState.players[0]!.resourceBank.length;

      actor.send({
        type: 'PLAYER_ACTION',
        action: {
          type: 'deploy',
          cardInstanceId: handCard.instanceId,
          zone: 'frontline',
          slotIndex: 0,
        },
      });

      const ctx = actor.getSnapshot().context;
      expect(ctx.gameState.players[0]!.resourceBank.length).toBe(bankBefore + 1);
      const gainedEvents = ctx.gameState.log.filter(
        e => e.type === 'RESOURCE_GAINED' && e.playerId === 0,
      );
      expect(gainedEvents.length).toBeGreaterThan(1);
    });

    it('should resume targeted deploy triggers after target selection', () => {
      const enemy = mockCard({
        name: 'Target',
        owner: 1,
        currentHp: 3,
        baseHp: 3,
      });
      const handCard = mockCard({
        name: 'Sharpshooter',
        cardType: 'C',
        cost: { mana: 1, energy: 0, flexible: 0 },
        owner: 0,
        abilities: [{
          type: 'triggered',
          trigger: { type: 'on_deploy' },
          effects: [{
            type: 'deal_damage',
            amount: { type: 'fixed', value: 2 },
            target: {
              type: 'target_character',
              side: 'enemy',
            },
          }],
        }],
      });

      const state = makePlayableState();
      const modState = {
        ...state,
        players: [
          { ...state.players[0]!, hand: [handCard] },
          {
            ...state.players[1]!,
            zones: deployToZone(emptyZones(), enemy, 'frontline', 0),
          },
        ] as const,
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      actor.send({
        type: 'PLAYER_ACTION',
        action: {
          type: 'deploy',
          cardInstanceId: handCard.instanceId,
          zone: 'frontline',
          slotIndex: 0,
        },
      });

      expect(actor.getSnapshot().context.gameState.pendingChoice?.type).toBe('select_targets');

      actor.send({
        type: 'PLAYER_RESPONSE',
        response: {
          selectedOptionIds: [enemy.instanceId],
        },
      });

      const updatedEnemy = actor.getSnapshot().context.gameState.players[1]!.zones.frontline[0]!;
      expect(updatedEnemy.currentHp).toBe(1);
    });

    it('should allow discard for energy once per turn', () => {
      const handCard = mockCard({ name: 'Fodder', owner: 0 });
      const state = makePlayableState();
      const modState = {
        ...state,
        players: [
          { ...state.players[0]!, hand: [handCard, mockCard({ owner: 0 })] },
          state.players[1]!,
        ] as const,
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      actor.send({
        type: 'PLAYER_ACTION',
        action: {
          type: 'discard_for_energy',
          cardInstanceId: handCard.instanceId,
        },
      });

      const ctx = actor.getSnapshot().context;
      expect(ctx.gameState.turnState.discardedForEnergy).toBe(true);
      expect(ctx.gameState.players[0]!.temporaryResources.length).toBeGreaterThan(0);
    });
  });

  describe('affordability guards', () => {
    it('should ignore deploy when player cannot afford cost', () => {
      const expensiveCard = mockCard({
        name: 'Expensive',
        cardType: 'C',
        cost: { mana: 10, energy: 0, flexible: 0 },
        owner: 0,
      });
      const state = makePlayableState();
      const modState = {
        ...state,
        players: [
          { ...state.players[0]!, hand: [expensiveCard] },
          state.players[1]!,
        ] as const,
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      actor.send({
        type: 'PLAYER_ACTION',
        action: {
          type: 'deploy',
          cardInstanceId: expensiveCard.instanceId,
          zone: 'frontline',
          slotIndex: 0,
        },
      });

      const ctx = actor.getSnapshot().context;
      // Card should still be in hand (deploy rejected)
      expect(ctx.gameState.players[0]!.hand.some(
        c => c.instanceId === expensiveCard.instanceId,
      )).toBe(true);
      // Frontline should still be empty
      expect(ctx.gameState.players[0]!.zones.frontline[0]).toBeNull();
    });
  });

  describe('combat', () => {
    it('should resolve attack during action phase', () => {
      const attacker = mockCard({
        name: 'Attacker',
        currentAtk: 5,
        currentHp: 3,
        owner: 0,
        exhausted: false,
      });
      const defender = mockCard({
        name: 'Defender',
        currentAtk: 1,
        currentHp: 2,
        owner: 1,
        exhausted: false,
      });

      let p0Zones = deployToZone(emptyZones(), attacker, 'frontline');
      let p1Zones = deployToZone(emptyZones(), defender, 'frontline');

      const state = makePlayableState();
      const modState: GameState = {
        ...state,
        players: [
          { ...state.players[0]!, zones: p0Zones },
          { ...state.players[1]!, zones: p1Zones },
        ] as const,
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      // Move to action phase
      actor.send({ type: 'END_PHASE' });

      actor.send({
        type: 'PLAYER_ACTION',
        action: {
          type: 'declare_attack',
          attackerInstanceId: attacker.instanceId,
          targetId: defender.instanceId,
        },
      });

      const ctx = actor.getSnapshot().context;
      // Defender should be destroyed (5 ATK > 2 HP)
      expect(ctx.gameState.players[1]!.zones.frontline[0]).toBeNull();
      // Attacker should be damaged and exhausted
      const updatedAttacker = ctx.gameState.players[0]!.zones.frontline[0]!;
      expect(updatedAttacker.exhausted).toBe(true);
    });
  });

  describe('turn number', () => {
    it('should increment every turn regardless of starting player', () => {
      const state = makePlayableState({ activePlayerIndex: 1 });
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      const initialTurn = actor.getSnapshot().context.gameState.turnNumber;

      // End strategy → action
      actor.send({ type: 'END_PHASE' });
      // End action → endPhase → passTurn → next upkeep
      actor.send({ type: 'END_PHASE' });

      const afterOneTurn = actor.getSnapshot().context.gameState.turnNumber;
      expect(afterOneTurn).toBe(initialTurn + 1);

      // Do another full turn
      actor.send({ type: 'END_PHASE' });
      actor.send({ type: 'END_PHASE' });

      const afterTwoTurns = actor.getSnapshot().context.gameState.turnNumber;
      expect(afterTwoTurns).toBe(initialTurn + 2);
    });
  });

  describe('triggered turn events', () => {
    it('should resolve registered hero turn-start triggers', () => {
      const templateState = makePlayableState();
      const baseState = makePlayableState({
        phase: 'upkeep',
        players: [
          templateState.players[0]!,
          mockPlayerState(1, {
            hand: [mockCard({ owner: 1 })],
            mainDeck: Array.from({ length: 20 }, (_, i) =>
              mockCard({ name: `P1Deck_${String(i)}`, owner: 1 }),
            ),
            resourceDeck: Array.from({ length: 10 }, (_, i) => ({
              instanceId: `p1_rd_${String(i)}`,
              resourceType: 'mana' as const,
              exhausted: false,
            })),
            hero: {
              ...mockPlayerState(1).hero,
              abilities: [{
                type: 'triggered',
                trigger: { type: 'on_turn_start' },
                effects: [{
                  type: 'gain_resource',
                  resourceType: 'mana',
                  amount: 1,
                }],
              }],
            },
          }),
        ] as const,
      });
      const state = registerInitialTriggers(baseState);

      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      actor.send({ type: 'END_PHASE' });
      actor.send({ type: 'END_PHASE' });

      const playerOne = actor.getSnapshot().context.gameState.players[1]!;
      expect(playerOne.resourceBank.length).toBe(2);
    });
  });

  describe('draw events in log', () => {
    it('should log resource draw events during upkeep', () => {
      const state = makePlayableState();
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      const log = actor.getSnapshot().context.gameState.log;
      const resourceEvents = log.filter(e => e.type === 'RESOURCE_GAINED');
      expect(resourceEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should log main deck draw events during upkeep', () => {
      const state = makePlayableState({
        turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
      });
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      const log = actor.getSnapshot().context.gameState.log;
      const drawEvents = log.filter(e => e.type === 'CARD_DRAWN');
      expect(drawEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('concession', () => {
    it('should end game immediately on concede', () => {
      const state = makePlayableState();
      const actor = createActor(gameMachine, {
        input: { gameState: state },
      });
      actor.start();

      actor.send({ type: 'CONCEDE', playerId: 0 });

      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toBe('gameOver');
      expect(snapshot.context.gameState.winner).toBe(1);
    });
  });

  describe('deck out', () => {
    it('should end game when main deck is empty on draw', () => {
      const state = makePlayableState();
      // Empty out the main deck
      const modState: GameState = {
        ...state,
        players: [
          { ...state.players[0]!, mainDeck: [] },
          state.players[1]!,
        ] as const,
        turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
      };

      const actor = createActor(gameMachine, {
        input: { gameState: modState },
      });
      actor.start();

      const snapshot = actor.getSnapshot();
      // Should be game_over since deck is empty during upkeep draw
      expect(snapshot.value).toBe('gameOver');
      expect(snapshot.context.gameState.winner).toBe(1); // Opponent wins
    });
  });
});

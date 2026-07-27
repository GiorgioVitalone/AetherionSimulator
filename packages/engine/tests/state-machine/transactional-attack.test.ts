import { describe, expect, it } from 'vitest';
import {
  executePlayerAction,
  executePriorityPass,
  executeReactiveResponse,
} from '../../src/state-machine/actions.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

function stateWithResponder(): ReturnType<typeof mockGameState> {
  const attacker = mockCard({
    instanceId: 'attacker',
    owner: 0,
    currentAtk: 3,
    baseAtk: 3,
    summoningSick: false,
    exhausted: false,
  });
  const flash = mockCard({
    instanceId: 'flash',
    owner: 1,
    cardType: 'S',
    cost: { mana: 0, energy: 0, flexible: 0 },
    abilities: [
      {
        type: 'triggered',
        trigger: { type: 'on_flash' },
        effects: [],
      },
    ],
  });
  return mockGameState({
    phase: 'action',
    turnState: { discardedForEnergy: false, firstPlayerFirstTurn: false },
    config: {
      terminationMode: 'resource_deck_empty_transform',
      responseWindowsOnAllActions: true,
      transactionalDeclarations: true,
    },
    players: [
      mockPlayerState(0, {
        zones: zonesWithCards({ frontline: [attacker, null, null] }),
      }),
      mockPlayerState(1, { hand: [flash] }),
    ],
  });
}

describe('transactional attack declaration', () => {
  it('commits exhaustion before priority and resolves without double-declaration', () => {
    const declared = executePlayerAction(stateWithResponder(), {
      type: 'declare_attack',
      attackerInstanceId: 'attacker',
      targetId: 'hero',
    });
    const attacker = declared.state.players[0].zones.frontline[0];
    expect(attacker?.exhausted).toBe(true);
    expect(attacker?.attackedThisTurn).toBe(true);
    expect(declared.state.pendingPriority).not.toBeNull();
    expect(declared.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_DECLARED',
          stackItemType: 'attack',
        }),
      ]),
    );

    const firstPass = executePriorityPass(declared.state);
    const resolved = executePriorityPass(firstPass.state);
    expect(resolved.state.players[1].hero.currentLp).toBe(22);
    expect(resolved.events.map((event) => event.type)).toContain('CHARACTER_ATTACKED');
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_RESOLVED',
          stackItemType: 'attack',
        }),
      ]),
    );
  });
});

function counterCard(): ReturnType<typeof mockCard> {
  return mockCard({
    instanceId: 'counter',
    owner: 1,
    cardType: 'S',
    cost: { mana: 0, energy: 0, flexible: 0 },
    abilities: [
      {
        type: 'triggered',
        trigger: { type: 'on_counter' },
        effects: [{ type: 'counter_spell', target: { type: 'target_spell' } }],
      },
    ],
  });
}

const TRANSACTIONAL_CONFIG = {
  terminationMode: 'resource_deck_empty_transform' as const,
  responseWindowsOnAllActions: true,
  transactionalDeclarations: true,
};

describe('transactional move declaration', () => {
  it('commits the move use before priority and does not restore it when countered', () => {
    const mover = mockCard({ instanceId: 'mover', owner: 0 });
    const state = mockGameState({
      phase: 'action',
      config: TRANSACTIONAL_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ reserve: [mover, null] }),
        }),
        mockPlayerState(1, { hand: [counterCard()] }),
      ],
    });
    const declared = executePlayerAction(state, {
      type: 'move',
      cardInstanceId: 'mover',
      toZone: 'frontline',
    });
    expect(declared.state.players[0].zones.reserve[0]).toMatchObject({
      instanceId: 'mover',
      exhausted: true,
      movedThisTurn: true,
    });

    const countered = executeReactiveResponse(declared.state, {
      type: 'cast_spell',
      cardInstanceId: 'counter',
    });
    const firstPass = executePriorityPass(countered.state);
    const resolved = executePriorityPass(firstPass.state);
    expect(resolved.state.players[0].zones.reserve[0]).toMatchObject({
      instanceId: 'mover',
      exhausted: true,
      movedThisTurn: true,
    });
    expect(resolved.state.players[0].zones.frontline.every((card) => card === null)).toBe(true);
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_COUNTERED',
          stackItemType: 'move',
        }),
      ]),
    );
    expect(
      resolved.events.some(
        (event) =>
          event.type === 'STACK_ITEM_RESOLVED' &&
          event.stackItemType === 'move',
      ),
    ).toBe(false);
  });
});

describe('transactional equipment declaration', () => {
  it('defers replacement and discards the declared equipment when countered', () => {
    const oldEquipment = mockCard({
      instanceId: 'old-equipment',
      owner: 0,
      cardType: 'E',
    });
    const holder = mockCard({
      instanceId: 'holder',
      owner: 0,
      equipment: { ...oldEquipment, holderInstanceId: 'holder' },
    });
    const newEquipment = mockCard({
      instanceId: 'new-equipment',
      owner: 0,
      cardType: 'E',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [
        {
          type: 'triggered',
          trigger: { type: 'on_deploy' },
          effects: [],
        },
      ],
    });
    const state = mockGameState({
      phase: 'strategy',
      config: TRANSACTIONAL_CONFIG,
      players: [
        mockPlayerState(0, {
          hand: [newEquipment],
          zones: zonesWithCards({ frontline: [holder, null, null] }),
        }),
        mockPlayerState(1, { hand: [counterCard()] }),
      ],
    });
    const declared = executePlayerAction(state, {
      type: 'attach_equipment',
      cardInstanceId: 'new-equipment',
      targetInstanceId: 'holder',
    });
    expect(declared.state.players[0].hand).toHaveLength(0);
    expect(declared.state.players[0].zones.frontline[0]?.equipment?.instanceId).toBe(
      'old-equipment',
    );

    const countered = executeReactiveResponse(declared.state, {
      type: 'cast_spell',
      cardInstanceId: 'counter',
    });
    const firstPass = executePriorityPass(countered.state);
    const resolved = executePriorityPass(firstPass.state);
    expect(resolved.state.players[0].zones.frontline[0]?.equipment?.instanceId).toBe(
      'old-equipment',
    );
    expect(
      resolved.state.players[0].discardPile.some(
        (card) =>
          card.instanceId === 'new-equipment' &&
          card.holderInstanceId === undefined,
      ),
    ).toBe(true);
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_COUNTERED',
          stackItemType: 'equip',
        }),
      ]),
    );
  });
});

describe('transactional equipment transfer', () => {
  function transferState(opponentHand: ReturnType<typeof mockCard>[]) {
    const equipment = mockCard({
      instanceId: 'transfer-equipment',
      owner: 0,
      cardType: 'E',
      cost: { mana: 0, energy: 0, flexible: 0 },
      holderInstanceId: 'from-holder',
    });
    const fromHolder = mockCard({
      instanceId: 'from-holder',
      owner: 0,
      equipment,
    });
    const toHolder = mockCard({
      instanceId: 'to-holder',
      owner: 0,
    });
    return mockGameState({
      phase: 'strategy',
      config: TRANSACTIONAL_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({
            frontline: [fromHolder, toHolder, null],
          }),
        }),
        mockPlayerState(1, { hand: opponentHand }),
      ],
    });
  }

  it('commits payment/use but leaves the physical relation unchanged during priority', () => {
    const declared = executePlayerAction(
      transferState([
        mockCard({
          instanceId: 'flash',
          owner: 1,
          cardType: 'S',
          cost: { mana: 0, energy: 0, flexible: 0 },
          abilities: [
            {
              type: 'triggered',
              trigger: { type: 'on_flash' },
              effects: [],
            },
          ],
        }),
      ]),
      {
        type: 'transfer_equipment',
        equipmentInstanceId: 'transfer-equipment',
        targetInstanceId: 'to-holder',
      },
    );

    expect(declared.state.pendingPriority?.window).toBe('equip');
    expect(declared.state.stack.at(-1)?.type).toBe('transfer');
    expect(
      declared.state.players[0].zones.frontline[0]?.equipment,
    ).toMatchObject({
      instanceId: 'transfer-equipment',
      holderInstanceId: 'from-holder',
      transferredThisTurn: true,
    });
    expect(declared.state.players[0].zones.frontline[1]?.equipment).toBeNull();
    expect(declared.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'EQUIPMENT_DECLARED',
          equipmentId: 'transfer-equipment',
          targetId: 'to-holder',
        }),
        expect.objectContaining({
          type: 'STACK_ITEM_DECLARED',
          stackItemType: 'transfer',
        }),
      ]),
    );
  });

  it('keeps the committed equipment on its old holder when countered', () => {
    const declared = executePlayerAction(transferState([counterCard()]), {
      type: 'transfer_equipment',
      equipmentInstanceId: 'transfer-equipment',
      targetInstanceId: 'to-holder',
    });
    const countered = executeReactiveResponse(declared.state, {
      type: 'cast_spell',
      cardInstanceId: 'counter',
    });
    const firstPass = executePriorityPass(countered.state);
    const resolved = executePriorityPass(firstPass.state);

    expect(
      resolved.state.players[0].zones.frontline[0]?.equipment,
    ).toMatchObject({
      instanceId: 'transfer-equipment',
      holderInstanceId: 'from-holder',
      transferredThisTurn: true,
    });
    expect(resolved.state.players[0].zones.frontline[1]?.equipment).toBeNull();
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_COUNTERED',
          stackItemType: 'transfer',
        }),
      ]),
    );
    expect(
      resolved.events.some(
        (event) =>
          event.type === 'EQUIPMENT_DISCARDED' ||
          event.type === 'EQUIPMENT_COUNTERED',
      ),
    ).toBe(false);
  });

  it('moves the relation only when the declaration resolves', () => {
    const declared = executePlayerAction(
      transferState([
        mockCard({
          instanceId: 'flash',
          owner: 1,
          cardType: 'S',
          cost: { mana: 0, energy: 0, flexible: 0 },
          abilities: [
            {
              type: 'triggered',
              trigger: { type: 'on_flash' },
              effects: [],
            },
          ],
        }),
      ]),
      {
        type: 'transfer_equipment',
        equipmentInstanceId: 'transfer-equipment',
        targetInstanceId: 'to-holder',
      },
    );
    const firstPass = executePriorityPass(declared.state);
    const resolved = executePriorityPass(firstPass.state);

    expect(resolved.state.players[0].zones.frontline[0]?.equipment).toBeNull();
    expect(
      resolved.state.players[0].zones.frontline[1]?.equipment,
    ).toMatchObject({
      instanceId: 'transfer-equipment',
      holderInstanceId: 'to-holder',
      transferredThisTurn: true,
    });
    expect(resolved.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'EQUIPMENT_DETACHED',
        'EQUIPMENT_TRANSFERRED',
        'EQUIPMENT_ATTACHED',
        'STACK_ITEM_RESOLVED',
      ]),
    );
  });

  it('fizzles without breaking the old relation when the target becomes illegal', () => {
    const declared = executePlayerAction(
      transferState([
        mockCard({
          instanceId: 'flash',
          owner: 1,
          cardType: 'S',
          cost: { mana: 0, energy: 0, flexible: 0 },
          abilities: [
            {
              type: 'triggered',
              trigger: { type: 'on_flash' },
              effects: [],
            },
          ],
        }),
      ]),
      {
        type: 'transfer_equipment',
        equipmentInstanceId: 'transfer-equipment',
        targetInstanceId: 'to-holder',
      },
    );
    const targetBecameOccupied = {
      ...declared.state,
      players: [
        {
          ...declared.state.players[0],
          zones: {
            ...declared.state.players[0].zones,
            frontline: declared.state.players[0].zones.frontline.map(
              (card, index) =>
                index === 1 && card !== null
                  ? {
                      ...card,
                      equipment: mockCard({
                        instanceId: 'intervening-equipment',
                        owner: 0,
                        cardType: 'E',
                        holderInstanceId: 'to-holder',
                      }),
                    }
                  : card,
            ),
          },
        },
        declared.state.players[1],
      ] as typeof declared.state.players,
    };
    const firstPass = executePriorityPass(targetBecameOccupied);
    const resolved = executePriorityPass(firstPass.state);

    expect(
      resolved.state.players[0].zones.frontline[0]?.equipment,
    ).toMatchObject({
      instanceId: 'transfer-equipment',
      holderInstanceId: 'from-holder',
      transferredThisTurn: true,
    });
    expect(resolved.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'STACK_ITEM_FIZZLED',
          stackItemType: 'transfer',
        }),
      ]),
    );
    expect(
      resolved.events.some(
        (event) =>
          event.type === 'STACK_ITEM_RESOLVED' &&
          event.stackItemType === 'transfer',
      ),
    ).toBe(false);
  });
});

describe('transactional spell lifecycle', () => {
  it('fires cast-time triggers before a later counter and records the terminal disposition', () => {
    const watcher = mockCard({
      instanceId: 'watcher',
      owner: 0,
      registeredTriggers: [
        {
          id: 'trigger:watcher:0',
          sourceInstanceId: 'watcher',
          ownerPlayerId: 0,
          trigger: { type: 'on_spell_cast', side: 'allied' },
          effects: [
            {
              type: 'draw_cards',
              count: { type: 'fixed', value: 1 },
              player: 'allied',
            },
          ],
          abilityIndex: 0,
        },
      ],
    });
    const spell = mockCard({
      instanceId: 'base-spell',
      owner: 0,
      cardType: 'S',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [],
    });
    const top = mockCard({ instanceId: 'drawn', owner: 0 });
    const state = mockGameState({
      phase: 'strategy',
      config: TRANSACTIONAL_CONFIG,
      players: [
        mockPlayerState(0, {
          hand: [spell],
          mainDeck: [top],
          zones: zonesWithCards({ reserve: [watcher, null] }),
        }),
        mockPlayerState(1, { hand: [counterCard()] }),
      ],
    });
    const declared = executePlayerAction(state, {
      type: 'cast_spell',
      cardInstanceId: 'base-spell',
    });
    expect(declared.state.players[0].hand.map((card) => card.instanceId)).toEqual([
      'drawn',
    ]);
    expect(declared.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'SPELL_DECLARED',
        'SPELL_CAST',
        'STACK_ITEM_DECLARED',
      ]),
    );

    const countered = executeReactiveResponse(declared.state, {
      type: 'cast_spell',
      cardInstanceId: 'counter',
    });
    const firstPass = executePriorityPass(countered.state);
    const resolved = executePriorityPass(firstPass.state);
    expect(resolved.events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        'STACK_ITEM_COUNTERED',
        'SPELL_COUNTERED',
        'STACK_ITEM_RESOLVED',
        'SPELL_RESOLVED',
      ]),
    );
    const baseId = 'spell_base-spell';
    expect(
      resolved.events.some(
        (event) =>
          event.type === 'SPELL_RESOLVED' && event.stackItemId === baseId,
      ),
    ).toBe(false);
  });
});

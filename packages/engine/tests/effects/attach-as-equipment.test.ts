/**
 * attach_as_equipment tests — the source character becomes equipment on a target ally.
 *
 * The source is removed from its zone (not discarded) and set as the target's
 * `equipment`. With retainAbilities=false the source's abilities/triggers are
 * dropped on attach; otherwise they are kept ("it keeps its enchantments").
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executeEffect } from '../../src/effects/interpreter.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, RegisteredTrigger } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
  resetInstanceCounter,
} from '../helpers/card-factory.js';

function ctx(sourceId: string): EffectContext {
  return { sourceInstanceId: sourceId, controllerId: 0, triggerDepth: 0 };
}

const attach = (retainAbilities?: boolean): Effect => ({
  type: 'attach_as_equipment',
  target: { type: 'target_character', side: 'allied' },
  ...(retainAbilities === undefined ? {} : { retainAbilities }),
});

describe('attach_as_equipment effect', () => {
  beforeEach(() => resetInstanceCounter());

  it('removes the source from its zone and attaches it to the target ally', () => {
    const source = mockCard({ name: 'Crawler', owner: 0 });
    const ally = mockCard({ name: 'Ally', owner: 0 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [source, ally, null] }),
        }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      attach(true),
      // selectedTargets forces the target ally (resolveTargets short-circuits to it).
      { ...ctx(source.instanceId), selectedTargets: [ally.instanceId] },
    );

    const front = result.newState.players[0].zones.frontline;
    // Source slot is now empty; it is not in the discard pile.
    expect(front[0]).toBeNull();
    expect(result.newState.players[0].discardPile).toHaveLength(0);
    // Ally now carries the source as equipment.
    const attached = front[1];
    expect(attached?.equipment?.instanceId).toBe(source.instanceId);
    expect(result.events).toEqual([
      { type: 'EQUIPMENT_ATTACHED', equipmentId: source.instanceId, targetId: ally.instanceId },
    ]);
  });

  it('drops the source abilities when retainAbilities is false', () => {
    const trigger: RegisteredTrigger = {
      id: 't1',
      sourceInstanceId: 'SRC',
      ownerPlayerId: 0,
      trigger: { type: 'on_destroy' },
      effects: [],
      abilityIndex: 0,
    };
    const source = mockCard({
      instanceId: 'SRC',
      owner: 0,
      registeredTriggers: [trigger],
    });
    const ally = mockCard({ name: 'Ally', owner: 0 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      attach(false),
      { ...ctx('SRC'), selectedTargets: [ally.instanceId] },
    );
    const equip = result.newState.players[0].zones.frontline[1]?.equipment;
    expect(equip?.registeredTriggers).toHaveLength(0);
  });

  it('keeps the source abilities when retainAbilities is true', () => {
    const trigger: RegisteredTrigger = {
      id: 't1',
      sourceInstanceId: 'SRC',
      ownerPlayerId: 0,
      trigger: { type: 'on_destroy' },
      effects: [],
      abilityIndex: 0,
    };
    const source = mockCard({ instanceId: 'SRC', owner: 0, registeredTriggers: [trigger] });
    const ally = mockCard({ name: 'Ally', owner: 0 });
    const state = mockGameState({
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
        mockPlayerState(1),
      ],
    });

    const result = executeEffect(
      state,
      attach(true),
      { ...ctx('SRC'), selectedTargets: [ally.instanceId] },
    );
    const equip = result.newState.players[0].zones.frontline[1]?.equipment;
    expect(equip?.registeredTriggers).toHaveLength(1);
  });

  it('is deterministic — same input yields the same state', () => {
    const build = () => {
      resetInstanceCounter();
      const source = mockCard({ instanceId: 'SRC', owner: 0 });
      const ally = mockCard({ instanceId: 'ALLY', owner: 0 });
      return mockGameState({
        players: [
          mockPlayerState(0, { zones: zonesWithCards({ frontline: [source, ally, null] }) }),
          mockPlayerState(1),
        ],
      });
    };
    const run = () =>
      executeEffect(build(), attach(true), { ...ctx('SRC'), selectedTargets: ['ALLY'] }).newState;
    expect(run().players[0].zones.frontline).toEqual(run().players[0].zones.frontline);
  });
});

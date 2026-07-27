import { describe, expect, it } from 'vitest';
import { validateGameStateInvariants } from '../../src/invariants/game-state-invariants.js';
import { transition } from '../../src/transitions/transition.js';
import { CURRENT_GAME_CONFIG } from '../../src/rules/manifest.js';
import type { AbilityDSL } from '../../src/types/ability.js';
import { recomputeAuras } from '../../src/runtime/aura-recompute.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  zonesWithCards,
} from '../helpers/card-factory.js';

describe('GameState physical-card invariants', () => {
  it('accepts a coherent bidirectional equipment attachment', () => {
    const equipment = mockCard({
      instanceId: 'equipment',
      cardType: 'E',
      owner: 0,
      holderInstanceId: 'holder',
    });
    const holder = mockCard({
      instanceId: 'holder',
      owner: 0,
      equipment,
    });
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [holder] }),
        }),
        mockPlayerState(1),
      ],
    });
    expect(validateGameStateInvariants(state)).toEqual([]);
  });

  it('finds mismatched holders, invalid attachment types, and duplicate instances', () => {
    const equipment = mockCard({
      instanceId: 'duplicated',
      cardType: 'C',
      owner: 0,
      holderInstanceId: 'wrong-holder',
    });
    const holder = mockCard({
      instanceId: 'holder',
      owner: 0,
      equipment,
    });
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          hand: [{ ...equipment, holderInstanceId: undefined }],
          zones: zonesWithCards({ frontline: [holder] }),
        }),
        mockPlayerState(1),
      ],
    });
    expect(validateGameStateInvariants(state).map((violation) => violation.code)).toEqual(
      expect.arrayContaining([
        'duplicate_instance',
        'attachment_mismatch',
        'attachment_type',
      ]),
    );
  });

  it('turns a successful command over corrupt current state into a typed failure', () => {
    const badEquipment = mockCard({
      instanceId: 'bad-equipment',
      cardType: 'E',
      owner: 0,
      holderInstanceId: 'somebody-else',
    });
    const holder = mockCard({
      instanceId: 'holder',
      owner: 0,
      equipment: badEquipment,
    });
    const state = mockGameState({
      phase: 'strategy',
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [holder] }),
        }),
        mockPlayerState(1),
      ],
    });
    const result = transition(state, { type: 'advance_phase', playerId: 0 });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') throw new Error('expected invariant failure');
    expect(result.failure.code).toBe('invariant_failure');
    expect(result.state).toBe(state);
  });

  it('detects nonpositive living HP, cross-player resource duplication, and corrupt exile ledgers', () => {
    const dead = mockCard({
      instanceId: 'dead-on-board',
      owner: 0,
      currentHp: 0,
    });
    const exiled = mockCard({
      instanceId: 'exiled-card',
      owner: 0,
    });
    const duplicatedResource = {
      instanceId: 'shared-resource',
      resourceType: 'mana' as const,
      exhausted: false,
    };
    const state = mockGameState({
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [dead] }),
          resourceBank: [duplicatedResource],
          exile: [
            {
              instanceId: 'wrong-record-id',
              card: exiled,
              ownerPlayerId: 1,
              cause: 'effect',
              turnNumber: 1,
            },
          ],
        }),
        mockPlayerState(1, {
          resourceDeck: [duplicatedResource],
        }),
      ],
    });

    expect(validateGameStateInvariants(state).map((violation) => violation.code)).toEqual(
      expect.arrayContaining([
        'nonpositive_battlefield_hp',
        'duplicate_instance',
        'exile_record_mismatch',
      ]),
    );
  });

  it('makes the stabilized aura graph explicit and detects stale derived contributions', () => {
    const aura: AbilityDSL = {
      type: 'aura',
      effects: [
        {
          type: 'modify_stats',
          target: { type: 'all_characters', side: 'allied' },
          modifier: { atk: 1 },
          duration: { type: 'while_in_play' },
        },
      ],
    };
    const source = mockCard({
      instanceId: 'aura-source',
      owner: 0,
      abilities: [aura],
    });
    const target = mockCard({ instanceId: 'aura-target', owner: 0 });
    const stabilized = recomputeAuras(mockGameState({
      config: CURRENT_GAME_CONFIG,
      players: [
        mockPlayerState(0, {
          zones: zonesWithCards({ frontline: [source, target] }),
        }),
        mockPlayerState(1),
      ],
    }));

    expect(stabilized.auraDerivation).toMatchObject({
      sourceKeys: ['0:aura-source:0'],
    });
    expect(stabilized.auraDerivation?.contributionKeys).toHaveLength(2);
    expect(validateGameStateInvariants(stabilized)).toEqual([]);

    const corrupted = {
      ...stabilized,
      auraDerivation: {
        ...stabilized.auraDerivation!,
        contributionKeys: [],
      },
    };
    expect(
      validateGameStateInvariants(corrupted).map((violation) => violation.code),
    ).toContain('aura_derivation_mismatch');
  });
});

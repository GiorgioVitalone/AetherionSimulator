import { describe, it, expect, beforeEach } from 'vitest';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { findCard } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  zonesWithCards,
} from '../helpers/card-factory.js';

const FREE = { mana: 0, energy: 0, flexible: 0 };
const ONE_FLEX = { mana: 0, energy: 0, flexible: 1 };

function readyResources(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `r_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

describe('Elite — direct High-Ground deploy with +2 surcharge (Rulebook 16)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('offers a High-Ground deploy slot (surcharge 2) ONLY for Elite characters', () => {
    const elite = mockCard({ owner: 0, traits: ['elite'], cost: FREE });
    const plain = mockCard({ owner: 0, cost: FREE });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { hand: [elite, plain], resourceBank: readyResources(5) }),
        mockPlayerState(1),
      ],
    });

    const actions = computeAvailableActions(state);
    const eliteOpt = actions.canDeploy.find(o => o.cardInstanceId === elite.instanceId)!;
    const plainOpt = actions.canDeploy.find(o => o.cardInstanceId === plain.instanceId)!;

    const eliteHg = eliteOpt.validSlots.find(g => g.zone === 'high_ground');
    expect(eliteHg).toBeDefined();
    expect(eliteHg!.surcharge).toBe(2);
    expect(plainOpt.validSlots.some(g => g.zone === 'high_ground')).toBe(false);
  });

  it('does NOT offer the High-Ground slot when the +2 surcharge is unaffordable', () => {
    const elite = mockCard({ owner: 0, traits: ['elite'], cost: ONE_FLEX });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        // 1 resource: affords the base cost (Frontline/Reserve) but not base+2 (HG).
        mockPlayerState(0, { hand: [elite], resourceBank: readyResources(1) }),
        mockPlayerState(1),
      ],
    });

    const opt = computeAvailableActions(state).canDeploy.find(
      o => o.cardInstanceId === elite.instanceId,
    )!;
    expect(opt.validSlots.some(g => g.zone === 'frontline')).toBe(true);
    expect(opt.validSlots.some(g => g.zone === 'high_ground')).toBe(false);
  });

  it('deploys an Elite to High Ground and pays the +2 surcharge', () => {
    const elite = mockCard({ owner: 0, traits: ['elite'], cost: FREE });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { hand: [elite], resourceBank: readyResources(5) }),
        mockPlayerState(1),
      ],
    });

    const { state: next } = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: elite.instanceId,
      zone: 'high_ground',
      slotIndex: 0,
    });

    const placed = findCard(next.players[0]!.zones, elite.instanceId);
    expect(placed?.zone).toBe('high_ground');
    // FREE base + 2 surcharge => exactly 2 resources exhausted.
    const exhausted = next.players[0]!.resourceBank.filter(r => r.exhausted).length;
    expect(exhausted).toBe(2);
  });
});

describe('Swift / Rush X — extra moves without exhausting (Rulebook 16)', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('Rush 2 seeds two deploy-turn free moves; each move does not exhaust', () => {
    const rusher = mockCard({ owner: 0, traits: ['rush'], rushValue: 2, cost: FREE });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { hand: [rusher], resourceBank: readyResources(3) }),
        mockPlayerState(1),
      ],
    });

    // Deploy to Frontline (Haste-less is summoning sick, but movement is allowed).
    const deployed = executePlayerAction(state, {
      type: 'deploy',
      cardInstanceId: rusher.instanceId,
      zone: 'frontline',
      slotIndex: 0,
    }).state;
    const afterDeploy = findCard(deployed.players[0]!.zones, rusher.instanceId)!.card;
    expect(afterDeploy.freeMovesRemaining).toBe(2);

    // First free move: Frontline -> High Ground, not exhausted, one free move spent.
    const moved1 = executePlayerAction(deployed, {
      type: 'move',
      cardInstanceId: rusher.instanceId,
      toZone: 'high_ground',
    }).state;
    const afterMove1 = findCard(moved1.players[0]!.zones, rusher.instanceId)!.card;
    expect(afterMove1.exhausted).toBe(false);
    expect(afterMove1.movedThisTurn).toBe(false);
    expect(afterMove1.freeMovesRemaining).toBe(1);

    // Available actions still offer a move despite no normal move left.
    const actions = computeAvailableActions(moved1);
    expect(actions.canMove.some(m => m.cardInstanceId === rusher.instanceId)).toBe(true);
  });

  it('Swift grants exactly one free move; the next move exhausts normally', () => {
    const swift = mockCard({
      owner: 0,
      traits: ['swift'],
      freeMovesRemaining: 1,
      summoningSick: false,
      cost: FREE,
    });
    const state = mockGameState({
      phase: 'strategy',
      players: [
        mockPlayerState(0, { zones: zonesWithCards({ reserve: [swift, null] }) }),
        mockPlayerState(1),
      ],
    });

    // Free move (Reserve -> Frontline): no exhaust, counter to 0.
    const m1 = executePlayerAction(state, {
      type: 'move',
      cardInstanceId: swift.instanceId,
      toZone: 'frontline',
    }).state;
    const c1 = findCard(m1.players[0]!.zones, swift.instanceId)!.card;
    expect(c1.exhausted).toBe(false);
    expect(c1.freeMovesRemaining).toBe(0);

    // Next move (Frontline -> High Ground): no free moves left, so it exhausts.
    const m2 = executePlayerAction(m1, {
      type: 'move',
      cardInstanceId: swift.instanceId,
      toZone: 'high_ground',
    }).state;
    const c2 = findCard(m2.players[0]!.zones, swift.instanceId)!.card;
    expect(c2.exhausted).toBe(true);
    expect(c2.movedThisTurn).toBe(true);
  });
});

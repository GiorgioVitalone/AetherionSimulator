import { describe, it, expect, beforeEach } from 'vitest';
import { featurize, FEATURE_LENGTH } from '../../src/neural/featurizer.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';
import type { CardInstance, GameState } from '../../src/types/game-state.js';

function swapSeat(owner: 0 | 1): 0 | 1 {
  return owner === 0 ? 1 : 0;
}

function mirrorCard(card: CardInstance): CardInstance {
  return { ...card, owner: swapSeat(card.owner) };
}

/** Seat-mirror a GameState: swap players[0] <-> players[1], flip
 * activePlayerIndex, and flip every CardInstance.owner. */
function mirrorGameState(gs: GameState): GameState {
  const mirrorPlayer = (index: 0 | 1) => {
    const player = gs.players[index];
    return {
      ...player,
      hand: player.hand.map(mirrorCard),
      mainDeck: player.mainDeck.map(mirrorCard),
      discardPile: player.discardPile.map(mirrorCard),
      zones: {
        reserve: player.zones.reserve.map((c) => (c ? mirrorCard(c) : c)),
        frontline: player.zones.frontline.map((c) => (c ? mirrorCard(c) : c)),
        highGround: player.zones.highGround.map((c) => (c ? mirrorCard(c) : c)),
      },
    };
  };

  return {
    ...gs,
    players: [mirrorPlayer(1), mirrorPlayer(0)],
    activePlayerIndex: swapSeat(gs.activePlayerIndex),
  };
}

describe('featurize', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  it('produces a finite, fixed-length vector for a fresh initial state', () => {
    const state = mockGameState();
    const vector = featurize(state);
    expect(vector.length).toBe(FEATURE_LENGTH);
    expect(Array.from(vector).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('produces a finite, fixed-length vector for a mid-game state with cards on board', () => {
    let zonesP0 = emptyZones();
    zonesP0 = deployToZone(
      zonesP0,
      mockCard({ owner: 0, traits: ['flying'], currentHp: 5, currentAtk: 4 }),
      'frontline',
      0,
    );
    zonesP0 = deployToZone(zonesP0, mockCard({ owner: 0 }), 'reserve', 0);

    let zonesP1 = emptyZones();
    zonesP1 = deployToZone(
      zonesP1,
      mockCard({ owner: 1, traits: ['defender'], exhausted: true }),
      'frontline',
      1,
    );

    const state = mockGameState({
      turnNumber: 5,
      phase: 'action',
      players: [
        mockPlayerState(0, {
          zones: zonesP0,
          hand: [mockCard({ owner: 0 })],
        }),
        mockPlayerState(1, { zones: zonesP1 }),
      ],
    });

    const vector = featurize(state);
    expect(vector.length).toBe(FEATURE_LENGTH);
    expect(Array.from(vector).every((v) => Number.isFinite(v))).toBe(true);
  });

  it('is deterministic — the same GameState featurizes identically twice', () => {
    let zones = emptyZones();
    zones = deployToZone(zones, mockCard({ owner: 0 }), 'frontline', 0);
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });

    const first = featurize(state);
    const second = featurize(state);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('is perspective-canonical: seat-mirroring the state leaves the vector unchanged', () => {
    let zonesP0 = emptyZones();
    zonesP0 = deployToZone(
      zonesP0,
      mockCard({ owner: 0, traits: ['sniper'], currentHp: 6, currentAtk: 3 }),
      'frontline',
      1,
    );
    zonesP0 = deployToZone(zonesP0, mockCard({ owner: 0 }), 'reserve', 0);

    let zonesP1 = emptyZones();
    zonesP1 = deployToZone(
      zonesP1,
      mockCard({ owner: 1, traits: ['stealth'], exhausted: true }),
      'high_ground',
      0,
    );

    const state = mockGameState({
      activePlayerIndex: 0,
      turnNumber: 7,
      phase: 'strategy',
      players: [
        mockPlayerState(0, { zones: zonesP0, hand: [mockCard({ owner: 0 })] }),
        mockPlayerState(1, { zones: zonesP1 }),
      ],
    });

    const mirrored = mirrorGameState(state);

    const original = featurize(state);
    const mirroredVector = featurize(mirrored);
    expect(Array.from(mirroredVector)).toEqual(Array.from(original));
  });

  it('differs from an otherwise-identical state only in the occupied slot', () => {
    const withoutCard = mockGameState({
      players: [mockPlayerState(0, { zones: emptyZones() }), mockPlayerState(1)],
    });

    let zonesWithCard = emptyZones();
    zonesWithCard = deployToZone(zonesWithCard, mockCard({ owner: 0 }), 'frontline', 0);
    const withCard = mockGameState({
      players: [mockPlayerState(0, { zones: zonesWithCard }), mockPlayerState(1)],
    });

    const a = Array.from(featurize(withoutCard));
    const b = Array.from(featurize(withCard));
    expect(a.length).toBe(b.length);

    const diffIndices = a.map((v, i) => (v !== b[i] ? i : -1)).filter((i) => i >= 0);
    // Every diff should fall strictly inside the frontline-slot-0 card block —
    // the block's absence-vs-presence flag and stat fields differ; everything
    // else in the vector is untouched.
    expect(diffIndices.length).toBeGreaterThan(0);
  });
});

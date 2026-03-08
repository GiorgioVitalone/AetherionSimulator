import { describe, it, expect, beforeEach } from 'vitest';
import {
  deployToZone,
  removeFromZone,
  moveCard,
  findCard,
  hasOpenSlot,
  firstOpenSlot,
  getCardsInZone,
  getAllCards,
  isAdjacentZone,
  createEmptyZoneState,
} from '../../src/zones/zone-manager.js';
import {
  mockCard,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

describe('Zone Manager', () => {
  beforeEach(() => {
    resetInstanceCounter();
  });

  describe('createEmptyZoneState', () => {
    it('should create zones with correct slot counts', () => {
      const zones = createEmptyZoneState();
      expect(zones.reserve).toHaveLength(2);
      expect(zones.frontline).toHaveLength(3);
      expect(zones.highGround).toHaveLength(2);
    });

    it('should have all null slots', () => {
      const zones = createEmptyZoneState();
      expect(zones.reserve.every(s => s === null)).toBe(true);
      expect(zones.frontline.every(s => s === null)).toBe(true);
      expect(zones.highGround.every(s => s === null)).toBe(true);
    });
  });

  describe('deployToZone', () => {
    it('should deploy to first open slot in frontline', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'frontline');
      expect(zones.frontline[0]).toEqual(card);
      expect(zones.frontline[1]).toBeNull();
    });

    it('should deploy to specific slot index', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'frontline', 2);
      expect(zones.frontline[0]).toBeNull();
      expect(zones.frontline[2]).toEqual(card);
    });

    it('should deploy to reserve', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'reserve');
      expect(zones.reserve[0]).toEqual(card);
    });

    it('should deploy to high ground', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'high_ground');
      expect(zones.highGround[0]).toEqual(card);
    });

    it('should throw when zone is full', () => {
      const c1 = mockCard();
      const c2 = mockCard();
      const c3 = mockCard();
      let zones = deployToZone(emptyZones(), c1, 'reserve');
      zones = deployToZone(zones, c2, 'reserve');
      expect(() => deployToZone(zones, c3, 'reserve')).toThrow(
        'No open slot in reserve',
      );
    });

    it('should throw when slot is occupied', () => {
      const c1 = mockCard();
      const c2 = mockCard();
      const zones = deployToZone(emptyZones(), c1, 'frontline', 0);
      expect(() => deployToZone(zones, c2, 'frontline', 0)).toThrow(
        'occupied',
      );
    });

    it('should not mutate original zones', () => {
      const original = emptyZones();
      const card = mockCard();
      deployToZone(original, card, 'frontline');
      expect(original.frontline[0]).toBeNull();
    });
  });

  describe('removeFromZone', () => {
    it('should remove a card and return it', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'frontline');
      const result = removeFromZone(zones, card.instanceId);
      expect(result.removed).toEqual(card);
      expect(result.zones.frontline[0]).toBeNull();
    });

    it('should return null when card not found', () => {
      const result = removeFromZone(emptyZones(), 'nonexistent');
      expect(result.removed).toBeNull();
    });
  });

  describe('findCard', () => {
    it('should find card in frontline', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'frontline', 1);
      const found = findCard(zones, card.instanceId);
      expect(found).not.toBeNull();
      expect(found?.zone).toBe('frontline');
      expect(found?.slotIndex).toBe(1);
    });

    it('should find card in reserve', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'reserve');
      const found = findCard(zones, card.instanceId);
      expect(found?.zone).toBe('reserve');
    });

    it('should return null when not found', () => {
      expect(findCard(emptyZones(), 'missing')).toBeNull();
    });
  });

  describe('slot queries', () => {
    it('hasOpenSlot returns true for empty zone', () => {
      expect(hasOpenSlot(emptyZones(), 'frontline')).toBe(true);
    });

    it('hasOpenSlot returns false for full zone', () => {
      let zones = emptyZones();
      zones = deployToZone(zones, mockCard(), 'reserve');
      zones = deployToZone(zones, mockCard(), 'reserve');
      expect(hasOpenSlot(zones, 'reserve')).toBe(false);
    });

    it('firstOpenSlot returns 0 for empty zone', () => {
      expect(firstOpenSlot(emptyZones(), 'frontline')).toBe(0);
    });

    it('firstOpenSlot returns -1 for full zone', () => {
      let zones = emptyZones();
      zones = deployToZone(zones, mockCard(), 'reserve');
      zones = deployToZone(zones, mockCard(), 'reserve');
      expect(firstOpenSlot(zones, 'reserve')).toBe(-1);
    });
  });

  describe('getCardsInZone', () => {
    it('should return only non-null cards', () => {
      const c1 = mockCard();
      const c2 = mockCard();
      let zones = deployToZone(emptyZones(), c1, 'frontline', 0);
      zones = deployToZone(zones, c2, 'frontline', 2);
      const cards = getCardsInZone(zones, 'frontline');
      expect(cards).toHaveLength(2);
    });

    it('should return empty array for empty zone', () => {
      expect(getCardsInZone(emptyZones(), 'reserve')).toHaveLength(0);
    });
  });

  describe('getAllCards', () => {
    it('should return cards from all zones', () => {
      let zones = emptyZones();
      zones = deployToZone(zones, mockCard(), 'reserve');
      zones = deployToZone(zones, mockCard(), 'frontline');
      zones = deployToZone(zones, mockCard(), 'high_ground');
      expect(getAllCards(zones)).toHaveLength(3);
    });
  });

  describe('isAdjacentZone', () => {
    it('reserve ↔ frontline is adjacent', () => {
      expect(isAdjacentZone('reserve', 'frontline')).toBe(true);
      expect(isAdjacentZone('frontline', 'reserve')).toBe(true);
    });

    it('frontline ↔ high_ground is adjacent', () => {
      expect(isAdjacentZone('frontline', 'high_ground')).toBe(true);
      expect(isAdjacentZone('high_ground', 'frontline')).toBe(true);
    });

    it('reserve ↔ high_ground is NOT adjacent', () => {
      expect(isAdjacentZone('reserve', 'high_ground')).toBe(false);
      expect(isAdjacentZone('high_ground', 'reserve')).toBe(false);
    });
  });

  describe('moveCard', () => {
    it('should move from reserve to frontline', () => {
      const card = mockCard();
      let zones = deployToZone(emptyZones(), card, 'reserve');
      zones = moveCard(zones, card.instanceId, 'frontline');
      expect(findCard(zones, card.instanceId)?.zone).toBe('frontline');
      expect(zones.reserve[0]).toBeNull();
    });

    it('should exhaust the moved card', () => {
      const card = mockCard({ exhausted: false });
      let zones = deployToZone(emptyZones(), card, 'frontline');
      zones = moveCard(zones, card.instanceId, 'high_ground');
      const found = findCard(zones, card.instanceId);
      expect(found?.card.exhausted).toBe(true);
      expect(found?.card.movedThisTurn).toBe(true);
    });

    it('should throw for non-adjacent move (reserve → high_ground)', () => {
      const card = mockCard();
      const zones = deployToZone(emptyZones(), card, 'reserve');
      expect(() =>
        moveCard(zones, card.instanceId, 'high_ground'),
      ).toThrow('Cannot move directly');
    });

    it('should throw when target zone is full', () => {
      const c1 = mockCard();
      const c2 = mockCard();
      const c3 = mockCard();
      let zones = deployToZone(emptyZones(), c1, 'reserve');
      zones = deployToZone(zones, c2, 'frontline');
      zones = deployToZone(zones, c3, 'frontline');
      zones = deployToZone(zones, mockCard(), 'frontline');
      expect(() =>
        moveCard(zones, c1.instanceId, 'frontline'),
      ).toThrow('No open slot');
    });

    it('should throw when card not found', () => {
      expect(() =>
        moveCard(emptyZones(), 'missing', 'frontline'),
      ).toThrow('not found');
    });
  });
});

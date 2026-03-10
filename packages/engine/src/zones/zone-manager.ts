/**
 * Zone Manager — CRUD operations for battlefield zones.
 * Pure functions: state in → state out, no mutations.
 */
import type { CardInstance, ZoneState } from '../types/game-state.js';
import type { ZoneType } from '../types/common.js';
import { ZONE_SLOTS } from '../types/game-state.js';
import {
  getFreeMoveAllowance,
  getMaxMovesPerTurn,
} from '../state/runtime-card-helpers.js';

// ── Zone Accessors ───────────────────────────────────────────────────────────

export function getZoneSlots(zone: ZoneType): number {
  return ZONE_SLOTS[zone];
}

export function getZoneArray(
  zones: ZoneState,
  zone: ZoneType,
): readonly (CardInstance | null)[] {
  switch (zone) {
    case 'reserve':
      return zones.reserve;
    case 'frontline':
      return zones.frontline;
    case 'high_ground':
      return zones.highGround;
  }
}

export function getCardsInZone(
  zones: ZoneState,
  zone: ZoneType,
): readonly CardInstance[] {
  return getZoneArray(zones, zone).filter(
    (slot): slot is CardInstance => slot !== null,
  );
}

export function getAllCards(zones: ZoneState): readonly CardInstance[] {
  return [
    ...getCardsInZone(zones, 'reserve'),
    ...getCardsInZone(zones, 'frontline'),
    ...getCardsInZone(zones, 'high_ground'),
  ];
}

// ── Slot Queries ─────────────────────────────────────────────────────────────

export function hasOpenSlot(zones: ZoneState, zone: ZoneType): boolean {
  return firstOpenSlot(zones, zone) !== -1;
}

export function firstOpenSlot(zones: ZoneState, zone: ZoneType): number {
  const arr = getZoneArray(zones, zone);
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === null) return i;
  }
  return -1;
}

// ── Find ─────────────────────────────────────────────────────────────────────

export interface CardLocation {
  readonly card: CardInstance;
  readonly zone: ZoneType;
  readonly slotIndex: number;
}

export function findCard(
  zones: ZoneState,
  instanceId: string,
): CardLocation | null {
  const zoneTypes: readonly ZoneType[] = [
    'reserve',
    'frontline',
    'high_ground',
  ];
  for (const zone of zoneTypes) {
    const arr = getZoneArray(zones, zone);
    for (let i = 0; i < arr.length; i++) {
      const card = arr[i] ?? null;
      if (card !== null && card.instanceId === instanceId) {
        return { card, zone, slotIndex: i };
      }
    }
  }
  return null;
}

// ── Mutations (return new state) ─────────────────────────────────────────────

function setZoneSlot(
  zones: ZoneState,
  zone: ZoneType,
  slotIndex: number,
  value: CardInstance | null,
): ZoneState {
  const arr = [...getZoneArray(zones, zone)];
  arr[slotIndex] = value;
  switch (zone) {
    case 'reserve':
      return { ...zones, reserve: arr };
    case 'frontline':
      return { ...zones, frontline: arr };
    case 'high_ground':
      return { ...zones, highGround: arr };
  }
}

export function deployToZone(
  zones: ZoneState,
  card: CardInstance,
  zone: ZoneType,
  slotIndex?: number,
): ZoneState {
  const idx = slotIndex ?? firstOpenSlot(zones, zone);
  if (idx === -1) {
    throw new Error(`No open slot in ${zone}`);
  }
  if (idx < 0 || idx >= getZoneSlots(zone)) {
    throw new Error(`Slot ${String(idx)} out of range for ${zone}`);
  }
  const existing = getZoneArray(zones, zone)[idx];
  if (existing !== null) {
    throw new Error(`Slot ${String(idx)} in ${zone} is occupied`);
  }
  return setZoneSlot(zones, zone, idx, card);
}

export interface RemoveResult {
  readonly zones: ZoneState;
  readonly removed: CardInstance | null;
}

export function removeFromZone(
  zones: ZoneState,
  instanceId: string,
): RemoveResult {
  const location = findCard(zones, instanceId);
  if (location === null) {
    return { zones, removed: null };
  }
  return {
    zones: setZoneSlot(zones, location.zone, location.slotIndex, null),
    removed: location.card,
  };
}

// ── Movement ─────────────────────────────────────────────────────────────────

const ADJACENT_ZONES: ReadonlyMap<ZoneType, readonly ZoneType[]> = new Map([
  ['reserve', ['frontline']],
  ['frontline', ['reserve', 'high_ground']],
  ['high_ground', ['frontline']],
]);

export function isAdjacentZone(from: ZoneType, to: ZoneType): boolean {
  const adjacent = ADJACENT_ZONES.get(from);
  return adjacent !== undefined && adjacent.includes(to);
}

export function moveCard(
  zones: ZoneState,
  instanceId: string,
  toZone: ZoneType,
  slotIndex?: number,
  turnNumber?: number,
): ZoneState {
  const location = findCard(zones, instanceId);
  if (location === null) {
    throw new Error(`Card ${instanceId} not found in any zone`);
  }
  if (location.card.exhausted) {
    throw new Error(`Card ${instanceId} is exhausted`);
  }
  if (!isAdjacentZone(location.zone, toZone)) {
    throw new Error(
      `Cannot move directly from ${location.zone} to ${toZone}`,
    );
  }
  const targetSlot = slotIndex ?? firstOpenSlot(zones, toZone);
  if (targetSlot === -1) {
    throw new Error(`No open slot in ${toZone}`);
  }
  if (targetSlot < 0 || targetSlot >= getZoneSlots(toZone)) {
    throw new Error(`Slot ${String(targetSlot)} out of range for ${toZone}`);
  }
  if (getZoneArray(zones, toZone)[targetSlot] !== null) {
    throw new Error(`Slot ${String(targetSlot)} in ${toZone} is occupied`);
  }
  const freeMoveAllowance = turnNumber === undefined
    ? 0
    : getFreeMoveAllowance(location.card, turnNumber);
  const maxMoves = turnNumber === undefined
    ? 1
    : getMaxMovesPerTurn(location.card, turnNumber);
  if (location.card.movesThisTurn >= maxMoves) {
    throw new Error(`Card ${instanceId} has no remaining moves this turn`);
  }
  const shouldExhaust = location.card.movesThisTurn >= freeMoveAllowance;
  const movedCard: CardInstance = {
    ...location.card,
    exhausted: shouldExhaust ? true : location.card.exhausted,
    movedThisTurn: true,
    movesThisTurn: location.card.movesThisTurn + 1,
  };
  const cleared = setZoneSlot(zones, location.zone, location.slotIndex, null);
  return setZoneSlot(cleared, toZone, targetSlot, movedCard);
}

// ── Empty Zone State Factory ─────────────────────────────────────────────────

export function createEmptyZoneState(): ZoneState {
  return {
    reserve: [null, null],
    frontline: [null, null, null],
    highGround: [null, null],
  };
}

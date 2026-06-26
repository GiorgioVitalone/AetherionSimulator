/**
 * Wave 8 — Equipment fidelity (Rulebook 13) + grant_trait durations (Rulebook 16).
 *
 * Covers: alignment/Tag attach requirement, replace-existing equipment, transfer
 * (cost + once-per-turn), voluntary removal, and equipment following its destroyed
 * holder to the discard pile (effect + combat). Plus grant_trait honoring a timed
 * duration and expiring at the boundary.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { executeEffect } from '../../src/effects/interpreter.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { meetsEquipRequirement } from '../../src/actions/equip-eligibility.js';
import { expireModifiers } from '../../src/runtime/modifier-expiry.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import type { Effect } from '../../src/types/effects.js';
import type { EffectContext, ResourceCard } from '../../src/types/game-state.js';
import {
  mockCard,
  mockGameState,
  mockPlayerState,
  resetInstanceCounter,
  emptyZones,
} from '../helpers/card-factory.js';

function ctx(sourceId: string, controllerId: 0 | 1 = 0): EffectContext {
  return { sourceInstanceId: sourceId, controllerId, triggerDepth: 0 };
}

function bank(n: number, type: 'mana' | 'energy' = 'mana'): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${type}_${String(i)}`,
    resourceType: type,
    exhausted: false,
  }));
}

describe('Wave 8 — equipment attach requirement (Rulebook 13)', () => {
  beforeEach(resetInstanceCounter);

  it('meetsEquipRequirement: no requirement attaches to anyone', () => {
    const equip = mockCard({ cardType: 'E' });
    const char = mockCard({ cardType: 'C', tags: [] });
    expect(meetsEquipRequirement(equip, char)).toBe(true);
  });

  it('honors a resource-type (Magic/Tech) requirement', () => {
    const techEquip = mockCard({ cardType: 'E', equipRequirement: { resourceType: 'energy' } });
    const techChar = mockCard({ cardType: 'C', cost: { mana: 0, energy: 2, flexible: 0 } });
    const magicChar = mockCard({ cardType: 'C', cost: { mana: 2, energy: 0, flexible: 0 } });
    expect(meetsEquipRequirement(techEquip, techChar)).toBe(true);
    expect(meetsEquipRequirement(techEquip, magicChar)).toBe(false);
  });

  it('honors a Tag requirement', () => {
    const equip = mockCard({ cardType: 'E', equipRequirement: { tag: 'Beast' } });
    const beast = mockCard({ cardType: 'C', tags: ['Beast'] });
    const other = mockCard({ cardType: 'C', tags: ['Construct'] });
    expect(meetsEquipRequirement(equip, beast)).toBe(true);
    expect(meetsEquipRequirement(equip, other)).toBe(false);
  });

  it('available-actions excludes ineligible characters', () => {
    const equip = mockCard({
      cardType: 'E', owner: 0, cost: { mana: 0, energy: 0, flexible: 0 },
      equipRequirement: { tag: 'Beast' },
    });
    const beast = mockCard({ cardType: 'C', owner: 0, tags: ['Beast'] });
    const other = mockCard({ cardType: 'C', owner: 0, tags: [] });
    let zones = deployToZone(emptyZones(), beast, 'frontline');
    zones = deployToZone(zones, other, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hand: [equip], zones }), mockPlayerState(1)],
    });
    const actions = computeAvailableActions(state);
    expect(actions.canAttachEquipment).toHaveLength(1);
    expect(actions.canAttachEquipment[0]!.validTargets).toEqual([beast.instanceId]);
  });

  it('executeAttachEquipment rejects an ineligible target', () => {
    const equip = mockCard({
      cardType: 'E', owner: 0, cost: { mana: 0, energy: 0, flexible: 0 },
      equipRequirement: { tag: 'Beast' },
    });
    const other = mockCard({ cardType: 'C', owner: 0, tags: [] });
    const zones = deployToZone(emptyZones(), other, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hand: [equip], zones }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, {
      type: 'attach_equipment', cardInstanceId: equip.instanceId, targetInstanceId: other.instanceId,
    });
    expect(result.state.players[0]!.zones.frontline[0]!.equipment).toBeNull();
    expect(result.state.players[0]!.hand).toHaveLength(1);
  });
});

describe('Wave 8 — replace existing equipment (Rulebook 13)', () => {
  beforeEach(resetInstanceCounter);

  it('destroys the existing equipment to discard before attaching the new one', () => {
    const oldEquip = mockCard({ cardType: 'E', owner: 0, name: 'Old' });
    const char = mockCard({ cardType: 'C', owner: 0, equipment: oldEquip });
    const newEquip = mockCard({ cardType: 'E', owner: 0, name: 'New', cost: { mana: 0, energy: 0, flexible: 0 } });
    const zones = deployToZone(emptyZones(), char, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { hand: [newEquip], zones }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, {
      type: 'attach_equipment', cardInstanceId: newEquip.instanceId, targetInstanceId: char.instanceId,
    });
    const holder = result.state.players[0]!.zones.frontline[0]!;
    expect(holder.equipment!.instanceId).toBe(newEquip.instanceId);
    expect(result.state.players[0]!.discardPile.map(c => c.instanceId)).toContain(oldEquip.instanceId);
    expect(result.events.some(
      e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === oldEquip.instanceId,
    )).toBe(true);
  });
});

describe('Wave 8 — voluntary removal & transfer (Rulebook 13)', () => {
  beforeEach(resetInstanceCounter);

  it('voluntary removal discards the equipment and clears the holder', () => {
    const equip = mockCard({ cardType: 'E', owner: 0 });
    const char = mockCard({ cardType: 'C', owner: 0, equipment: equip });
    const zones = deployToZone(emptyZones(), char, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, {
      type: 'remove_equipment', equipmentInstanceId: equip.instanceId,
    });
    expect(result.state.players[0]!.zones.frontline[0]!.equipment).toBeNull();
    expect(result.state.players[0]!.discardPile.map(c => c.instanceId)).toContain(equip.instanceId);
    expect(result.events.some(
      e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === equip.instanceId,
    )).toBe(true);
  });

  it('transfer moves equipment to an empty eligible character, paying its cost', () => {
    const equip = mockCard({ cardType: 'E', owner: 0, cost: { mana: 1, energy: 0, flexible: 0 } });
    const from = mockCard({ cardType: 'C', owner: 0, equipment: equip });
    const to = mockCard({ cardType: 'C', owner: 0 });
    let zones = deployToZone(emptyZones(), from, 'frontline');
    zones = deployToZone(zones, to, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { zones, resourceBank: bank(1) }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, {
      type: 'transfer_equipment', equipmentInstanceId: equip.instanceId, targetInstanceId: to.instanceId,
    });
    const fl = result.state.players[0]!.zones.frontline;
    expect(fl.find(c => c?.instanceId === from.instanceId)!.equipment).toBeNull();
    expect(fl.find(c => c?.instanceId === to.instanceId)!.equipment!.instanceId).toBe(equip.instanceId);
    expect(result.state.players[0]!.resourceBank.every(r => r.exhausted)).toBe(true);
  });

  it('transfer is blocked a second time in the same turn', () => {
    const equip = mockCard({ cardType: 'E', owner: 0, cost: { mana: 0, energy: 0, flexible: 0 }, transferredThisTurn: true });
    const from = mockCard({ cardType: 'C', owner: 0, equipment: equip });
    const to = mockCard({ cardType: 'C', owner: 0 });
    let zones = deployToZone(emptyZones(), from, 'frontline');
    zones = deployToZone(zones, to, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, {
      type: 'transfer_equipment', equipmentInstanceId: equip.instanceId, targetInstanceId: to.instanceId,
    });
    const fl = result.state.players[0]!.zones.frontline;
    expect(fl.find(c => c?.instanceId === from.instanceId)!.equipment!.instanceId).toBe(equip.instanceId);
    expect(fl.find(c => c?.instanceId === to.instanceId)!.equipment).toBeNull();
  });

  it('transfer rejects an ineligible destination', () => {
    const equip = mockCard({ cardType: 'E', owner: 0, cost: { mana: 0, energy: 0, flexible: 0 }, equipRequirement: { tag: 'Beast' } });
    const from = mockCard({ cardType: 'C', owner: 0, tags: ['Beast'], equipment: equip });
    const to = mockCard({ cardType: 'C', owner: 0, tags: [] });
    let zones = deployToZone(emptyZones(), from, 'frontline');
    zones = deployToZone(zones, to, 'frontline');
    const state = mockGameState({
      phase: 'strategy',
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const result = executePlayerAction(state, {
      type: 'transfer_equipment', equipmentInstanceId: equip.instanceId, targetInstanceId: to.instanceId,
    });
    expect(result.state.players[0]!.zones.frontline.find(c => c?.instanceId === to.instanceId)!.equipment).toBeNull();
  });
});

describe('Wave 8 — equipment follows destroyed holder to discard (Rulebook 13)', () => {
  beforeEach(resetInstanceCounter);

  it('effect destroy: equipment lands in discard as its own entry', () => {
    const equip = mockCard({ cardType: 'E', owner: 0, name: 'Sword' });
    const holder = mockCard({ cardType: 'C', owner: 0, equipment: equip, currentHp: 3 });
    const zones = deployToZone(emptyZones(), holder, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const effect: Effect = { type: 'destroy', target: { type: 'self' } };
    const result = executeEffect(state, effect, ctx(holder.instanceId, 0));
    const discard = result.newState.players[0]!.discardPile;
    expect(discard.some(c => c.instanceId === equip.instanceId)).toBe(true);
    expect(discard.some(c => c.instanceId === holder.instanceId)).toBe(true);
    expect(result.events.some(
      e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === equip.instanceId,
    )).toBe(true);
  });

  it('combat: a destroyed equipped defender sends its equipment to discard', () => {
    const equip = mockCard({ cardType: 'E', owner: 1, name: 'Sword' });
    const attacker = mockCard({ owner: 0, currentAtk: 5, currentHp: 5 });
    const defender = mockCard({ owner: 1, currentAtk: 0, currentHp: 2, equipment: equip });
    let p0 = deployToZone(emptyZones(), attacker, 'frontline');
    let p1 = deployToZone(emptyZones(), defender, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
    });
    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);
    const discard = result.newState.players[1]!.discardPile;
    expect(discard.some(c => c.instanceId === equip.instanceId)).toBe(true);
    expect(discard.some(c => c.instanceId === defender.instanceId)).toBe(true);
    expect(result.events.some(
      e => e.type === 'CARD_DESTROYED' && e.cardInstanceId === equip.instanceId,
    )).toBe(true);
  });

  it('combat: a Volatile holder is exiled but its equipment still discards', () => {
    const equip = mockCard({ cardType: 'E', owner: 1 });
    const attacker = mockCard({ owner: 0, currentAtk: 5, currentHp: 5 });
    const defender = mockCard({ owner: 1, currentAtk: 0, currentHp: 2, traits: ['volatile'], equipment: equip });
    let p0 = deployToZone(emptyZones(), attacker, 'frontline');
    let p1 = deployToZone(emptyZones(), defender, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
    });
    const result = resolveCombat(state, attacker.instanceId, defender.instanceId);
    const discard = result.newState.players[1]!.discardPile;
    // Holder exiled (not in discard); equipment still follows to discard.
    expect(discard.some(c => c.instanceId === defender.instanceId)).toBe(false);
    expect(discard.map(c => c.instanceId)).toEqual([equip.instanceId]);
  });
});

describe('Wave 8 — grant_trait honors non-permanent durations (Rulebook 16)', () => {
  beforeEach(resetInstanceCounter);

  it('records until_end_of_turn duration and expires it at the boundary', () => {
    const target = mockCard({ owner: 0 });
    const zones = deployToZone(emptyZones(), target, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const effect: Effect = {
      type: 'grant_trait',
      trait: 'haste',
      target: { type: 'self' },
      duration: { type: 'until_end_of_turn' },
    };
    const granted = executeEffect(state, effect, ctx(target.instanceId, 0));
    const tagged = granted.newState.players[0]!.zones.frontline[0]!;
    expect(tagged.grantedTraits).toHaveLength(1);
    expect(tagged.grantedTraits[0]!.duration.type).toBe('until_end_of_turn');

    const expired = expireModifiers(granted.newState, 0, 'until_end_of_turn');
    expect(expired.players[0]!.zones.frontline[0]!.grantedTraits).toHaveLength(0);
  });

  it('for_combat collapses to until_end_of_turn (nearest expiring boundary)', () => {
    const target = mockCard({ owner: 0 });
    const zones = deployToZone(emptyZones(), target, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const effect: Effect = {
      type: 'grant_trait',
      trait: 'flying',
      target: { type: 'self' },
      duration: { type: 'for_combat' },
    };
    const granted = executeEffect(state, effect, ctx(target.instanceId, 0));
    expect(granted.newState.players[0]!.zones.frontline[0]!.grantedTraits[0]!.duration.type)
      .toBe('until_end_of_turn');
  });

  it('permanent grant survives the expiry boundary', () => {
    const target = mockCard({ owner: 0 });
    const zones = deployToZone(emptyZones(), target, 'frontline');
    const state = mockGameState({
      players: [mockPlayerState(0, { zones }), mockPlayerState(1)],
    });
    const effect: Effect = {
      type: 'grant_trait',
      trait: 'defender',
      target: { type: 'self' },
      duration: { type: 'permanent' },
    };
    const granted = executeEffect(state, effect, ctx(target.instanceId, 0));
    const expired = expireModifiers(granted.newState, 0, 'until_end_of_turn');
    expect(expired.players[0]!.zones.frontline[0]!.grantedTraits).toHaveLength(1);
  });
});

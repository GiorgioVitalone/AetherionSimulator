/**
 * WS-D — End-to-end integration coverage for the five keywords that NO real card
 * currently carries: Volatile, Sniper, Elite, Rush, Swift. Their behavior was only
 * ever exercised by hand-written lowercase fixtures, which once masked the
 * trait-casing bug (authored DB labels are Title-Case, every gate compares
 * lowercase).
 *
 * These tests feed REAL authored-style Title-Case trait labels through the real
 * hydration path (`createGame` → normalizeTraits) and then drive each keyword
 * through the engine end-to-end (deploy / move / combat as appropriate) using the
 * hydrated instance — never a synthetic lowercase fixture.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createGame,
  resetSetupInstanceCounter,
} from '../../src/setup/game-setup.js';
import type {
  CardDefinition,
  HeroDefinition,
  CardDefinitionRegistry,
} from '../../src/setup/game-setup.js';
import type {
  CardInstance,
  GameState,
  ResourceCard,
} from '../../src/types/game-state.js';
import type { ResourceCost } from '../../src/types/common.js';
import { executePlayerAction } from '../../src/state-machine/actions.js';
import { resolveCombat } from '../../src/combat/combat-resolver.js';
import { getValidAttackTargets } from '../../src/zones/targeting.js';
import { deployToZone } from '../../src/zones/zone-manager.js';
import {
  mockGameState,
  mockPlayerState,
  emptyZones,
} from '../helpers/card-factory.js';

const RESOURCE_IDS = Array.from({ length: 15 }, (_, i) => i + 101);

function traitCard(
  id: number,
  traits: readonly string[],
  cost: ResourceCost = { mana: 0, energy: 0, flexible: 0 },
): CardDefinition {
  return {
    id,
    name: `Trait Card ${String(id)}`,
    cardType: 'C',
    cost,
    stats: { hp: 4, atk: 3, arm: 0 },
    traits,
    tags: [],
    alignment: ['Radiant'],
  };
}

function hero(id: number): HeroDefinition {
  return { id, name: `Hero ${String(id)}`, lp: 25, alignment: ['Radiant'] };
}

function registryFor(defs: readonly CardDefinition[]): CardDefinitionRegistry {
  const cards = new Map<number, CardDefinition>();
  for (const d of defs) cards.set(d.id, d);
  for (const rid of RESOURCE_IDS) {
    cards.set(rid, {
      id: rid,
      name: `Mana Crystal ${String(rid)}`,
      cardType: 'R',
      cost: { mana: 0, energy: 0, flexible: 0 },
    });
  }
  const heroes = new Map([
    [200, hero(200)],
    [201, hero(201)],
  ]);
  return { getCard: id => cards.get(id), getHero: id => heroes.get(id) };
}

/**
 * Hydrate a real game from Title-Case authored defs and return the single
 * non-resource instance for the given def id. This is the production casing path:
 * createGame → normalizeTraits → lowercase snake_case traits on the instance.
 */
function hydrateMany(defs: readonly CardDefinition[]): readonly CardInstance[] {
  resetSetupInstanceCounter();
  const ids = defs.map(d => d.id);
  const state = createGame(
    { heroDefId: 200, mainDeckDefIds: ids, resourceDeckDefIds: RESOURCE_IDS },
    { heroDefId: 201, mainDeckDefIds: ids, resourceDeckDefIds: RESOURCE_IDS },
    registryFor(defs),
    7,
  );
  const p = state.players[0]!;
  return [...p.hand, ...p.mainDeck];
}

function pick(cards: readonly CardInstance[], defId: number): CardInstance {
  const c = cards.find(x => x.cardDefId === defId);
  if (c === undefined) throw new Error(`card ${String(defId)} not hydrated`);
  return c;
}

function hydrateOne(def: CardDefinition): CardInstance {
  return pick(hydrateMany([def]), def.id);
}

function manaBank(n: number): ResourceCard[] {
  return Array.from({ length: n }, (_, i) => ({
    instanceId: `res_${String(i)}`,
    resourceType: 'mana' as const,
    exhausted: false,
  }));
}

function unexhaustedCount(bank: readonly ResourceCard[]): number {
  return bank.filter(r => !r.exhausted).length;
}

/** Drive a deploy of `card` from the active player's hand through the engine. */
function deployFromHand(
  card: CardInstance,
  zone: 'reserve' | 'frontline' | 'high_ground',
  bank: ResourceCard[],
): { readonly state: GameState; readonly deployed: CardInstance | undefined } {
  const state = mockGameState({
    players: [
      mockPlayerState(0, { hand: [card], resourceBank: bank }),
      mockPlayerState(1),
    ],
  });
  const result = executePlayerAction(state, {
    type: 'deploy',
    cardInstanceId: card.instanceId,
    zone,
    slotIndex: 0,
  });
  return { state: result.state, deployed: inZone(result.state, card.instanceId, zone) };
}

function inZone(
  state: GameState,
  instanceId: string,
  zone: 'reserve' | 'frontline' | 'high_ground',
): CardInstance | undefined {
  const zones = state.players[0]!.zones;
  const arr =
    zone === 'reserve' ? zones.reserve : zone === 'frontline' ? zones.frontline : zones.highGround;
  return arr.find(c => c?.instanceId === instanceId) ?? undefined;
}

describe('WS-D — zero-real-card keyword integration (authored Title-Case → engine)', () => {
  beforeEach(() => {
    resetSetupInstanceCounter();
  });

  describe('Volatile (authored "Volatile")', () => {
    it('hydrates to the lowercase trait and is exiled (not discarded) when destroyed in combat', () => {
      const hydrated = hydrateMany([traitCard(1, ['Volatile']), traitCard(2, [])]);
      const volatile = pick(hydrated, 1);
      const attacker = pick(hydrated, 2);
      expect(volatile.traits).toContain('volatile');
      // Place: a strong attacker for p0, the hydrated Volatile defender for p1.
      const strongAttacker: CardInstance = { ...attacker, owner: 0, currentAtk: 9, currentHp: 9 };
      const weakVolatile: CardInstance = { ...volatile, owner: 1, currentHp: 2, currentAtk: 0 };
      let p0 = emptyZones();
      p0 = deployToZone(p0, strongAttacker, 'frontline');
      let p1 = emptyZones();
      p1 = deployToZone(p1, weakVolatile, 'frontline');
      const state = mockGameState({
        players: [mockPlayerState(0, { zones: p0 }), mockPlayerState(1, { zones: p1 })],
      });

      const result = resolveCombat(state, strongAttacker.instanceId, weakVolatile.instanceId);

      expect(result.events.some(e => e.type === 'CARD_DESTROYED')).toBe(true);
      expect(
        result.events.some(
          e => e.type === 'CARD_EXILED' && e.cardInstanceId === weakVolatile.instanceId,
        ),
      ).toBe(true);
      // Removed from the game — never reaches the discard pile.
      expect(result.newState.players[1]!.discardPile).toHaveLength(0);
    });
  });

  describe('Sniper (authored "Sniper")', () => {
    it('hydrates so a Reserve attacker can target the enemy Frontline end-to-end', () => {
      const hydrated = hydrateMany([traitCard(1, ['Sniper']), traitCard(2, [])]);
      const sniper = pick(hydrated, 1);
      const enemy = pick(hydrated, 2);
      expect(sniper.traits).toContain('sniper');
      const enemyZones = (() => {
        let z = emptyZones();
        z = deployToZone(z, { ...enemy, owner: 1 }, 'frontline');
        return z;
      })();

      // From Reserve, only Sniper grants targets.
      const sniperTargets = getValidAttackTargets('reserve', sniper.traits, enemyZones);
      expect(sniperTargets.map(t => t.instanceId)).toContain(enemy.instanceId);

      const plainTargets = getValidAttackTargets('reserve', [], enemyZones);
      expect(plainTargets).toEqual([]);
    });
  });

  describe('Elite (authored "Elite")', () => {
    it('hydrates and a direct High-Ground deploy is charged the +2 surcharge end-to-end', () => {
      const elite = hydrateOne(traitCard(1, ['Elite'], { mana: 1, energy: 0, flexible: 0 }));
      expect(elite.traits).toContain('elite');

      // Base cost 1, +2 Elite High-Ground surcharge = 3 total.
      const bank = manaBank(5);
      const { deployed, state } = deployFromHand(elite, 'high_ground', bank);

      expect(deployed).toBeDefined();
      const spent = 5 - unexhaustedCount(state.players[0]!.resourceBank);
      expect(spent).toBe(3);
    });

    it('the same Elite deployed to Frontline pays only the base cost (no surcharge)', () => {
      const elite = hydrateOne(traitCard(1, ['Elite'], { mana: 1, energy: 0, flexible: 0 }));
      const bank = manaBank(5);
      const { deployed, state } = deployFromHand(elite, 'frontline', bank);

      expect(deployed).toBeDefined();
      const spent = 5 - unexhaustedCount(state.players[0]!.resourceBank);
      expect(spent).toBe(1);
    });

    it('cannot afford a High-Ground deploy with only the base cost available', () => {
      const elite = hydrateOne(traitCard(1, ['Elite'], { mana: 1, energy: 0, flexible: 0 }));
      // Only 1 mana: enough for base, but not base + 2 surcharge.
      const bank = manaBank(1);
      const { deployed } = deployFromHand(elite, 'high_ground', bank);
      expect(deployed).toBeUndefined();
    });
  });

  describe('Rush X (authored "Rush 2")', () => {
    it('hydrates rushValue, seeds 2 free deploy-turn moves, and a move spends one without exhausting', () => {
      const rusher = hydrateOne(traitCard(1, ['Rush 2']));
      expect(rusher.traits).toContain('rush');
      expect(rusher.rushValue).toBe(2);

      const { deployed, state } = deployFromHand(rusher, 'reserve', manaBank(2));
      expect(deployed?.freeMovesRemaining).toBe(2);

      // First move (reserve→frontline) spends one of the two free moves; the
      // character is still ready, with one free move left.
      const moved = executePlayerAction(state, {
        type: 'move',
        cardInstanceId: rusher.instanceId,
        toZone: 'frontline',
      });
      const afterMove = inZone(moved.state, rusher.instanceId, 'frontline');
      expect(afterMove?.freeMovesRemaining).toBe(1);
      expect(afterMove?.exhausted).toBe(false);
    });
  });

  describe('Swift (authored "Swift")', () => {
    it('hydrates, seeds 1 free move, and that move (reserve→frontline) does NOT exhaust it', () => {
      const swiftee = hydrateOne(traitCard(1, ['Swift']));
      expect(swiftee.traits).toContain('swift');

      const { deployed, state } = deployFromHand(swiftee, 'reserve', manaBank(2));
      expect(deployed?.freeMovesRemaining).toBe(1);

      // Drive the actual move action through the engine: the free move is spent,
      // the character stays ready (Swift, Rulebook 16).
      const moved = executePlayerAction(state, {
        type: 'move',
        cardInstanceId: swiftee.instanceId,
        toZone: 'frontline',
      });
      const afterMove = inZone(moved.state, swiftee.instanceId, 'frontline');
      expect(afterMove).toBeDefined();
      expect(afterMove?.freeMovesRemaining).toBe(0);
      expect(afterMove?.exhausted).toBe(false);
      expect(afterMove?.movedThisTurn).toBe(false);
    });

    it('combines with Rush: "Swift" + "Rush 2" seeds 3 free deploy-turn moves', () => {
      const both = hydrateOne(traitCard(1, ['Swift', 'Rush 2']));
      expect(both.traits).toEqual(expect.arrayContaining(['swift', 'rush']));
      expect(both.rushValue).toBe(2);

      const { deployed } = deployFromHand(both, 'reserve', manaBank(2));
      expect(deployed?.freeMovesRemaining).toBe(3);
    });
  });
});

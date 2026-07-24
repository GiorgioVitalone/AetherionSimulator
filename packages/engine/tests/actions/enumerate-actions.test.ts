/**
 * enumerateConcretePlayerActions — legality, completeness, uniqueness, stable
 * ordering, and legacy parity, checked against decision states sampled from
 * real games (two faction pairings, driven by full-mode random play).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createActor } from 'xstate';
import { createGame } from '../../src/setup/game-setup.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import {
  enumerateConcretePlayerActions,
  keyOfPlayerAction,
} from '../../src/actions/enumerate-actions.js';
import { chooseChoiceResponse } from '../../src/bot/heuristic.js';
import type { CardDefinitionRegistry, DeckSelection } from '../../src/setup/game-setup.js';
import type { GameState } from '../../src/types/game-state.js';
import type { AvailableActions } from '../../src/actions/available-actions.js';
import type { PlayerAction } from '../../src/state-machine/types.js';

// ── Tiny two-faction card registry ───────────────────────────────────────────
// 'Onyx' and 'Radiant' stand in for two faction pairings — the enumerator does
// not care about faction identity, only about exercising a variety of option
// shapes (deploy to all 3 zones, attack, cast, equip, move, activate, discard).

const CREATURES = [
  { id: 1, name: 'Grunt', hp: 2, atk: 2, cost: 1 },
  { id: 2, name: 'Soldier', hp: 3, atk: 3, cost: 1 },
  { id: 3, name: 'Knight', hp: 5, atk: 4, cost: 2 },
];
const EQUIP_ID = 10;
const SPELL_ID = 11;
const RES_ID = 99;
const HERO_ONYX = 100;
const HERO_RADIANT = 101;

function registryFor(alignment: string): CardDefinitionRegistry {
  return {
    getCard: (id) => {
      if (id === EQUIP_ID) {
        return {
          id,
          name: 'Blade',
          cardType: 'E',
          cost: { mana: 1, energy: 0, flexible: 0 },
          alignment: [alignment],
        };
      }
      if (id === SPELL_ID) {
        return {
          id,
          name: 'Zap',
          cardType: 'S',
          cost: { mana: 1, energy: 0, flexible: 0 },
          alignment: [alignment],
        };
      }
      if (id === RES_ID) {
        return { id, name: 'Mana', cardType: 'R', cost: { mana: 0, energy: 0, flexible: 0 } };
      }
      const c = CREATURES.find((x) => x.id === id);
      if (c === undefined) return undefined;
      return {
        id: c.id,
        name: c.name,
        cardType: 'C',
        cost: { mana: c.cost, energy: 0, flexible: 0 },
        stats: { hp: c.hp, atk: c.atk, arm: 0 },
        alignment: [alignment],
      };
    },
    getHero: (id) => ({ id, name: `Hero ${String(id)}`, lp: 24, alignment: [alignment] }),
  };
}

function deck(heroId: number): DeckSelection {
  const main: number[] = [];
  while (main.length < 44) {
    for (const c of CREATURES) main.push(c.id);
    main.push(EQUIP_ID, SPELL_ID);
  }
  return {
    heroDefId: heroId,
    mainDeckDefIds: main.slice(0, 44),
    resourceDeckDefIds: Array.from({ length: 15 }, () => RES_ID),
  };
}

// ── Seeded RNG (mulberry32, matches the project's other test drivers) ────────

function rngf(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Sampler: step real games with full-mode random play, collecting the
// pre-action GameState at every strategy/action-phase decision point ─────────

function samplePairing(pairSeed: number, gamesPerPairing: number, samples: GameState[]): void {
  const rnd = rngf(pairSeed);
  for (let g = 0; g < gamesPerPairing; g++) {
    const seed = pairSeed + g;
    let gs = createGame(deck(HERO_ONYX), deck(HERO_RADIANT), registryFor('Onyx'), seed);
    gs = { ...gs, config: { directHighGroundDeploy: true, reserveTapChoice: true } };
    const actor = createActor(gameMachine, { input: { gameState: gs } });
    actor.start();

    for (let step = 0; step < 4000; step++) {
      const snap = actor.getSnapshot();
      if (snap.status === 'done') break;
      gs = snap.context.gameState;
      if (gs.winner !== null) break;
      if (gs.turnNumber > 40) break;

      const pc = gs.pendingChoice;
      if (pc !== null) {
        if (pc.type === 'mulligan') {
          actor.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep: true });
        } else {
          const ids = chooseChoiceResponse(gs);
          actor.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
        }
        continue;
      }
      if (gs.pendingPriority != null) {
        actor.send({ type: 'PRIORITY_PASS' });
        continue;
      }

      const candidates = enumerateConcretePlayerActions(gs, 'full');
      if (gs.phase === 'strategy' || gs.phase === 'action') {
        samples.push(gs);
      }

      if (candidates.length === 0) {
        actor.send({ type: 'END_PHASE' });
        continue;
      }
      // Bias toward discard_for_energy so at least one sampled state gets to
      // exercise it (uniform random draws it rarely given how many other
      // candidates usually exist in the same decision).
      const pitchers = candidates.filter((c) => c.type === 'discard_for_energy');
      const pool = pitchers.length > 0 && rnd() < 0.4 ? pitchers : candidates;
      const action = pool[Math.floor(rnd() * pool.length)]!;
      actor.send({ type: 'PLAYER_ACTION', action });
    }
  }
}

let samples: GameState[] = [];

beforeAll(() => {
  const collected: GameState[] = [];
  samplePairing(9001, 15, collected); // pairing 1: Onyx vs Radiant
  samplePairing(9101, 15, collected); // pairing 2: different seed stream / same faction shapes, second pairing
  samples = collected;
});

// ── Legality cross-check ──────────────────────────────────────────────────────

function isLegal(a: PlayerAction, acts: AvailableActions): boolean {
  switch (a.type) {
    case 'deploy': {
      const opt = acts.canDeploy.find((d) => d.cardInstanceId === a.cardInstanceId);
      return (
        opt !== undefined &&
        opt.validSlots.some((g) => g.zone === a.zone && g.slots.includes(a.slotIndex))
      );
    }
    case 'declare_attack': {
      const opt = acts.canAttack.find((x) => x.attackerInstanceId === a.attackerInstanceId);
      if (opt === undefined) return false;
      return opt.validTargets.some(
        (t) => (t.type === 'hero' ? 'hero' : t.instanceId) === a.targetId,
      );
    }
    case 'cast_spell':
      return acts.canCastSpell.some((c) => c.cardInstanceId === a.cardInstanceId);
    case 'attach_equipment': {
      const opt = acts.canAttachEquipment.find((e) => e.cardInstanceId === a.cardInstanceId);
      return opt !== undefined && opt.validTargets.includes(a.targetInstanceId);
    }
    case 'move': {
      const opt = acts.canMove.find((m) => m.cardInstanceId === a.cardInstanceId);
      return opt !== undefined && opt.validDestinations.includes(a.toZone);
    }
    case 'activate_ability':
      return acts.canActivateAbility.some(
        (x) => x.cardInstanceId === a.cardInstanceId && x.abilityIndex === a.abilityIndex,
      );
    case 'discard_for_energy':
      // AvailableActions.canDiscardForEnergy is a boolean gate (any hand card is a
      // legal pitch) — see enumerate-actions.ts coverage spec.
      return acts.canDiscardForEnergy;
    case 'tap_reserve':
      return acts.canTapReserve.includes(a.cardInstanceId);
    case 'declare_transform':
      return acts.canTransform;
    case 'remove_equipment':
    case 'transfer_equipment':
      return false; // never produced — no legality surface (documented gap)
  }
}

describe('enumerateConcretePlayerActions', () => {
  it('sampled at least 100 decision states across the two pairings', () => {
    expect(samples.length).toBeGreaterThanOrEqual(100);
  });

  it('legality: every enumerated action is present in computeAvailableActions (full mode)', () => {
    for (const state of samples) {
      const acts = computeAvailableActions(state);
      for (const a of enumerateConcretePlayerActions(state, 'full')) {
        expect(isLegal(a, acts)).toBe(true);
      }
    }
  });

  it('legality: every enumerated action is present in computeAvailableActions (legacy mode)', () => {
    for (const state of samples) {
      const acts = computeAvailableActions(state);
      for (const a of enumerateConcretePlayerActions(state, 'legacy')) {
        expect(isLegal(a, acts)).toBe(true);
      }
    }
  });

  it('completeness (full): counts match the option surface, per kind', () => {
    for (const state of samples) {
      const acts = computeAvailableActions(state);
      const full = enumerateConcretePlayerActions(state, 'full');
      const countOf = (t: PlayerAction['type']): number => full.filter((a) => a.type === t).length;

      const expectedDeploy = acts.canDeploy.reduce(
        (sum, d) => sum + d.validSlots.reduce((s2, g) => s2 + g.slots.length, 0),
        0,
      );
      const expectedAttack = acts.canAttack.reduce((sum, a) => sum + a.validTargets.length, 0);
      const expectedEquip = acts.canAttachEquipment.reduce(
        (sum, e) => sum + e.validTargets.length,
        0,
      );
      const expectedMove = acts.canMove.reduce((sum, m) => sum + m.validDestinations.length, 0);
      const player = state.players[state.activePlayerIndex]!;
      const expectedDiscard = acts.canDiscardForEnergy ? player.hand.length : 0;

      expect(countOf('deploy')).toBe(expectedDeploy);
      expect(countOf('declare_attack')).toBe(expectedAttack);
      expect(countOf('attach_equipment')).toBe(expectedEquip);
      expect(countOf('move')).toBe(expectedMove);
      expect(countOf('cast_spell')).toBe(acts.canCastSpell.length);
      expect(countOf('activate_ability')).toBe(acts.canActivateAbility.length);
      expect(countOf('tap_reserve')).toBe(acts.canTapReserve.length);
      expect(countOf('discard_for_energy')).toBe(expectedDiscard);
      expect(countOf('declare_transform')).toBe(acts.canTransform ? 1 : 0);
    }
  });

  it('uniqueness: no duplicate keyOfPlayerAction within a result', () => {
    for (const state of samples) {
      for (const mode of ['legacy', 'full'] as const) {
        const actions = enumerateConcretePlayerActions(state, mode);
        const keys = actions.map((a) => `${a.type}:${keyOfPlayerAction(a)}`);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it('stable order: two invocations are identical, incl. across a JSON round trip', () => {
    for (const state of samples.slice(0, 30)) {
      for (const mode of ['legacy', 'full'] as const) {
        const first = enumerateConcretePlayerActions(state, mode);
        const second = enumerateConcretePlayerActions(state, mode);
        expect(second).toEqual(first);
        expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)));
      }
    }
  });

  it('at least one sampled state exercises discard_for_energy in full mode', () => {
    const hit = samples.some((state) =>
      enumerateConcretePlayerActions(state, 'full').some((a) => a.type === 'discard_for_energy'),
    );
    expect(hit).toBe(true);
  });

  // ── Legacy parity ───────────────────────────────────────────────────────────
  // `concreteActions` in pilot-rollout.mjs (lines 97-108) is not exported (plain
  // ESM, no `export` keyword) — vendored verbatim below rather than imported, per
  // the task brief. Kept honest by (a) copying the exact per-option selection
  // logic and (b) reusing the REAL exported `keyOfPlayerAction` — not a
  // reimplementation — for the tie-break sort, so only the vendored selection
  // logic is untested-by-import; the ordering comparator is shared code.

  function vendoredLegacyConcreteActions(acts: AvailableActions): PlayerAction[] {
    const out: PlayerAction[] = [];
    for (const d of acts.canDeploy) {
      const s = d.validSlots.find((x) => x.zone === 'frontline') ?? d.validSlots[0];
      if (s !== undefined && s.slots.length > 0) {
        out.push({
          type: 'deploy',
          cardInstanceId: d.cardInstanceId,
          zone: s.zone,
          slotIndex: s.slots[0]!,
        });
      }
    }
    for (const a of acts.canAttack) {
      const t = a.validTargets;
      const tg = t.length > 0 ? t[0]! : undefined;
      const targetId =
        tg === undefined ? 'hero' : tg.type === 'hero' ? 'hero' : (tg.instanceId ?? 'hero');
      out.push({ type: 'declare_attack', attackerInstanceId: a.attackerInstanceId, targetId });
    }
    for (const c of acts.canCastSpell)
      out.push({ type: 'cast_spell', cardInstanceId: c.cardInstanceId });
    for (const a of acts.canActivateAbility) {
      out.push({
        type: 'activate_ability',
        cardInstanceId: a.cardInstanceId,
        abilityIndex: a.abilityIndex,
      });
    }
    for (const e of acts.canAttachEquipment) {
      const t = e.validTargets[0];
      if (t !== undefined)
        out.push({
          type: 'attach_equipment',
          cardInstanceId: e.cardInstanceId,
          targetInstanceId: t,
        });
    }
    for (const m of acts.canMove) {
      const dest = m.validDestinations[0];
      if (dest !== undefined)
        out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: dest });
    }
    for (const id of acts.canTapReserve) out.push({ type: 'tap_reserve', cardInstanceId: id });
    if (acts.canTransform) out.push({ type: 'declare_transform' });
    return out;
  }

  // Same KIND_ORDER as pilot-rollout.mjs (~415), extended for the kinds it never
  // saw — duplicated here (not imported, since it's not exported) but the actual
  // tie-break (`keyOfPlayerAction`) IS the production/exported function.
  const KIND_ORDER: Record<PlayerAction['type'], number> = {
    declare_attack: 0,
    cast_spell: 1,
    deploy: 2,
    move: 3,
    activate_ability: 4,
    attach_equipment: 5,
    declare_transform: 6,
    discard_for_energy: 7,
    tap_reserve: 8,
    remove_equipment: 9,
    transfer_equipment: 10,
  };

  function sortLikeProduction(actions: readonly PlayerAction[]): PlayerAction[] {
    return [...actions].sort((a, b) => {
      const ka = KIND_ORDER[a.type];
      const kb = KIND_ORDER[b.type];
      if (ka !== kb) return ka - kb;
      return keyOfPlayerAction(a).localeCompare(keyOfPlayerAction(b));
    });
  }

  it("legacy mode deep-equals the vendored pilot-rollout.mjs concretizer's output", () => {
    for (const state of samples) {
      const acts = computeAvailableActions(state);
      const expected = sortLikeProduction(vendoredLegacyConcreteActions(acts));
      expect(enumerateConcretePlayerActions(state, 'legacy')).toEqual(expected);
    }
  });
});

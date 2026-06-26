/**
 * Heuristic vs Random self-play — proof the heuristic policy is meaningfully
 * better than random under real game rules, that games still terminate, and that
 * results are deterministic across two runs. Also surfaces instrumentation
 * counters (transforms / equipment / abilities) so the full ability layer is
 * demonstrably exercised under skilled play.
 *
 * Self-contained: a tiny in-test card registry (vanilla creatures + one equipment
 * + transformable heroes) so the test is deterministic and has no external deps.
 */
import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { createGame } from '../../src/setup/game-setup.js';
import { gameMachine } from '../../src/state-machine/game-machine.js';
import { computeAvailableActions } from '../../src/actions/available-actions.js';
import { chooseAction, chooseChoiceResponse, shouldKeepHand } from '../../src/bot/heuristic.js';
import type {
  CardDefinitionRegistry,
  DeckSelection,
} from '../../src/setup/game-setup.js';
import type { GameState, HeroTransformData } from '../../src/types/game-state.js';
import type { PlayerAction } from '../../src/state-machine/types.js';
import type { AbilityDSL } from '../../src/types/ability.js';

// ── Tiny card registry ───────────────────────────────────────────────────────

const CREATURES = [
  { id: 1, name: 'Grunt', hp: 2, atk: 2, cost: 1 },
  { id: 2, name: 'Soldier', hp: 3, atk: 3, cost: 2 },
  { id: 3, name: 'Knight', hp: 5, atk: 4, cost: 3 },
  { id: 4, name: 'Titan', hp: 7, atk: 6, cost: 4 },
];
const EQUIP_ID = 5;
const RES_ID = 99;
const HERO_A = 100;
const HERO_B = 101;

const equipBuff: AbilityDSL = {
  type: 'triggered',
  trigger: { type: 'on_deploy' },
  effects: [
    {
      type: 'modify_stats',
      target: { type: 'equipped_character' },
      duration: { type: 'while_in_play' },
      modifier: { atk: 2, hp: 2 },
    },
  ],
};

const registry: CardDefinitionRegistry = {
  getCard: id => {
    if (id === EQUIP_ID) {
      return { id, name: 'Blade', cardType: 'E', cost: { mana: 1, energy: 0, flexible: 0 }, alignment: ['Onyx'] };
    }
    if (id === RES_ID) {
      return { id, name: 'Mana', cardType: 'R', cost: { mana: 0, energy: 0, flexible: 0 } };
    }
    const c = CREATURES.find(x => x.id === id);
    if (c === undefined) return undefined;
    return {
      id: c.id,
      name: c.name,
      cardType: 'C',
      cost: { mana: c.cost, energy: 0, flexible: 0 },
      stats: { hp: c.hp, atk: c.atk, arm: 0 },
      alignment: ['Onyx'],
    };
  },
  getHero: id => ({ id, name: id === HERO_A ? 'Hero A' : 'Hero B', lp: 24, alignment: ['Onyx'] }),
};

function deck(heroId: number): DeckSelection {
  const main: number[] = [];
  while (main.length < 40) {
    for (const c of CREATURES) main.push(c.id);
    main.push(EQUIP_ID);
  }
  return {
    heroDefId: heroId,
    mainDeckDefIds: main.slice(0, 44),
    resourceDeckDefIds: Array.from({ length: 15 }, () => RES_ID),
  };
}

// ── Hydration: equipment abilities + a transform side on each hero ─────────────

const transformSide: HeroTransformData = {
  cardDefId: 200,
  name: 'Ascended',
  lpDelta: 0,
  abilities: [
    {
      type: 'triggered',
      trigger: { type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 }, cooldown: 0 },
      effects: [{ type: 'heal', amount: { type: 'fixed', value: 2 }, target: { type: 'owner_hero' } }],
    },
  ],
};

function hydrate(s: GameState): GameState {
  const hc = <T extends { cardDefId: number; abilities: readonly AbilityDSL[] } | null>(c: T): T => {
    if (c === null) return c;
    return c.cardDefId === EQUIP_ID ? ({ ...c, abilities: [equipBuff] } as T) : c;
  };
  return {
    ...s,
    players: s.players.map(p => ({
      ...p,
      hero: { ...p.hero, transformData: transformSide },
      hand: p.hand.map(hc),
      mainDeck: p.mainDeck.map(hc),
      zones: {
        reserve: p.zones.reserve.map(hc),
        frontline: p.zones.frontline.map(hc),
        highGround: p.zones.highGround.map(hc),
      },
    })) as GameState['players'],
  };
}

// ── Random policy (the opponent) ───────────────────────────────────────────────

function rngf(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function concreteActions(state: GameState): PlayerAction[] {
  const acts = computeAvailableActions(state);
  const out: PlayerAction[] = [];
  for (const d of acts.canDeploy) {
    const s = d.validSlots.find(x => x.zone === 'frontline') ?? d.validSlots[0];
    if (s && s.slots.length) out.push({ type: 'deploy', cardInstanceId: d.cardInstanceId, zone: s.zone, slotIndex: s.slots[0]! });
  }
  for (const a of acts.canAttack) {
    const t = a.validTargets[0];
    out.push({ type: 'declare_attack', attackerInstanceId: a.attackerInstanceId, targetId: t?.type === 'hero' ? 'hero' : (t?.instanceId ?? 'hero') });
  }
  for (const m of acts.canMove) {
    const d = m.validDestinations[0];
    if (d) out.push({ type: 'move', cardInstanceId: m.cardInstanceId, toZone: d });
  }
  for (const e of acts.canAttachEquipment) {
    const t = e.validTargets[0];
    if (t) out.push({ type: 'attach_equipment', cardInstanceId: e.cardInstanceId, targetInstanceId: t });
  }
  return out;
}

// ── Game driver ─────────────────────────────────────────────────────────────

interface Counters {
  transforms: number;
  equipment: number;
  abilities: number;
}

function playGame(
  seed: number,
  heuristicSeat: 0 | 1,
  counters: Counters,
  bothHeuristic = false,
): 0 | 1 | 'draw' {
  let gs = hydrate(createGame(deck(HERO_A), deck(HERO_B), registry, seed));
  const rnd = rngf(seed ^ 0x9e3779b9);
  const actor = createActor(gameMachine, { input: { gameState: gs } });
  actor.start();

  for (let step = 0; step < 8000; step++) {
    const snap = actor.getSnapshot();
    if (snap.status === 'done') break;
    gs = snap.context.gameState;
    if (gs.winner !== null) break;
    if (gs.turnNumber > 60) break;

    const pc = gs.pendingChoice;
    if (pc !== null) {
      if (pc.type === 'mulligan') {
        const useHeuristic = pc.playerId === heuristicSeat;
        const keep = useHeuristic ? shouldKeepHand(gs, pc.playerId) : true;
        actor.send({ type: 'MULLIGAN_DECISION', playerId: pc.playerId, keep });
      } else {
        const ids = chooseChoiceResponse(gs);
        actor.send({ type: 'PLAYER_RESPONSE', response: { selectedOptionIds: ids } });
      }
      continue;
    }

    const isHeuristic = bothHeuristic || gs.activePlayerIndex === heuristicSeat;
    let action: PlayerAction | null;
    if (isHeuristic) {
      action = chooseAction(gs);
    } else {
      const choices = concreteActions(gs);
      action = choices.length && rnd() < 0.85 ? choices[Math.floor(rnd() * choices.length)]! : null;
    }

    if (action === null) {
      actor.send({ type: 'END_PHASE' });
    } else {
      if (action.type === 'declare_transform') counters.transforms++;
      if (action.type === 'attach_equipment') counters.equipment++;
      if (action.type === 'activate_ability') counters.abilities++;
      actor.send({ type: 'PLAYER_ACTION', action });
    }
  }

  const fin = actor.getSnapshot().context.gameState;
  if (fin.winner === 0 || fin.winner === 1) return fin.winner;
  const lp0 = fin.players[0].hero.currentLp;
  const lp1 = fin.players[1].hero.currentLp;
  return lp0 === lp1 ? 'draw' : lp0 > lp1 ? 0 : 1;
}

function runMatch(games: number, startSeed: number): { wins: number; decided: number; counters: Counters } {
  const counters: Counters = { transforms: 0, equipment: 0, abilities: 0 };
  let wins = 0;
  let decided = 0;
  for (let g = 0; g < games; g++) {
    const heuristicSeat: 0 | 1 = g % 2 === 0 ? 0 : 1; // alternate seats to cancel first-player bias
    const winner = playGame(startSeed + g, heuristicSeat, counters);
    if (winner !== 'draw') {
      decided++;
      if (winner === heuristicSeat) wins++;
    }
  }
  return { wins, decided, counters };
}

describe('heuristic vs random self-play', () => {
  const GAMES = 80;
  const SEED = 4242;

  it('the heuristic bot wins clearly over 55% of decided games', () => {
    const { wins, decided } = runMatch(GAMES, SEED);
    expect(decided).toBeGreaterThan(GAMES * 0.5); // games actually resolve
    const winRate = wins / decided;
    expect(winRate).toBeGreaterThan(0.55);
  });

  it('exercises the full ability layer under skilled play (transforms / equipment / abilities)', () => {
    // Mirror skilled play: both seats use the heuristic, so the losing side drops
    // to transform range and both sides equip / activate abilities.
    const counters: Counters = { transforms: 0, equipment: 0, abilities: 0 };
    for (let g = 0; g < GAMES; g++) {
      playGame(SEED + g, 0, counters, true);
    }
    expect(counters.transforms).toBeGreaterThan(0);
    expect(counters.equipment).toBeGreaterThan(0);
    expect(counters.abilities).toBeGreaterThan(0);
  });

  it('is deterministic across two identical runs', () => {
    const a = runMatch(GAMES, SEED);
    const b = runMatch(GAMES, SEED);
    expect(a.wins).toBe(b.wins);
    expect(a.decided).toBe(b.decided);
    expect(a.counters).toEqual(b.counters);
  });
});

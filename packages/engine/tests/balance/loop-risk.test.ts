/**
 * §S4 — loop-risk veto graph regression tests. No simulations: pure DSL
 * analysis, anchored to the Arcane Echoes / Master Archivist catastrophe
 * (2026-07-13/14 investigation — see scratchpad/task-12-brief.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assessLoopRisk } from '../../src/balance/loop-graph.js';
import type { Effect } from '../../src/types/effects.js';
import type { StaticCard } from '../../src/balance/types.js';
import { normalizeTraits } from '../../src/setup/trait-normalizer.js';
import { aura, card, triggered, body } from './factory.js';
import { classifyCandidate } from '../../balance-gates.mjs';

const onCast = { type: 'on_cast' } as const;
const onDeploy = { type: 'on_deploy' } as const;

// ── Item 1: Arcane-Echoes-shaped self-copy ───────────────────────────────────

/** Mirrors the real Arcane Echoes (id94): on_cast copy_card, filter matches
 * ITSELF (tag Arcane, cardType S) — no excludeSelf in the real card either. */
function echoesShaped(cost: number): StaticCard {
  const selfCopy: Effect = {
    type: 'copy_card',
    source: 'discard',
    destination: 'hand',
    filter: { tag: 'Arcane', cardType: 'S' },
  };
  return card({
    id: 94,
    name: 'Echoes-shaped',
    cardType: 'S',
    tags: ['Arcane'],
    cost: { mana: cost, energy: 0, flexible: 0 },
    abilities: [triggered(onCast, [selfCopy])],
  });
}

describe('loop-risk — Arcane Echoes self-copy (item 1)', () => {
  it('is a self-loop: net cost = effective cost (5), no resource generation — not likely', () => {
    // Arithmetic: distinct members = {94}, costSum = effectiveCost(5) = 5,
    // gainSum = 0 (no gain_resource effect) -> net = 5. net > 2 and cost > 1,
    // so neither the net<=2 'possible' rule nor the cost<=1 self-loop 'likely'
    // override fires -> 'none'. 'none' satisfies "possible at most".
    const risk = assessLoopRisk([echoesShaped(5)]);
    expect(risk.get(94)).toBe('none');
  });

  it('is likely at cost 1 — direct unthrottled self-copy at cost <=1', () => {
    // Arithmetic: a genuine self-loop (the card's own copy_card filter matches
    // itself) with effective cost <=1 is classified 'likely' regardless of the
    // net-cost sum — bounded only by discard/deck supply at that price, the
    // exact failed-patch shape (Echoes cut 5->1).
    const risk = assessLoopRisk([echoesShaped(1)]);
    expect(risk.get(94)).toBe('likely');
  });

  it('cost sensitivity: cost 3 (net=3, >2) is none; cost 2 (net=2, <=2) is possible', () => {
    expect(assessLoopRisk([echoesShaped(3)]).get(94)).toBe('none');
    expect(assessLoopRisk([echoesShaped(2)]).get(94)).toBe('possible');
  });
});

// ── Item 2: Master Archivist castFreeIfCost chain ────────────────────────────

/** Mirrors the real Master Archivist (id141): on_deploy search_deck, filter
 * {tag Arcane, cardType S}, castFreeIfCost:1. */
function archivistShaped(cost: number): StaticCard {
  const fetch: Effect = {
    type: 'search_deck',
    filter: { tag: 'Arcane', cardType: 'S' },
    destination: 'hand',
    castFreeIfCost: 1,
  };
  return card({
    id: 141,
    name: 'Archivist-shaped',
    cardType: 'C',
    stats: { atk: 2, hp: 5, arm: 0 },
    cost: { mana: cost, energy: 0, flexible: 0 },
    abilities: [triggered(onDeploy, [fetch])],
  });
}

/** A 1-cost Arcane spell that self-copies (Echoes-shaped at cost 1) — the
 * fetch target Archivist's search_deck can find and free-cast. */
const oneCostArcaneSpell = echoesShaped(1);

describe('loop-risk — Master Archivist castFreeIfCost chain (item 2)', () => {
  it("propagates the fetched self-copy loop's risk back to Archivist", () => {
    // Arithmetic: the 1-cost Arcane spell is its own self-loop at effective
    // cost 1 <=1 -> 'likely' (item-1 rule). Archivist's search_deck edge has
    // castFreeIfCost:1 and the target's effective cost (1) <= 1, so the free
    // cast covers it entirely: Archivist inherits the target's 'likely' via
    // backward feeder propagation (the exact real-world mechanism — deploying
    // Archivist drops the free-cast chain straight into the Echoes loop).
    const risk = assessLoopRisk([archivistShaped(6), oneCostArcaneSpell]);
    expect(risk.get(141)).toBe('likely');
    expect(risk.get(94)).toBe('likely');
  });

  it('does not propagate when the fetched target is well outside the free-cast threshold', () => {
    // Arithmetic: at live cost (5), the fetched spell's effective cost (5) is
    // neither <= the castFreeIfCost threshold (1) nor within 1 of it
    // (|5-1|=4) -> no propagation, no 'possible' bump either -> Archivist
    // stays 'none' (its own on_deploy is one-shot, not itself a cycle).
    const risk = assessLoopRisk([archivistShaped(6), echoesShaped(5)]);
    expect(risk.get(141)).toBe('none');
  });
});

// ── §R2: cost-reducer recursion through wrapper effects ──────────────────────

describe('loop-risk — cost-reducer detection recurses through choose_one (R2)', () => {
  it('an aura cost_reduction nested under choose_one still lowers the effective cost of a self-loop', () => {
    // A reducer aura that only exposes its cost_reduction inside a choose_one
    // wrapper must still be picked up by collectCostReducers (via
    // flattenEffects) — same recursion gap as card-power.ts's hasCostReduction.
    const reducerAura = card({
      id: 300,
      name: 'Wrapped Reducer',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        aura([
          {
            type: 'choose_one',
            options: [
              {
                label: 'reduce',
                effects: [
                  {
                    type: 'cost_reduction',
                    reduction: 4,
                    appliesTo: { cardType: 'S' },
                    duration: { type: 'while_in_play' },
                  },
                ],
              },
              { label: 'noop', effects: [] },
            ],
          },
        ]),
      ],
    });
    // Echoes-shaped self-copy spell at cost 5: without the reducer it's 'none'
    // (net=5); the wrapped reducer knocks 4 off (effective cost 1) -> 'likely'
    // via the cost<=1 self-loop override — proving the reducer was actually seen.
    const risk = assessLoopRisk([echoesShaped(5), reducerAura]);
    expect(risk.get(94)).toBe('likely');
  });
});

// ── §P1 (R3 fix): cost-reducer detection is ability-KIND-independent ────────

describe('loop-risk — cost-reducer detection recurses through TRIGGERED abilities (P1, round-3 auditor probe)', () => {
  it('a cost-3 on_cast card that reduces spells by 3 AND copies itself is NOT risk "none"', () => {
    // collectCostReducers only scanned `aura` abilities — a triggered
    // one-shot cost reducer (genuinely supported by the runtime, see
    // effects/cost-reduction-handler.ts) was invisible. This card's own
    // on_cast fires a cost_reduction (appliesTo cardType 'S', reduction 3)
    // that applies to ITSELF (a cost-3 spell) alongside a self-copy —
    // effective cost 0 -> the cost<=1 self-loop 'likely' override must fire.
    const selfDiscountingCopier: StaticCard = card({
      id: 400,
      name: 'Self-Discounting Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'cost_reduction',
            reduction: 3,
            appliesTo: { cardType: 'S' },
            duration: { type: 'while_in_play' },
          },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([selfDiscountingCopier]);
    expect(risk.get(400)).not.toBe('none');
    expect(risk.get(400)).toBe('likely');
  });
});

// ── §U1 (round-6 auditor): stacked cost reductions must SUM, not max ────────

/** A same-cardType/tag cost-reduction aura, mirroring reducerAura above but
 * parameterized by alignment so the U1 probe/control can vary faction. */
function reducerCard(id: number, name: string, reduction: number, alignment: readonly string[]) {
  return card({
    id,
    name,
    cardType: 'C',
    stats: { atk: 1, hp: 1, arm: 0 },
    alignment,
    abilities: [
      aura([
        {
          type: 'cost_reduction',
          reduction,
          appliesTo: { cardType: 'S' },
          duration: { type: 'while_in_play' },
        },
      ]),
    ],
  });
}

describe('loop-risk — stacked cost reductions SUM under costFloor (U1, round-6 auditor probe)', () => {
  it('cost-5 self-copier + two SAME-faction -2 reducers stacks to effective cost 1 -> likely, and gates BLOCKED', () => {
    // Runtime (cost-checker.ts totalReduction): both -2 reducers apply
    // simultaneously -> reduction 4, costFloor caps at printed-1 = 4 ->
    // effective cost 5-4 = 1. The single-largest model only ever saw one -2
    // (effective cost 3, net=3 -> 'none'); summing must reach the cost<=1
    // self-loop 'likely' override.
    const target = echoesShaped(5);
    const onyxTarget: StaticCard = { ...target, alignment: ['Onyx'] };
    const reducerA = reducerCard(310, 'Onyx Reducer A', 2, ['Onyx']);
    const reducerB = reducerCard(311, 'Onyx Reducer B', 2, ['Onyx']);

    const risk = assessLoopRisk([onyxTarget, reducerA, reducerB]);
    expect(risk.get(94)).toBe('likely');

    const candidate = {
      id: 94,
      faction: 'Onyx',
      copies: 1,
      edge: 2,
      status: 'over',
      abilityShare: 0,
      costK: 1,
      flags: [] as string[],
      proposedLoopRisk: risk.get(94),
      powerLow: 5,
      powerHigh: 5,
      lo: 4,
      hi: 6,
    };
    const { classification } = classifyCandidate(candidate, {});
    expect(classification).toBe('BLOCKED');
  });

  it('control: reducers that cannot coexist with the target (disjoint, non-empty alignments) do not stack', () => {
    // Same shape, but reducerB is a genuinely different single-faction card
    // (sim/deck-legality.ts: a legal deck's cards all share the hero's exact
    // faction) — it can never be in play alongside an Onyx target, so it must
    // not contribute to the sum. Only reducerA (Onyx, matches the target)
    // applies: reduction 2, effective cost 5-2=3, net=3 -> 'none'. This is
    // the conservative "avoid combining impossible cross-faction configs"
    // half of §U1 — the model must not overstate risk off a config that can
    // never occur in a real deck.
    const target = echoesShaped(5);
    const onyxTarget: StaticCard = { ...target, alignment: ['Onyx'] };
    const reducerA = reducerCard(312, 'Onyx Reducer', 2, ['Onyx']);
    const reducerB = reducerCard(313, 'Sapphire Reducer', 2, ['Sapphire']);

    const risk = assessLoopRisk([onyxTarget, reducerA, reducerB]);
    expect(risk.get(94)).toBe('none');
  });
});

// ── §Q1 (round-4 auditor): free-cast / zero-cost acquisition edges ──────────

describe('loop-risk — unconditional free-cast and zero-cost acquisition edges (Q1)', () => {
  it('a cost-5 self-chain via castForFree:true is likely (unconditional free-cast never pays the printed cost)', () => {
    const freeCastCopier: StaticCard = card({
      id: 500,
      name: 'Free-Cast Self-Chain',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'search_deck',
            filter: { tag: 'Arcane', cardType: 'S' },
            destination: 'hand',
            castForFree: true,
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([freeCastCopier]);
    expect(risk.get(500)).toBe('likely');
  });

  it('a cost-5 self-chain via search_deck destination:battlefield (zero-cost deploy, no cast) is likely', () => {
    const deployCopier: StaticCard = card({
      id: 501,
      name: 'Zero-Cost Deploy Self-Chain',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      tags: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
      abilities: [
        triggered(onDeploy, [
          {
            type: 'search_deck',
            filter: { tag: 'Arcane', cardType: 'C' },
            destination: 'battlefield',
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([deployCopier]);
    expect(risk.get(501)).toBe('likely');
  });

  it('a cost-5 self-chain via deploy_from_deck (zero-cost) is likely', () => {
    const deployFromDeckCopier: StaticCard = card({
      id: 502,
      name: 'Deploy-From-Deck Self-Chain',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      tags: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
      abilities: [triggered(onDeploy, [{ type: 'deploy_from_deck', filter: { tag: 'Arcane' } }])],
    });
    const risk = assessLoopRisk([deployFromDeckCopier]);
    expect(risk.get(502)).toBe('likely');
  });

  it('§T2 (round-5): a cost-5 self-chain via return_from_discard destination:battlefield (zero-cost re-entry, no cast) is likely', () => {
    const returnCopier: StaticCard = card({
      id: 503,
      name: 'Return-From-Discard Self-Chain',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      tags: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
      abilities: [
        triggered(onDeploy, [
          {
            type: 'return_from_discard',
            target: {
              type: 'target_card_in_discard',
              side: 'allied',
              filter: { tag: 'Arcane', cardType: 'C' },
            },
            destination: 'battlefield',
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([returnCopier]);
    expect(risk.get(503)).toBe('likely');
  });
});

// ── §V3 (round-7): per-cycle classification, not SCC aggregates ─────────────

describe('loop-risk — per-cycle classification, not SCC-aggregate dilution (V3)', () => {
  it('a cost-1 self-copier stays likely even when an expensive mutually-reachable card joins the SCC', () => {
    // Old model: the whole SCC (both cards) was classified by ONE aggregate
    // cost sum (1 + 8 = 9, net > 2 -> 'none' for BOTH) — the cheap self-loop's
    // own signal got diluted away by the expensive card sharing its SCC.
    // New model: the cheap card's OWN self-loop is still a distinct length-1
    // cycle, classified by its own cost alone, regardless of what else is
    // mutually reachable with it.
    const cheapSelfCopier = card({
      id: 600,
      name: 'Cheap Self-Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 1, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const expensiveMutual = card({
      id: 601,
      name: 'Expensive Mutual',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 8, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([cheapSelfCopier, expensiveMutual]);
    expect(risk.get(600)).toBe('likely');
    expect(risk.get(601)).toBe('none');
  });
});

// ── §V4 (round-7): reducer multiplicity + mutable-range filters ────────────

describe('loop-risk — reducer multiplicity (V4a)', () => {
  it('two decked copies of one -2 reducer stack to effective cost 1 -> likely (was single-count "none")', () => {
    // Same shape as the §U1 two-reducer-cards probe, but here it is ONE
    // reducer CARD with 2 copies in the deck — the runtime counts one
    // contribution per in-play instance, so 2 copies of a -2 reducer stack
    // to -4 the same as two distinct -2 reducer cards would.
    const target = echoesShaped(5);
    const onyxTarget: StaticCard = { ...target, alignment: ['Onyx'] };
    const reducer = reducerCard(320, 'Onyx Reducer', 2, ['Onyx']);
    const copiesOf = new Map([[320, 2]]);

    const withoutCopies = assessLoopRisk([onyxTarget, reducer]);
    expect(withoutCopies.get(94)).toBe('none'); // single reducer: -2, effective cost 3, net 3 -> none

    const withCopies = assessLoopRisk([onyxTarget, reducer], copiesOf);
    expect(withCopies.get(94)).toBe('likely'); // 2 copies: -4, effective cost 1 -> likely
  });
});

describe('loop-risk — mutable-range filter predicates (V4b)', () => {
  it('a maxHp:0 filter keeps the acquisition edge to a printed-HP-5 risky target (currentHp is mutable, not the printed stat)', () => {
    // riskyDeployTarget is 'likely' on its own (Q1-shaped self-loop via
    // deploy_from_deck, unconditional-free) despite printing HP 5 — a maxHp:0
    // filter CAN still match it at runtime (currentHp is mutable and can be
    // brought to 0 by combat/effects), so the static filter must not exclude
    // it on PRINTED hp. fetcher's return_from_discard->battlefield edge into
    // it must survive and propagate the 'likely' risk backward.
    const riskyDeployTarget: StaticCard = body(701, 'Risky Deploy Target', 3, 5, 0, {
      cardType: 'C',
      tags: ['Arcane'],
      abilities: [triggered(onDeploy, [{ type: 'deploy_from_deck', filter: { tag: 'Arcane' } }])],
    });
    const fetcher: StaticCard = card({
      id: 700,
      name: 'Finisher Fetch',
      cardType: 'S',
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'return_from_discard',
            target: {
              type: 'target_card_in_discard',
              side: 'allied',
              filter: { cardType: 'C', maxHp: 0 },
            },
            destination: 'battlefield',
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([fetcher, riskyDeployTarget]);
    expect(risk.get(701)).toBe('likely'); // the target's own self-loop, unaffected
    expect(risk.get(700)).toBe('likely'); // §V4b: the maxHp:0 edge survived and propagated
  });
});

// ── Item 3: no false-positive explosion ──────────────────────────────────────

describe('loop-risk — no false positives on plain cards', () => {
  it('is none for a plain draw spell and vanilla bodies', () => {
    const drawSpell = card({
      id: 200,
      name: 'Plain Draw',
      cardType: 'S',
      cost: { mana: 2, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          { type: 'draw_cards', count: { type: 'fixed', value: 2 }, player: 'allied' },
        ]),
      ],
    });
    const bodyA = body(201, 'Vanilla A', 3, 3);
    const bodyB = body(202, 'Vanilla B', 2, 4, 1);
    const risk = assessLoopRisk([drawSpell, bodyA, bodyB]);
    expect(risk.get(200)).toBe('none');
    expect(risk.get(201)).toBe('none');
    expect(risk.get(202)).toBe('none');
  });

  it('produces ZERO "likely" over the four starter decks\' live pool (possible entries printed for the record)', () => {
    const raw = JSON.parse(
      readFileSync(new URL('../../sim-data/aetherion-cards.json', import.meta.url), 'utf8'),
    ) as ReadonlyArray<{
      readonly id: number;
      readonly name: string;
      readonly cardType: string;
      readonly cost?: { mana?: number; energy?: number; flexible?: number };
      readonly stats?: { hp?: number; atk?: number; arm?: number } | null;
      readonly traits?: readonly string[];
      readonly tags?: readonly string[];
      readonly alignment?: readonly string[];
      readonly abilities?: ReadonlyArray<{ dsl?: unknown }>;
    }>;
    const decks = JSON.parse(
      readFileSync(new URL('../../sim-data/aetherion-decks.json', import.meta.url), 'utf8'),
    ) as ReadonlyArray<{ readonly mainDeckDefIds: readonly number[] }>;

    const liveIds = new Set<number>();
    for (const deck of decks) for (const id of deck.mainDeckDefIds) liveIds.add(id);

    const pool: StaticCard[] = raw
      .filter(
        (c) =>
          liveIds.has(c.id) && (c.cardType === 'C' || c.cardType === 'S' || c.cardType === 'E'),
      )
      .map((c) => {
        const norm = normalizeTraits(c.traits);
        return {
          id: c.id,
          name: c.name,
          cardType: c.cardType as StaticCard['cardType'],
          cost: {
            mana: c.cost?.mana ?? 0,
            energy: c.cost?.energy ?? 0,
            flexible: c.cost?.flexible ?? 0,
          },
          stats: c.stats
            ? { hp: c.stats.hp ?? 0, atk: c.stats.atk ?? 0, arm: c.stats.arm ?? 0 }
            : null,
          traits: norm.traits,
          tags: c.tags ?? [],
          // Trust boundary: authored DSL JSON -> AbilityDSL, as sim-runner.mjs
          // / balance-data.mjs already do for every other balance harness.
          abilities: (c.abilities ?? [])
            .map((a) => a.dsl)
            .filter(Boolean) as StaticCard['abilities'],
          alignment: c.alignment ?? [],
        };
      });

    const risk = assessLoopRisk(pool);
    const likely = pool.filter((c) => risk.get(c.id) === 'likely');
    const possible = pool.filter((c) => risk.get(c.id) === 'possible');
    // eslint-disable-next-line no-console
    console.log(
      '[loop-risk] live-pool possible entries:',
      possible.map((c) => `${String(c.id)} ${c.name}`),
    );
    expect(likely).toHaveLength(0);
  });
});

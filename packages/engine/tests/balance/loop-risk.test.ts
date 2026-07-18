/**
 * §S4 — loop-risk veto graph regression tests. No simulations: pure DSL
 * analysis, anchored to the Arcane Echoes / Master Archivist catastrophe
 * (2026-07-13/14 investigation — see scratchpad/task-12-brief.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line import/no-relative-packages -- test pins the production copies path
import { copiesInStarterDeck } from '../../balance-suggestions.mjs';
import { assessLoopRisk, LEGAL_MAX_COPIES } from '../../src/balance/loop-graph.js';
import type { Effect } from '../../src/types/effects.js';
import type { StaticCard } from '../../src/balance/types.js';
import { normalizeTraits } from '../../src/setup/trait-normalizer.js';
import { aura, card, triggered, body } from './factory.js';
import { classifyCandidate } from '../../balance-gates.mjs';

const onCast = { type: 'on_cast' } as const;
const onDeploy = { type: 'on_deploy' } as const;
const onDies = { type: 'on_dies' } as const;
const onAllyDies = { type: 'on_ally_dies' } as const;
const onTakeDamage = { type: 'on_take_damage' } as const;
const onDealDamage = { type: 'on_deal_damage' } as const;
const onAttack = { type: 'on_attack' } as const;

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

// ── §Y1 (round-10 auditor): temporary resources fund loops too ─────────────

describe('loop-risk — temporary gain_resource funds the loop identically to permanent (Y1, round-10 auditor probe)', () => {
  it('a cost-3 on_cast self-copy generating 3 TEMPORARY resources/traversal is likely, and gates BLOCKED', () => {
    // net = costSum(3) - gainSum(3) = 0 -> net<=0 -> 'likely'. Pre-fix, the
    // temporary gain was excluded from gainSum entirely (net=3 -> 'none'),
    // exactly the auditor's Y1 finding: the runtime credits a temporary
    // resource immediately and cost-checking spends it exactly like a
    // permanent one within the same turn a loop traversal happens in.
    const tempFundedCopier: StaticCard = card({
      id: 800,
      name: 'Temp-Funded Copier',
      cardType: 'S',
      tags: ['Arcane'],
      alignment: ['Onyx'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          { type: 'gain_resource', resourceType: 'mana', amount: 3, temporary: true },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([tempFundedCopier]);
    expect(risk.get(800)).toBe('likely');

    const candidate = {
      id: 800,
      faction: 'Onyx',
      copies: 1,
      edge: 2,
      status: 'over',
      abilityShare: 0,
      costK: 1,
      flags: [] as string[],
      proposedLoopRisk: risk.get(800),
      powerLow: 5,
      powerHigh: 5,
      lo: 4,
      hi: 6,
    };
    const { classification } = classifyCandidate(candidate, {});
    expect(classification).toBe('BLOCKED');
  });

  it('control: the same shape with a PERMANENT gain of the same amount is unchanged (still likely)', () => {
    // Proves the fix didn't change permanent-gain behavior — only extended
    // the same treatment to temporary gains.
    const permFundedCopier: StaticCard = card({
      id: 801,
      name: 'Perm-Funded Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          { type: 'gain_resource', resourceType: 'mana', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([permFundedCopier]);
    expect(risk.get(801)).toBe('likely');
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

// ── §H3-1 (batch-C): self death-trigger recursion was invisible ────────────

describe('loop-risk — self vs ally death-variant free-return loops (H3-1)', () => {
  it('a self-death-triggered (on_dies) unconditional free-return self-chain is likely — was invisible pre-fix', () => {
    // Pre-fix, on_dies wasn't in REPEATABLE_EVENTS -> isRepeatableTrigger
    // returned false -> isLoopGraphTrigger skipped this ability entirely ->
    // NO edge was ever built, regardless of cost. Same Q1 free-return shape
    // as the existing onDeploy tests, gated behind on_dies instead.
    const selfDeathCard: StaticCard = card({
      id: 900,
      name: 'Self-Death Free-Return',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      tags: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
      abilities: [
        triggered(onDies, [
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
    expect(assessLoopRisk([selfDeathCard]).get(900)).toBe('likely');
  });

  it('control: the same shape gated on the already-supported ally variant (on_ally_dies) is likely too', () => {
    // Proves parity: the self variant behaves exactly like its already-
    // working ally-scoped counterpart, not a special case.
    const allyDeathCard: StaticCard = card({
      id: 901,
      name: 'Ally-Death Free-Return',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      tags: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
      abilities: [
        triggered(onAllyDies, [
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
    expect(assessLoopRisk([allyDeathCard]).get(901)).toBe('likely');
  });
});

// ── §H3-3 (batch-C): self combat triggers recurring within a turn ──────────

describe('loop-risk — self combat triggers with free self-acquisition (H3-3)', () => {
  const combatTriggers: ReadonlyArray<
    readonly [name: string, trigger: { readonly type: string }, id: number]
  > = [
    ['on_take_damage', onTakeDamage, 910],
    ['on_deal_damage', onDealDamage, 911],
    ['on_attack', onAttack, 912],
  ];

  it.each(combatTriggers)(
    '%s gated unconditional free-return self-chain is likely — was invisible pre-fix',
    (_name, trigger, id) => {
      const c: StaticCard = card({
        id,
        name: `Combat-Trigger Free-Return (${_name})`,
        cardType: 'C',
        stats: { atk: 2, hp: 3, arm: 0 },
        tags: ['Arcane'],
        cost: { mana: 5, energy: 0, flexible: 0 },
        abilities: [
          triggered(trigger as unknown as Parameters<typeof triggered>[0], [
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
      expect(assessLoopRisk([c]).get(id)).toBe('likely');
    },
  );
});

// ── §H3-2 (batch-C): heroes/transforms as acquisition-edge + reducer sources ─

describe('loop-risk — heroes/transforms enter the graph as sources (H3-2)', () => {
  it('Kaelthar-shaped: a transform (always in play, activated/cooldown) with an unconditional free-return ability flips a cheap in-deck piece none -> likely once it can reach a genuine cycle', () => {
    // Mirrors the real Kaelthar the Lich King (T id3): an activated,
    // cooldown-gated return_from_discard -> battlefield (free) targeting
    // cheap characters. Without the transform in the assessed pool, a
    // character (Y) whose OWN on_deploy searches for a transform card has
    // no target (no cardType 'T' card exists in scope) -> no edge -> 'none'.
    // Once the transform is wired into the pool as a SOURCE, Y's search
    // edge into it plus the transform's free-return edge back into Y forms
    // a genuine 2-node cycle, classified via the transform's own (zero)
    // cost -> 'likely'. Activation cost pinned at 0 mana here (unlike the
    // real Kaelthar's 3) to isolate the H3-2 wiring effect from H3-4's
    // separately-tested activation-cost accounting — combining both fixes
    // against the REAL 3-mana Kaelthar correctly yields a lower/'none'
    // classification for this exact shape (see H3-4 tests below); that's
    // the intended interaction, not a contradiction.
    const kaeltharShaped: StaticCard = card({
      id: 3,
      name: 'Kaelthar-shaped Transform',
      cardType: 'T',
      cost: { mana: 0, energy: 0, flexible: 0 },
      abilities: [
        triggered({ type: 'activated', cost: { mana: 0, energy: 0, flexible: 0 }, cooldown: 1 }, [
          {
            type: 'return_from_discard',
            target: {
              type: 'target_card_in_discard',
              side: 'allied',
              filter: { maxCost: 3, cardType: 'C' },
            },
            destination: 'battlefield',
          },
        ]),
      ],
    });
    const cheapPiece: StaticCard = card({
      id: 910 + 1000,
      name: 'Cheap In-Deck Piece',
      cardType: 'C',
      stats: { atk: 1, hp: 1, arm: 0 },
      cost: { mana: 2, energy: 0, flexible: 0 },
      abilities: [
        triggered(onDeploy, [
          { type: 'search_deck', filter: { cardType: 'T' }, destination: 'hand' },
        ]),
      ],
    });

    const withoutTransform = assessLoopRisk([cheapPiece]);
    expect(withoutTransform.get(cheapPiece.id)).toBe('none');

    const withTransform = assessLoopRisk([cheapPiece, kaeltharShaped]);
    expect(withTransform.get(cheapPiece.id)).toBe('likely');
  });

  it('Seraphina-shaped: a hero deck-wide cost-reduction aura lowers effective costs in her faction and flips a self-loop classification', () => {
    // Mirrors the real Shieldbearer Seraphina (H id134): an always-active
    // aura cost_reduction over Equipment. Without the hero wired into the
    // reducer scan, a cost-3 equipment self-loop nets 3 (>2) -> 'none'; with
    // the hero's -2 discount counted, effective cost 1 -> the cost<=1
    // self-loop override fires -> 'likely'.
    const seraphinaShaped: StaticCard = card({
      id: 134,
      name: 'Seraphina-shaped Hero',
      cardType: 'H',
      cost: { mana: 1, energy: 0, flexible: 0 },
      alignment: ['Radiant'],
      abilities: [
        aura([
          {
            type: 'cost_reduction',
            reduction: 2,
            appliesTo: { cardType: 'E' },
            duration: { type: 'while_in_play' },
          },
        ]),
      ],
    });
    const equipSelfCopier: StaticCard = card({
      id: 920,
      name: 'Equip Self-Copier',
      cardType: 'E',
      tags: ['Arcane'],
      alignment: ['Radiant'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'E' },
          },
        ]),
      ],
    });

    const withoutHero = assessLoopRisk([equipSelfCopier]);
    expect(withoutHero.get(920)).toBe('none');

    const withHero = assessLoopRisk([equipSelfCopier, seraphinaShaped]);
    expect(withHero.get(920)).toBe('likely');
  });

  it('DEFECT A regression: a firstPerTurn hero aura does NOT sustain a self-loop (excluded from effective cost)', () => {
    // Same shape as the Seraphina-shaped test above, but the aura's discount
    // is firstPerTurn: true — mirrors the REAL Shieldbearer Seraphina (H
    // id134) and Lyria Archmage Supreme (T id74), both of which carry
    // cost_reduction with appliesTo.firstPerTurn: true. Runtime ground truth
    // (cost-checker.ts:44, reductionMatches' usedThisTurn gate): a
    // firstPerTurn reduction discounts only the FIRST matching cast each
    // turn — every subsequent same-turn cast pays full price. A within-turn
    // self-copy loop repeats MANY times in one turn, so its SUSTAINED
    // per-iteration cost is the full printed cost, not the once-discounted
    // one. Pre-fix, collectCostReducers dropped `firstPerTurn` and modeled
    // this as a standing -2 discount: effective cost 3-2=1 -> the cost<=1
    // self-loop override fires -> 'likely' (a false hard-veto). Post-fix, the
    // firstPerTurn reducer is excluded entirely: effective cost stays 3 ->
    // net 3 (>2) -> 'none'.
    const seraphinaShapedFirstPerTurn: StaticCard = card({
      id: 134,
      name: 'Seraphina-shaped Hero (firstPerTurn)',
      cardType: 'H',
      cost: { mana: 1, energy: 0, flexible: 0 },
      alignment: ['Radiant'],
      abilities: [
        aura([
          {
            type: 'cost_reduction',
            reduction: 2,
            appliesTo: { cardType: 'E', firstPerTurn: true },
            duration: { type: 'while_in_play' },
          },
        ]),
      ],
    });
    const equipSelfCopierFpt: StaticCard = card({
      id: 921,
      name: 'Equip Self-Copier (firstPerTurn hero)',
      cardType: 'E',
      tags: ['Arcane'],
      alignment: ['Radiant'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'E' },
          },
        ]),
      ],
    });

    const withFptHero = assessLoopRisk([equipSelfCopierFpt, seraphinaShapedFirstPerTurn]);
    expect(withFptHero.get(921)).toBe('none');
  });

  it('DEFECT A regression (companion, cardType S): a firstPerTurn spell-cost aura does NOT sustain a self-loop', () => {
    // Same firstPerTurn exclusion, isolated on cardType 'S' (the Lyria/Echoes
    // shape from the brief: Arcane Echoes id94 is cardType S, cost 5; a
    // firstPerTurn -1 Arcane-S reducer must not lower its SUSTAINED cost).
    // A standing -3 (Wizard's Robe-shaped) plus a firstPerTurn -1 (Lyria-
    // shaped): effective cost = 5 - 3 (standing only, firstPerTurn excluded)
    // = 2 -> net 2 <=2 -> 'possible', NOT 'likely'. Pre-fix, both would have
    // summed (5-3-1=1 <=1) -> 'likely' (a false hard-veto).
    const lyriaShapedFirstPerTurn: StaticCard = card({
      id: 74,
      name: 'Lyria-shaped Transform (firstPerTurn)',
      cardType: 'T',
      cost: { mana: 0, energy: 0, flexible: 0 },
      alignment: ['Arcane'],
      abilities: [
        aura([
          {
            type: 'cost_reduction',
            reduction: 1,
            appliesTo: { cardType: 'S', tag: 'Arcane', firstPerTurn: true },
            duration: { type: 'while_in_play' },
          },
        ]),
      ],
    });
    const robeShapedStanding: StaticCard = card({
      id: 96,
      name: "Wizard's-Robe-shaped Standing Reducer",
      cardType: 'E',
      alignment: ['Arcane'],
      cost: { mana: 2, energy: 0, flexible: 0 },
      abilities: [
        aura([
          {
            type: 'cost_reduction',
            reduction: 3,
            appliesTo: { cardType: 'S', tag: 'Arcane' },
            duration: { type: 'while_in_play' },
          },
        ]),
      ],
    });
    const echoesShapedFpt: StaticCard = card({
      id: 94,
      name: 'Echoes-shaped (firstPerTurn companion)',
      cardType: 'S',
      tags: ['Arcane'],
      alignment: ['Arcane'],
      cost: { mana: 5, energy: 0, flexible: 0 },
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

    const risk = assessLoopRisk(
      [echoesShapedFpt, robeShapedStanding, lyriaShapedFirstPerTurn],
      undefined,
    );
    expect(risk.get(94)).toBe('possible');
  });
});

// ── §H3-4 (batch-C): activated.cost was ignored in traversal cost ──────────

describe("loop-risk — an activated trigger's own firing cost counts toward traversal cost (H3-4)", () => {
  it('a genuinely-expensive activated engine drops from likely to none once its own activation cost is counted', () => {
    // A cost-2 self-copier funding itself with a permanent +3 gain_resource
    // (net = cardCost(2) - gain(3) = -1 <=0 -> 'likely' on card cost alone,
    // NOT via the cost<=1/free overrides — cost is 2, not free — so this
    // isolates the net-cost arithmetic path H3-4 touches). Gated behind an
    // ACTIVATED trigger that itself costs 6 mana to fire, unthrottled.
    // Pre-fix, that 6-mana activation cost never entered costSum -> 'likely'
    // regardless of activation cost. Post-fix, the real per-traversal cost
    // (6) is added: net = (6+2)-3 = 5 > 2 -> 'none'.
    const expensiveActivatedCopier: StaticCard = card({
      id: 930,
      name: 'Expensive Activated Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 2, energy: 0, flexible: 0 },
      abilities: [
        triggered({ type: 'activated', cost: { mana: 6, energy: 0, flexible: 0 } }, [
          { type: 'gain_resource', resourceType: 'mana', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([expensiveActivatedCopier]);
    expect(risk.get(930)).toBe('none');
  });

  it('control: the SAME shape gated on a cheap activation (cost 1) still classifies likely — the fix only matters when the firing cost is real', () => {
    // Identical shape, activation cost 1 instead of 6: net = (1+2)-3 = 0 <=0
    // -> 'likely', unchanged by the fix (a small, real activation cost
    // doesn't tip a genuinely self-funding loop out of 'likely').
    const cheapActivatedCopier: StaticCard = card({
      id: 931,
      name: 'Cheap Activated Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 2, energy: 0, flexible: 0 },
      abilities: [
        triggered({ type: 'activated', cost: { mana: 1, energy: 0, flexible: 0 } }, [
          { type: 'gain_resource', resourceType: 'mana', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([cheapActivatedCopier]);
    expect(risk.get(931)).toBe('likely');
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

// ── §R12-5: resource axes must not be summed into one scalar ───────────────

describe('loop-risk — per-axis net-cost accounting (R12-5)', () => {
  it('a cost-3-MANA self-copier that gains 3 ENERGY is NOT likely (residual mana 3 > 0 — energy cannot pay a mana cost)', () => {
    // Pre-fix: costSum(3) - gainSum(3) = 0 <=0 -> 'likely', because the old
    // model summed mana+energy into one scalar on both sides. The runtime
    // can never pay this card's 3-MANA cost from a 3-ENERGY gain (specific-
    // axis shortage check, actions/cost-checker.ts) — no real loop. Post-fix:
    // residMana = max(0, 3-0) = 3, residEnergy = max(0, 0-3) = 0, leftover =
    // max(0, 0-3) + max(0, 3-0) = 3 (spare energy, but nothing left to pay
    // mana with), residFlex = max(0, 0-3) = 0 -> netResidual = 3 (>2) ->
    // 'none'.
    const manaCostEnergyGainCopier: StaticCard = card({
      id: 950,
      name: 'Mana-Cost Energy-Gain Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          { type: 'gain_resource', resourceType: 'energy', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([manaCostEnergyGainCopier]);
    expect(risk.get(950)).not.toBe('likely');
    expect(risk.get(950)).toBe('none');
  });

  it('control: the same shape gaining 3 MANA (same axis as its cost) is unchanged — still likely', () => {
    // Proves the fix didn't touch same-axis loops: mana cost, mana gain ->
    // residMana = max(0, 3-3) = 0 -> netResidual = 0 <=0 -> 'likely'.
    const manaCostManaGainCopier: StaticCard = card({
      id: 951,
      name: 'Mana-Cost Mana-Gain Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 3, energy: 0, flexible: 0 },
      abilities: [
        triggered(onCast, [
          { type: 'gain_resource', resourceType: 'mana', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([manaCostManaGainCopier]);
    expect(risk.get(951)).toBe('likely');
  });

  it('a FLEXIBLE-cost self-copier that gains 3 MANA is still likely — spare same-axis mana pays a flexible cost', () => {
    // Cost is 3 FLEXIBLE (no specific mana/energy need at all): residMana = 0,
    // residEnergy = 0, leftover = max(0, 3-0) + max(0, 0-0) = 3 (all 3 mana is
    // spare, since there's no mana-specific need to consume it first),
    // residFlex = max(0, 3-3) = 0 -> netResidual = 0 <=0 -> 'likely'. Mirrors
    // the runtime's own flexible-payment rule (cost-checker.ts canAfford:
    // flexible draws from whatever mana/energy remains after specific costs).
    const flexCostManaGainCopier: StaticCard = card({
      id: 952,
      name: 'Flexible-Cost Mana-Gain Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 0, energy: 0, flexible: 3 },
      abilities: [
        triggered(onCast, [
          { type: 'gain_resource', resourceType: 'mana', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([flexCostManaGainCopier]);
    expect(risk.get(952)).toBe('likely');
  });

  it('§R12-2b: a flexible-COST self-copier that gains 3 FLEXIBLE is NOT likely — a banked flexible gain cannot pay a recurring cost the runtime can only satisfy from mana/energy', () => {
    // Kimi K3 (round-12 re-review) flagged that loopResourceGain drops a
    // flexible-typed gain. That gain CAN be produced (executeGainResource banks
    // it), but the runtime's affordability check (getAvailableResources,
    // actions/cost-checker.ts) counts only mana/energy, so a banked flexible
    // resource can never actually pay a loop's recurring cost. Dropping it
    // matches that runtime behavior: residFlex = max(0, 3 - 0) = 3 -> 'none'.
    // This test pins that contract — if the runtime is ever changed to spend
    // flexible-banked resources, this would flip and the drop would need
    // revisiting (loop-graph.ts loopResourceGain).
    const flexCostFlexGainCopier: StaticCard = card({
      id: 953,
      name: 'Flexible-Cost Flexible-Gain Copier',
      cardType: 'S',
      tags: ['Arcane'],
      cost: { mana: 0, energy: 0, flexible: 3 },
      abilities: [
        triggered(onCast, [
          { type: 'gain_resource', resourceType: 'flexible', amount: 3 },
          {
            type: 'copy_card',
            source: 'discard',
            destination: 'hand',
            filter: { tag: 'Arcane', cardType: 'S' },
          },
        ]),
      ],
    });
    const risk = assessLoopRisk([flexCostFlexGainCopier]);
    expect(risk.get(953)).not.toBe('likely');
    expect(risk.get(953)).toBe('none');
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

  it('produces ZERO "likely" over the FULL supplied pool, not just the four starter decks (§Z2, round-11 auditor — an off-starter reducer/copier must still count; possible entries printed for the record)', () => {
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

    // §Z2: the live census is the FULL committed card file (every playable
    // card), not the starter-deck subset — an off-starter reducer/copier
    // must be visible to the acquisition graph exactly like production's
    // computeSuggestions() now scores it (balance-suggestions.mjs).
    // §H3-2 (batch-C): heroes (H) and transforms (T) are now included too,
    // mirroring production's pool assembly (balance-suggestions.mjs) — they
    // enter as acquisition-edge/reducer SOURCES only.
    const pool: StaticCard[] = raw
      .filter(
        (c) =>
          c.cardType === 'C' ||
          c.cardType === 'S' ||
          c.cardType === 'E' ||
          c.cardType === 'H' ||
          c.cardType === 'T',
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

    // Round-7 review: pin the PRODUCTION path — real starter-deck copy counts
    // where the card IS decked (evidence), LEGAL_MAX_COPIES for a genuinely
    // un-decked id (§Z2/§V4(a) — matches computeSuggestions' copiesOf). A
    // hero/transform is never decked/copied — pinned at 1 (§H3-2), matching
    // balance-suggestions.mjs's copiesOf construction.
    const liveCopies = new Map(
      pool.map((c) =>
        c.cardType === 'H' || c.cardType === 'T'
          ? [c.id, 1]
          : [c.id, copiesInStarterDeck(c.id) || LEGAL_MAX_COPIES],
      ),
    );
    const risk = assessLoopRisk(pool, liveCopies);
    const likely = pool.filter((c) => risk.get(c.id) === 'likely');
    const possible = pool.filter((c) => risk.get(c.id) === 'possible');
    // eslint-disable-next-line no-console
    console.log(
      '[loop-risk] live-pool possible entries:',
      possible.map((c) => `${String(c.id)} ${c.name}`),
    );
    // §DEFECT A fix (post-fix re-pin, measured — not derived): batch-C wired
    // heroes/transforms into the graph as SOURCES, which surfaced Lyria
    // Archmage Supreme's (T id74) "first spell each turn costs 1 less"
    // cost_reduction aura on Arcane spells. That reducer carries
    // appliesTo.firstPerTurn: true. Runtime ground truth (cost-checker.ts:44,
    // reductionMatches' usedThisTurn gate): a firstPerTurn reduction discounts
    // ONLY the first matching cast each turn — every subsequent same-turn
    // cast pays full price. collectCostReducers previously copied
    // cardType/tag from a reducer's appliesTo but DROPPED firstPerTurn,
    // modeling Lyria's once-per-turn discount as a STANDING one applied on
    // every loop iteration — a false hard-veto (5 - 3(Robe) - 1(Lyria) = 1,
    // crossing the cost<=1 self-loop 'likely' override).
    //
    // Post-fix, collectCostReducers excludes any reducer with
    // appliesTo.firstPerTurn === true from the per-iteration reducer set.
    // Arcane Echoes (id94, printed cost 5, tag Arcane, cardType S) now only
    // sees Wizard's Robe's (id96) STANDING (non-firstPerTurn) -1-per-copy
    // Arcane-S reducer (3 starter copies -> -3 total): effective cost
    // 5 - 3 = 2. That crosses the net<=2 threshold -> 'possible', but NOT
    // the cost<=1 'likely' override. Measured (this test, run post-fix):
    // likely = [], possible = [94 Arcane Echoes, 119 Rampant Evolution,
    // 141 Master Archivist] (console.log above). Master Archivist (id141) and
    // Rampant Evolution (id119) were pinned 'likely' pre-fix ONLY because they
    // inherit Echoes' rank through pre-existing propagation paths (Archivist's
    // castFreeIfCost:1 fetch of Echoes; Rampant Evolution's unconditional
    // deploy_from_deck into any character, reaching Archivist) — neither has
    // its own cost<=1 self-loop or net<=0 cycle. Once Echoes drops from
    // 'likely' to 'possible', both dependents drop with it (to 'possible',
    // via the same inheritance paths). A locked EMPTY set (not
    // toHaveLength(0)) so any regression that reintroduces a 'likely' verdict
    // here is caught immediately.
    expect(likely.map((c) => c.id).sort((a, b) => a - b)).toEqual([]);
    // §R12-2b (round-12 re-review, Kimi K3): also PIN the 'possible' set, not
    // just likely=[]. Previously the possible set was only console.log-ed, so a
    // future change silently demoting Echoes/Archivist/Rampant Evolution to
    // 'none' (e.g. a per-axis or reducer regression) would have passed unnoticed
    // while still satisfying likely=[]. Locking it makes the live census a
    // two-sided pin.
    expect(possible.map((c) => c.id).sort((a, b) => a - b)).toEqual([94, 119, 141]);
  });
});

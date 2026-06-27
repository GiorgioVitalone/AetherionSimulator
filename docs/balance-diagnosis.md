# Aetherion Starter-Pool Balance Diagnosis — why the spread is so large

**Date:** 2026-06-27. **Scope:** the 4 official starter decks. **Method:** static deck/hero
profiling + a battery of single-lever causal ablations (engine `GameConfig` knobs) on the
real decks, under both the **heuristic** and the archetype-neutral **rollout** pilot, all-pairs
incl. mirrors, first player alternating, deterministic. Tooling: `balance-diagnose-static.mjs`,
`balance-diagnose.mjs`, `balance-diagnose2.mjs`, `balance-diagnose-rollout.mjs`.

> **This is a diagnosis, not a fix list.** The single most important finding is that the
> problem is **multi-causal AND the measurement itself is unreliable** — so any fix validated
> on the default bot alone will mislead you (we prove this below).

---

## 0. TL;DR

The ~46 pp (heuristic) / ~52 pp (fair-play) parity spread is **not one thing**. It decomposes into:

1. **A two-deck top tier, not one.** Under *fair* play **Radiant and Verdant are co-dominant (~73% each).** The heuristic hides this — it rates Verdant a mediocre 43% because it can't pilot Verdant's ramp/go-wide ceiling. **This is the root cause of the "endless chase": nerf Radiant and Verdant inherits the throne.** We measured exactly this — the focused Radiant nerf (combo-A) drops Radiant 73→48 but lifts Verdant 73→**85**, and the spread gets *worse* (51.6→58.3).
2. **A measurement-depressed floor.** Sapphire (~22% fair, ~38% heuristic) and Onyx (~32%) sit low **largely because the bots cannot pilot their plans** (control/counter for Sapphire; recursion/sacrifice for Onyx — both lean on ~18 effect types the scorer treats as flat-1, and `sacrifice` is scored as a *cost*). Sapphire's number is the single biggest false signal in the data.
3. **A genuine card-stat driver concentrated in Radiant body HP.** Radiant's defensive grind lives on its bodies *surviving* combat; −1 HP on its eight cost-≥2 bodies is the largest single heuristic lever in the whole study (spread 46→17). It is real — but, per (1), insufficient and partly self-defeating in isolation.
4. **A real but modest hero-LP asymmetry** (25/30/33/35 across Onyx/Sapphire/Verdant/Radiant).
5. **Core game rules are mostly *not* the problem** — ARM-stacking, ARM-instance, Defender-zone, deploy-to-High-Ground, and the LP-tiebreak levers each move the spread by ≤3 pp, and some *backfire*.

**You cannot balance this pool against the heuristic's numbers.** Fix the measurement first (§6), recognize the top tier is two decks, and treat the floor as unmeasured rather than weak.

---

## 1. The decks at a glance (static profile)

| Faction | Hero LP | Bodies | stat/cost | Defining keywords/effects | Intended plan |
|---|---|---|---|---|---|
| **Radiant** | **35** | 22 | 1.39 | **16 Defender, 6 shield, 14 heal**, Bulwark +1 ARM | Go-wide defensive grind |
| **Verdant** | 33 | 20 | **1.43** | ramp (temp Energy), tokens, Regeneration, big top-end | Ramp → go-wide tokens |
| **Sapphire** | 30 | 18 | 1.37 | **20 draw, 5 counter**, 5 shield, 0 heal | Hard control / card advantage |
| **Onyx** | **25** | 17 | 1.34 | recursion, sacrifice, **24 removal**, death-triggers | Sacrifice/recursion attrition |

**Key static facts:** raw stat-for-cost is nearly **flat** (1.34–1.43), so "bigger bodies for cost" is *not* the driver. The differences are in **hero LP** (a 10-pt spread) and **keyword/plan distribution** — and two of the four plans (Sapphire, Onyx) route through effects the bots can't value. The transform gate is **LP ≤ 10** (comeback-only): transforms almost never fire, so transformed heroes are near-irrelevant except for low-LP Onyx.

---

## 2. Faction win rates: the two pilots disagree (and that disagreement IS a finding)

| Faction | Heuristic (10k games, tight CI) | Rollout (fair, small n, ±~12pp) | Reading |
|---|---|---|---|
| Radiant | **81.6%** | **73.3%** | Genuinely top tier (both agree) |
| Verdant | 43.1% | **73.3%** | **Co-top tier — heuristic hides it** |
| Onyx | 37.1% | 31.7% | Low-mid; partly under-piloted |
| Sapphire | 38.2% | 21.7% | Floor — **largely a measurement artifact** |

The heuristic and rollout **disagree by 30 pp on Verdant** and **16 pp on Sapphire**. Per our own
measurement protocol (`docs/balance-targets.md` §4), where pilots disagree the result is
*undetermined*. The robust conclusions: **Radiant top (real), Verdant also top (real, hidden),
Onyx low-mid, Sapphire's true rank unknown (bot-limited).**

---

## 3. Causal decomposition by layer (measured)

Each lever neutralizes one rule/mechanic/hero/card advantage; the change in parity spread is its
contribution. **Heuristic baseline spread = 45.8 pp.** (Heuristic is fast/tight for *relative*
deltas; absolute validity is checked in §5.)

### Layer A — Game rules (small; some backfire). **Stop chasing here.**
| Lever | Δspread | Note |
|---|---|---|
| Defender only in High Ground | **+5.1** | *backfires* — frees Verdant go-wide, hurts Sapphire |
| Any char deploys to High Ground | −3.0 | minor |
| Defender force-cap 1 / 2 | −2.7 / −2.2 | gentle, surgical |
| ARM first-instance-only | −0.7 | negligible |
| ARM buffs combine by max | −0.5 | negligible |
| LP-tiebreak vs none | **0.0** | tiebreak does *nothing* — heuristic games finish by lethal |
| First-player compensation (card+res) | −3.5 | FP advantage is already healthy (+2.6 pp); not a driver |

### Layer B — Hero asymmetry (real, ~6–7 pp).
| Lever | Δspread | Note |
|---|---|---|
| Equalize all hero LP → 30 | −6.6 | Onyx +9.8 (its 25 LP is a real handicap) |
| Radiant hero LP 35 → 30 | −6.5 | Radiant's +5 head-start ≈ −4.4 pp of its win rate |
| Disable all hero healing | −6.3 | Radiant's 14 heal cards keep its hero alive |
| Transform-gate widen (res-deck-empty) | −5.0 | mild help to comeback factions (Onyx) |
| Onyx hero LP 25 → 30 / 33 | **+1.0 / +1.6** | *whack-a-mole* — Sapphire becomes the new floor |

### Layer C — Mechanics / keywords (real, concentrated in Defender).
| Lever | Δspread | Note |
|---|---|---|
| Ablate Defender **forcing** | **−15.7** | biggest *mechanic* lever — Radiant's 16-Defender wall |
| Ablate −1 "would take damage" shield | −3.7 | **but also hurts Sapphire** (shared mechanic) — collateral |
| Ablate Seraphina Bulwark +1 ARM | −2.8 | |
| Ablate Flying | −0.5 | negligible |

Defender's bite is really **"Defender × Radiant's loadout"** (16 copies) — a card-distribution issue
more than a pure-mechanic one.

### Layer D — Cards / deck construction (the dominant heuristic driver).
| Lever | Δspread | Note |
|---|---|---|
| **Radiant cost-≥2 bodies −1 HP** | **−28.8** | spread 46→17; Radiant 82→61. **HP is the load-bearing stat.** |
| Radiant char stats ×0.85 | −7.6 | raw Radiant power |
| Sapphire char stats ×1.20 | +0.2 | *whack-a-mole* (Onyx becomes floor) |
| Onyx char stats ×1.20 | +0.5 | *whack-a-mole* (Sapphire becomes floor) |
| **Verdant char stats ×0.85** | **+11.0** | **disaster** — kneecaps Radiant's only rival → Radiant 88% |

**Why HP and not ATK/LP/ARM:** Radiant is a defensive grind; its edge is bodies *surviving* combat
exchanges. The combat sim accepts/declines trades on exact HP, so shaving 1 HP flips a huge number of
exchanges and the walls crumble. This is the variable past attempts (LP, ARM, zone) mostly missed.

### Layer E — Measurement artifact (large; NOT a balance defect).
- **Sapphire** plays counters + card-advantage + recursion → win late. The scorer values counters at
  0.5, draw at 1.2/card, and `search_deck`/`copy_card`/`scry`/recursion at flat 1; it has *no model
  for "card advantage → inevitability"*, fields the flimsiest bodies, and never reaches its (excellent)
  transform. Its ~22–38% is **mostly a pilot failure, not a power failure.**
- **Onyx**'s sacrifice→draw→recur loop is similarly dark (`sacrifice` scored as a *cost*; recursion =1;
  on-death payoffs ignored), and it fields deliberately-undersized bodies + the lowest LP.
- **Verdant**'s ramp/transform *ceiling* is invisible to the heuristic (`gain_resource`=0.5; multipliers
  gated behind the LP≤10 transform), which is why the heuristic under-rates it at 43% vs the fair 73%.

---

## 4. Your past levers, scored against the data

| Past lever | Verdict | Evidence |
|---|---|---|
| ARM buffs take max | ✗ negligible | Δspread −0.5 |
| Defender only in High Ground | ✗ **backfires** | Δspread **+5.1** |
| Turn cap + LP tiebreak | ◐ neutral on balance | identical to no-tiebreak (games finish by lethal) |
| First-player compensation | ◐ minor | Δspread −3.5; FP advantage already healthy (+2.6 pp) |
| Transformation-gate widening | ◐ mild help | Δspread −5.0 (helps comeback factions) |
| **Radiant cost-2+ −1 HP** | ⚠ **huge but self-defeating alone** | heuristic −28.8 **but rollout: crowns Verdant, spread +6.7** |
| Trim cheap-body stats | ✗ low value | stat/cost is flat; cheap bodies aren't the lever |
| Disable hero healing | ◑ real, partial | Δspread −6.3 |
| −1 shield first-instance | ◑ real, partial | Δspread −4.1 (also nicks Sapphire) |
| **Sapphire wincon** | ⚠ right idea, but bot-legibility matters | only helps if the finisher is something the bot can *pilot* (a body/burn), not another ignored engine piece |
| **Onyx recursion payoff** | ⚠ won't show on the bot | recursion is scored flat-1 → a recursion payoff is invisible to the measurement |
| Onyx starting LP increase | ✗ **whack-a-mole** | Δspread **+1.0 / +1.6** (Sapphire becomes floor) |
| Verdant trim / floor-raise | ✗ trim **backfires** | Verdant ×0.85 → Δspread **+11.0**, Radiant 88% |

---

## 5. The validation that overturns the "obvious" fix

The focused, realistic Radiant nerf **combo-A** = (cost-≥2 −1 HP) + (hero LP→30) + (Defender force-cap 2)
+ (shield first-instance):

| | Onyx | Radiant | Sapphire | Verdant | spread |
|---|---|---|---|---|---|
| Heuristic baseline | 36.0 | 81.8 | 37.6 | 44.6 | 45.8 |
| Heuristic + combo-A | 51.2 | 52.4 | 45.2 | 51.3 | **7.2** ✅ |
| **Rollout baseline** | 31.7 | 73.3 | 21.7 | 73.3 | 51.6 |
| **Rollout + combo-A** | 40.0 | **48.3** | 26.7 | **85.0** | **58.3** ❌ |

combo-A looks like a near-perfect fix under the heuristic (7.2 pp) and is **actively harmful under fair
play** (58.3 pp): it nerfs Radiant correctly but **hands the game to Verdant** (→85%) and leaves Sapphire
floored (~27%). **A fix validated only on the heuristic is worse than useless here.**

---

## 6. Why every past iteration stalled — and what to actually do

**Root causes of the endless chase (all measured):**
1. **Two co-dominant decks, not one.** Nerf Radiant → Verdant rises. You must treat Radiant *and*
   Verdant as the top tier and adjust them together, or you see-saw forever.
2. **The floor is a measurement defect, not a balance defect.** Sapphire/Onyx are under-piloted; buffing
   their stats/LP either whack-a-moles the floor onto the other or **over-buffs a card whose number is
   artificially low** (you'd ship a real-life-OP Sapphire to make the bot's number reach 50%).
3. **Past levers hit non-load-bearing variables** (LP, ARM, zone rules) — each ≤3–7 pp — under a pilot
   that **mis-ranks the field**. You were optimizing against a broken ruler.

**Recommended sequence (do NOT skip step 0):**

- **Step 0 — Fix the measurement before touching any card.** Give the bot win-path-aware scores for
  `draw` / `counter_spell` / `return_from_discard` / `search_deck` / `copy_card` (or adopt a stronger,
  fairer reference pilot), and re-rank the field. Until Sapphire/Onyx/Verdant are measured fairly, every
  card change is a guess against a ruler that hides Verdant and buries Sapphire. **This is the highest-
  leverage action in the whole report.**
- **Step 1 — Re-run the §5 panel under the fixed/fair pilot** to get the true matchup matrix. Expect the
  real problem to be a **Radiant+Verdant top tier** with an **unknown (probably mid) Sapphire/Onyx**.
- **Step 2 — Balance the top tier together.** The Radiant lever is **body HP** (validated as load-bearing);
  the Verdant lever is its **ramp/go-wide ceiling** (its big top-end + token multipliers). Nerf both, in
  small steps, validating each under the fair pilot.
- **Step 3 — Only then judge the floor.** If Sapphire/Onyx are still weak under a fair pilot, give them
  **bot-legible** payoffs (a finisher/burn the pilot understands), not more ignored engine pieces.
  Hero-LP normalization (25/30/33/35 → ~30–32) is a cheap, fair structural cleanup worth doing regardless.
- **Avoid:** nerfing Verdant alone (backfires, +11 pp), buffing floor stats on the heuristic's say-so
  (whack-a-mole), and further ARM/zone/Defender-rule tweaks (≤3 pp, some backfire).

**One-line:** the spread is a two-headed top tier (Radiant via body-HP/defense, Verdant via ramp) sitting
above a floor that is mostly an artifact of an un-pilotable control/recursion design — and it cannot be
diagnosed or fixed from the default bot's numbers, which mis-rank half the field.

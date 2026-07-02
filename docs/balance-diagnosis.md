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

---

## 7. Step 0 executed — the `fairPilot` measurement fix + A/B (2026-06-27)

Implemented an opt-in `fairPilot` mode (one `GameConfig` knob, default-off byte-identical no-op; both
pilots). It makes the heuristic value model recurse into wrapper effects and value recursion/tutor/ramp,
the reactive/mulligan policy card-advantage/curve aware, and the rollout pilot roll to game end (depth 0)
and fire threat-aware counters. A/B on the real decks (`packages/engine/balance-fair-ab.mjs`):

| Pilot / mode | Onyx | Radiant | Sapphire | Verdant | spread |
|---|---|---|---|---|---|
| heuristic OFF | 36.0 | 81.8 | 37.6 | 44.6 | 45.8 |
| heuristic ON | 33.8 | 81.7 | 39.6 | 44.9 | 47.9 |
| rollout OFF (depth-3) | 50.0 | 72.2 | 11.1 | 66.7 | 61.1 |
| **rollout ON** (depth-0 + counters) | 22.2 | 72.2 | **23.5** | **82.4** | 60.2 |

*(heuristic 4,000 games/config — tight CIs; rollout 60 games/config — directional only, ±~20 pp, turnCap 60.)*

**What this establishes:**
1. **Scoring the bot's spells correctly is necessary but not sufficient.** The heuristic A/B barely moves
   (45.8→47.9) — the heuristic is single-ply with no card-advantage-to-inevitability model, so it cannot
   *pilot* a control deck regardless of how it scores cards. Fairness has to come from the rollout.
2. **Sapphire's extreme floor was *partly* a measurement artifact.** Under the fair rollout it ~doubles
   (11→23%), confirming some of its weakness was under-piloting. But it stays low, so Sapphire is *also*
   genuinely weak and/or still imperfectly piloted (even depth-0 random playouts don't fully sequence a
   hard-control counter plan). This tempers §0's "mostly an artifact" — it's **partly** artifact, not wholly.
3. **The Radiant+Verdant top tier is REAL.** It persists under the fairest pilot we have, and Verdant
   *strengthens* to ~82% — i.e. the top-tier imbalance is not a bot bias. Verdant is plausibly THE dominant
   deck under fair play.
4. **The spread did NOT close (~60 pp).** Fixing the measurement did not reveal a balanced game — so balance
   changes are warranted, and the target is the **Radiant + Verdant top tier together** (nerf one alone and
   the other inherits the throne, per §5).

**Caveat:** depth-0 rollout is ~34 s/game, so the rollout A/B is a small-sample directional read; the robust
conclusions are the top-tier persistence and Sapphire's partial lift. Per-faction floor values (Onyx 22 vs
50) are within the noise band and should not be over-read.

**Net:** Step 0 did its job — it confirms the top-tier imbalance is genuine (not a pilot artifact) and
refines the floor (Sapphire was partly under-measured). The trustworthy next step is to balance the
Radiant+Verdant top tier under `fairPilot`, re-measuring after each change; judge Sapphire/Onyx only under
`fairPilot` (their OFF numbers understate them), and consider a still-stronger pilot or bot-legible payoffs
before concluding they need buffs.

---

## 8. Root cause — it is a PACING (rules/design) issue, not card tuning (2026-06-27)

Decomposing the spread under the trustworthy fair rollout (depth-3) and adjudicating "rules vs cards" with
two harnesses (`balance-diagnose-fair.mjs`, `balance-pacing-test.mjs`):

**Two systemic findings, both from controlled levers:**

1. **The hero-LP gradient is NOT the driver** (refutes an earlier hypothesis). Equalizing all heroes to 31
   barely moved the spread (66.7→61.9, within noise) and moved factions the *wrong* way (low-LP Onyx
   *gained* LP but *lost* win rate). The LP↔win monotonicity seen under the random bot was a long-grindy-game
   confound, not causation.
2. **The two strong decks are a *coupled* top tier.** Every lever that nerfs one board deck hands the crown
   to the other (Radiant cost-2+ −1 HP → Radiant 76→55 but Verdant 69→**83**; Verdant ×0.80 → Verdant 69→60
   but Radiant 76→**81**). The spread stays ~57–74 pp whichever one is hit — the signature of a systemic
   dynamic, not two independently over-tuned decks.

**The adjudicating experiment — move the tempo clock, change nothing else** (fair rollout, gap = (Radiant+
Verdant)avg − (Onyx+Sapphire)avg):

| clock | top avg | floor avg | gap | avg turns |
|---|---|---|---|---|
| slower (`lpScale 2`) | 80.5 | 19.4 | **61.1** | 47 |
| baseline | 73.6 | 26.4 | 47.2 | 39 |
| faster (`damageScale 1.6`) | 63.9 | 36.1 | **27.8** | 32 |
| go-long payoff (`resource_deck_empty_transform`) | 70.8 | 29.2 | 41.6 | 38 |

**The gap moves monotonically with game length** (61 pp @ 47 turns → 28 pp @ 32 turns), and a single global
*rules* knob (combat-damage speed) nearly halves the spread **without touching a card.** That is a
rules/design problem by definition.

**Mechanism: the game runs too long, which over-rewards SUSTAIN.** The strong decks are the sustain/long-game
decks that survive and take over late — Radiant (14 heal + walls + highest LP, a defensive grind) and Verdant
(ramp → bigger each turn). The weak decks lack sustain and are ground out before their plans mature — Sapphire
(no healing, fewest/flimsiest bodies) and Onyx (lowest LP). Shorten the game → less late-game for sustain to
exploit → the field compresses. (The go-long payoff did ~nothing and the slower clock made it *worse* — both
confirm the direction is "too much late game," not "too little.")

**Fix levers, evidence-ranked:**
1. **Speed up the clock** (higher base combat damage / smaller HP pools / faster resource curve) — the single
   biggest rebalancing lever found, a pure rules change touching zero cards.
2. **Rein in the sustain engines** the long game rewards — Radiant's healing density + wall HP, Verdant's ramp.
3. **Do NOT**: add go-long payoffs (no effect), flatten hero LP (no effect / wrong direction), or slow the game.

**Caveats:** small samples (±~18 pp; the length↔gap trend and ~20 pp swing are outside noise, individual cells
are not). Even fast games leave a **~28 pp residual** — pacing is the largest factor, not the only one;
Radiant/Verdant's raw sustain/stat edges sit on top of it. At depth-3 the floor is mainly *Sapphire* (Onyx is
middling/noisy); the clean 2-strong/2-weak split is sharpest under the faster pilots (random, depth-0).

## 9. Workshopped pacing changes tested — empty-deck transform + 10-card Resource Deck (2026-06-27)

Downstream of §8, testing two user-workshopped changes that target the late-game transform payoff and
resource pacing. The transform rule is a **condition, not a turn number**: *at a player's Upkeep, BEFORE the
resource draw, if their Resource Deck is empty ⇒ transform is available that turn* (engine: a `before-draw`
`resourceDeckEmptyAtUpkeep` flag, gated to `terminationMode: 'resource_deck_empty_transform'`; commit
`cfc1616`). A 4-config matrix (`balance-transform-test.mjs`, real decks, all-pairs, **fairPilot**) isolates the
transform payoff from the resource cap. `xform%` = fraction of heroes that transformed (validates the mechanic
fires; **0 would mean silently inert**).

| config | Onyx | Radi | Sapp | Verd | gap | turns | xform% |
|---|---|---|---|---|---|---|---|
| **heuristic + fairPilot (GPP=400, tight CIs)** | | | | | | | |
| baseline (15, turn_cap) | 33.8 | 81.7 | 39.6 | 44.9 | 26.6 | 31 | 61 |
| A: 15 + empty-transform | 35.1 | 80.0 | 40.5 | 44.4 | **24.4** | 31 | 74 |
| B-ctrl: 10, turn_cap | 31.6 | 82.6 | 38.8 | 47.1 | **29.6** | 31 | 60 |
| B: 10 + empty-transform | 40.9 | 79.4 | 37.6 | 42.1 | **21.5** | 30 | 96 |
| **fair rollout (depth-3, GPP=12, trustworthy — ±~18 pp)** | | | | | | | |
| baseline (15, turn_cap) | 44.4 | 77.8 | 8.3 | 69.4 | 47.2 | 39 | 41 |
| A: 15 + empty-transform | 38.9 | 75.0 | 11.1 | 75.0 | **50.0** | 39 | 72 |
| B-ctrl: 10, turn_cap | 33.3 | 83.3 | 13.9 | 69.4 | **52.8** | 40 | 35 |
| B: 10 + empty-transform | 55.6 | 86.1 | 13.9 | 44.4 | **30.5** | 40 | 91 |

(gap = (Radiant+Verdant)avg − (Onyx+Sapphire)avg, the §8 metric. A − baseline = transform @ 15; B-ctrl −
baseline = resource-cap @ 10 alone; B − B-ctrl = transform once it procs in time; B − baseline = combined.)

**Both pilots agree on direction; the rollout (which actually plays out ramp) shows the magnitude.**

1. **Scenario A (transform @ 15 cards) is inert** — gap +2.8 pp rollout / −2.2 pp heuristic, both within noise.
   The transform fires *more* (xform 41→72%) but a 15-card deck doesn't empty until ~turn 31 ≈ game's end, so
   the payoff lands too late to swing anything. Confirms §8's "go-long payoffs do nothing" result.
2. **The 10-card resource cap ALONE backfires** (B-ctrl − baseline = **+5.6 pp** rollout, +3.0 heuristic).
   Starving resources hurts the value/floor decks (Onyx, Sapphire) *more* than the resource-light aggressive
   top — the cap by itself *widens* the gap.
3. **Scenario B (10-card + transform) is the strongest single lever found** — gap **47.2 → 30.5 (−16.7 pp)**
   rollout, rivalling the §8 faster-clock knob. The active ingredient is **B − B-ctrl = −22.3 pp**: the
   transform comeback, once it procs in time (xform 91%, deck empties ~turn 21), is what moves the field. The
   cap's only role is *timing-enabler* — it makes the deck run dry early enough for the transform to matter.

**Mechanism — exactly the §8 prediction realized:** capping resources at 10 throttles **Verdant's ramp**
(69.4 → **44.4**, −25 pp — its snowball ceiling is gone), while the guaranteed ~turn-21 transform is a comeback
button that most rewards the lowest-LP grind-survivor, **Onyx** (44.4 → **55.6**, +11 pp). This is the pacing
thesis confirmed by a second independent lever: throttle the long game's resource engine + hand the loser a
clock-ending payoff → the late-game-sustain advantage shrinks.

**BUT — the honest catch: B reshuffles the tiers, it does not flatten the field.** The gap metric compresses
only because it is measured against the *old* §8 tiering, which B inverts:

| | tier order (rollout) | max−min spread |
|---|---|---|
| baseline | Radiant 78 > Verdant 69 > Onyx 44 > Sapphire 8 | 69.5 |
| **B** | Radiant 86 > **Onyx 56** > **Verdant 44** > Sapphire 14 | **72.2** |

Onyx and Verdant *swap* tiers, so "(Radiant+Verdant) − (Onyx+Sapphire)" shrinks mechanically — but the
pilot-agnostic **max−min spread is unchanged-to-slightly-wider (69.5 → 72.2)**. Two faults B does NOT fix:
**Radiant inflates** (78 → 86 — it is a heal-wall grind that needs no ramp, so the cap doesn't touch it, and it
absorbs Verdant's lost matchups) and **Sapphire stays broken** (8 → 14 — its floor is raw card weakness, not
pacing; §8's residual). B trades a Radiant+Verdant top for a **Radiant runaway**.

**Verdict.** The before-draw empty-deck transform is a clean, correct rule (kept as the gated knob), and
Scenario B is a genuinely powerful **pacing** lever that independently re-confirms the §8 diagnosis (resource
cap throttles ramp; comeback clock lifts the grind-survivor). It is **not a standalone balance fix**: to flatten
the field rather than reshuffle it, B must be paired with a **Radiant sustain nerf** (or Radiant runs away once
Verdant falls) and a **Sapphire card-power buff** (pacing never touches its floor). Use B for *pacing*; it does
not substitute for the two deck-level fixes §8 already flagged.

**Caveat:** rollout cells are ±~18 pp (small samples); read the cross-pilot agreement and the ~17–22 pp gap
swings, not individual faction cells. The heuristic compresses all magnitudes (it under-pilots ramp, so its
Verdant barely moves) — trust the rollout for the Verdant-collapse mechanism.

## 10. Closing the loop — re-simulating with the valuation-derived changes (2026-06-27)

Downstream of the card-power / deck-value valuation (`docs/balance-valuation.md`) and its outlier
suggestions (`docs/balance-suggestions.md`): apply those edits to the card data and re-run the sim to test
whether the static budget model's changes actually flatten the play-tested win rates.

**Method.** `balance-apply-edits.mjs` writes a modified card set with the suggested *primary* edits (the same
the before/after compare uses) — over-budget Characters get their formula-verified stat trim, under-budget
spells get their cost cut. `balance-resim.mjs` then runs the 4 starter decks all-pairs under fairPilot. The
BEFORE run reproduces the §9 heuristic baseline **exactly** (harness validation).

**Result (heuristic + fairPilot, GPP=400, all-pairs):**

| variant | Onyx | Radiant | Sapphire | Verdant | top−floor gap | max−min spread |
|---|---|---|---|---|---|---|
| before (baseline) | 33.8 | 81.7 | 39.6 | 44.9 | 26.6 | **47.9** |
| after — all 23 edits | 43.0 | 55.6 | 43.7 | 57.7 | 13.3 | **14.7** |
| after — 11 nerfs only | 41.5 | 57.0 | 44.5 | 57.0 | 14.0 | **15.5** |

**Two findings:**

1. **The valuation-derived changes cut the simulated spread ~70% (47.9 → ~15 pp)** and halve the top/floor
   gap (26.6 → 13.3). Radiant's runaway is reined in (82 → 56), the floor lifts (Onyx 34 → 43). The loop
   closes: the static budget model's mechanical edits genuinely flatten the play-tested distribution,
   corroborating the §8 pacing thesis (over-budget bodies are exactly the sustain/stat edge the long game
   over-rewards).
2. **The 11 over-budget nerfs do nearly all the work** (nerfs-only spread 15.5 ≈ all-23 spread 14.7). The
   tentative spell-buffs — the score's situational-value blind spot — are essentially redundant; adding them
   only nudges Onyx +1.5, and they push Verdant to the top. So the cautious, defensible half of the
   suggestions is the one that matters; the buffs can be skipped.

**Residual.** Not perfectly flat — Radiant/Verdant still edge Onyx/Sapphire (~14 pp vs the ≤6 pp §0 target),
and **Verdant rises (45 → 57)** because it carried *no* over-budget bodies, so nerfing everyone else's strong
cards relatively buffs it. A second pass (refit the budget on the edited pool → nerf the new outliers, now
Verdant's ramp/token engine) would tighten further. But **one round of mechanical, formula-derived edits
already moves the spread from "broken" (48 pp) to "playable" (15 pp)** — and it required no hand-tuning, only
the budget model + a re-sim.

**Caveat.** Numbers are the heuristic pilot — trustworthy for the before→after *delta* (both sides use the
same pilot and the before matches §9 exactly). The buffs being inert is itself the §8/valuation blind-spot
showing through: the static score under-rates those spells, so cost-cutting them barely moved the bots, and
the SIM (which plays them out) confirms they weren't the lever. _A fair-rollout (depth-3) cross-check was
attempted but is impractically slow on the full real decks (≫30 min/side at GPP=14); the heuristic delta
stands on the §9-validated baseline and a large, mechanically-sound magnitude._

### 10b. Adding hero-LP flattening (all heroes → 30) — the field lands inside target

Combining the card edits with flattening every hero's starting LP to 30 (Onyx 25→30, Radiant 35→30,
Sapphire 30, Verdant 33→30; heuristic + fairPilot, GPP=400):

| variant | Onyx | Radiant | Sapphire | Verdant | gap | spread |
|---|---|---|---|---|---|---|
| before (baseline) | 33.8 | 81.7 | 39.6 | 44.9 | 26.6 | 47.9 |
| **LP→30 only** (no card edits) | 42.6 | 77.6 | 41.0 | 38.8 | 16.4 | 38.8 |
| 11 nerfs only | 41.5 | 57.0 | 44.5 | 57.0 | 14.0 | 15.5 |
| **11 nerfs + LP→30** | 47.9 | 53.8 | 48.3 | 50.0 | **3.8** | **5.9** |
| all 23 + LP→30 | 48.4 | 53.3 | 46.8 | 51.5 | 4.8 | 6.5 |

**LP-flattening is the complement, not the lever** (refining §8). *Alone* it barely dents Radiant
(77.6 — the card-power runaway dominates regardless of LP), shaving the spread only 47.9 → 38.8. But
*stacked on the nerfs* it is decisive: **nerfs + LP→30 lands every deck at 48–54% — spread 5.9 pp, gap
3.8 pp, inside the ≤6 pp `balance-targets.md` goal.** Mechanism: the nerfs remove Radiant's card-power
edge, after which the residual gap *is* the LP asymmetry (Radiant +5 / Onyx −5 vs 30), so flattening it
closes the last ~10 pp. The two levers are orthogonal — card budget fixes the power runaway, LP flatten
fixes the survivability asymmetry — and together take the starter pool from a 48 pp spread (broken) to
~6 pp (at target), with no hand-tuning beyond "trim over-budget cards + set every hero to 30 LP."

### 10c. Lever matrix — which of the 13 past levers actually move the spread (2026-06-27)

`balance-matrix.mjs` screens the user's 13 levers against the win-rate spread, each solo and in stacks,
all via engine config knobs (the budget patch's nerfs are themselves a `cardStatOverride` knob built from
`computeSuggestions()`, so the card patch composes with the rules levers). 8 are pure rules knobs;
Radiant-−1HP / cheap-trim / Onyx-LP / Verdant-trim are stat/LP knobs; **Sapphire-wincon and
Onyx-recursion-payoff need *new cards*, so they run as a labelled stat-scale PROXY**. Heuristic +
fairPilot, real decks, all-pairs, GPP=300, baseline spread 47.4.

**Single-lever main effects, ranked by Δspread:**

| lever | spread | Δ vs baseline |
|---|---|---|
| **Radiant cost≥2 bodies −1 HP** | 21.1 | **−26.3** |
| Trim cheap over-budget bodies | 33.2 | −14.2 |
| −1 shield first instance/turn | 40.0 | −7.4 |
| Disable hero healing | 42.6 | −4.8 |
| Onyx recursion payoff *(proxy)* | 43.3 | −4.1 |
| Onyx starting LP 25→30 | 43.4 | −4.0 |
| First-player compensation (card+res) | 43.6 | −3.8 |
| Transform-gate widen | 44.0 | −3.4 |
| ARM buffs take max | 47.4 | +0.0 |
| LP tiebreak *(counterfactual: off)* | 47.4 | +0.0 |
| Defender only High Ground | 49.2 | +1.8 |
| Sapphire wincon *(proxy)* | 49.3 | +1.9 |
| **Verdant char stats ×0.85** | 58.6 | **+11.2** |

**Stacks:** PATCH (budget nerfs + LP→30) = **6.1 (−41.3)**; PATCH + transform-widen 6.8; PATCH + ARM-max
6.2; PATCH + shield-first 7.9; PATCH + Defender-HG-only **19.7**; PATCH + Verdant×0.85 **21.5**.

**Four conclusions:**

1. **There is one driver: Radiant's over-statted bodies.** The single most powerful lever by far is
   *Radiant cost≥2 −1 HP* (−26 pp) — a targeted version of what the budget model flagged. The next is
   *trim cheap over-budget bodies* (−14). Every decisive lever is a **direct nerf to the top deck's card
   power**; the full PATCH (which bundles those nerfs + LP flatten) dwarfs them all at −41 → 6.1 pp.
2. **Nerfing the wrong deck backfires.** *Verdant ×0.85* **widens** the spread +11 (Verdant is the *middle*
   at ~44 %, so nerfing it just hands Radiant the crown — Radiant 82→88). The lesson the matrix makes
   unmissable: **target the top, never the middle or the floor.** Floor-raise proxies (Sapphire/Onyx
   ×1.15) barely move it (±2–4) because they don't touch Radiant.
3. **The budget patch is essentially optimal; stacking more on top only hurts or does nothing.**
   PATCH+transform/ARM/shield ≈ PATCH (6–8 pp, no gain at the floor), while PATCH+Verdant×0.85 (21.5) and
   PATCH+Defender-HG (19.7) *break* it by over-nerfing or over-buffing Verdant.
4. **This is why the past piecemeal levers never closed the gap.** Most of them — ARM-max (0), LP-tiebreak
   (0), transform-widen (−3), first-player-comp (−4), disable-hero-heal (−5), shield-first (−7) — are
   individually weak because none hit the actual driver hard enough. The gap closes only when you nerf
   Radiant's card power directly (the budget model's contribution) and then flatten LP for the residual.

**Caveat:** GPP=300 (CI ≈ ±5 pp on spread); the ±0–4 cells are noise, but the −26/−14 movers, the +11
Verdant backfire, and the patch's −41 are well outside it. The two PROXY rows are stat-scale stand-ins,
not the real new cards — read them as "a generic Sapphire/Onyx power buff," which the matrix shows is the
wrong lever anyway (you must nerf the top, not buff the floor).

### 10d. Stacking rules levers ON TOP of the patch — none of the 7 help (2026-06-27)

`balance-matrix2.mjs` stacks 7 rules levers on the **patched baseline** (budget nerfs + LP→30, spread
5.9 pp — already at target), dropping Radiant-−1HP and trim-cheap as redundant with the rebalance.
Note: the baseline is **nerfs+LP30, not all-23+LP30** — the under-budget spell "ups" are redundant (§10)
*and* their cheaper spells make every game ~9× slower to sim (more casts/actions); nerfs+LP30 is
marginally tighter (5.9 vs 6.5) and sims at normal speed. Heuristic + fairPilot, GPP=400 for the cheap
levers; the **board-size levers are computationally explosive** (a larger board blows up the heuristic's
action/combat search — one row ran 25+ min at GPP=400), so they were sampled at GPP=12–60 (directional).

| lever stacked on the 5.9 patch | spread | Δ | verdict |
|---|---|---|---|
| + ARM buffs take max | 5.7 | −0.2 | inert |
| + ARM once per battle | 5.9 | +0.0 | inert |
| + transform-gate widen | 6.0 | +0.1 | inert |
| + first-player compensation | 6.6 | +0.7 | inert |
| + transform & FP-comp & ARM-once | 6.7 | +0.8 | inert |
| **+ Defender only High Ground** | 20.4 | **+14.5** | **re-breaks** |
| + High Ground size +1 *(directional)* | ~19–31 | +13…+25 | **re-breaks** |
| + Frontline size +1 *(directional)* | ~33 | +~19 | **re-breaks** |

**None of the 7 improves the patch; 4–5 are inert and 2–3 actively re-break it.**

1. **Inert (ARM-take-max, ARM-once-per-battle, transform-widen, first-player-comp):** all stay within ±1 pp
   of 5.9 — no effect. **Why:** once the card-power runaway and the LP asymmetry are removed, there is no
   residual imbalance left for a rules tweak to correct, so these levers have nothing to bite on. (ARM-once
   per battle is *literally* +0.0 — it changes no faction's win rate on the patched field.)
2. **Re-breaks (Defender-only-High-Ground, High Ground +1, Frontline +1):** each introduces a **new**
   asymmetry. Defender-HG-only frees the go-wide decks from blockers (Verdant 50→61, Sapphire 48→40 →
   spread 20). Bigger boards (HG/FL +1) disproportionately help the go-wide floor decks (Onyx balloons
   past 60), re-widening the spread +15–25 pp — they *do* speed games a touch (~28 vs 32 turns) but at the
   cost of balance.

**Bottom line for stacking:** don't. The card rebalance + LP→30 is sufficient and self-contained; every
one of these rules levers is either redundant-with-the-patch (inert) or introduces a fresh imbalance. The
lesson mirrors §10c — there's a single thing to fix (top-deck card power + LP), and once it's fixed,
extra global rules knobs only add noise or new skews.

**Caveat:** the board-size rows are small-sample/explosive (read them as "clearly re-breaks", not a
precise number); the inert cells are GPP=400 (CI ≈ ±4 pp), so their ±1 pp deltas are firmly noise.

### 10e. Game length (avg / median turns) — the rebalance changes *who wins*, not *how long*

Reporting both the mean and the median game length (all runs are **100 % decided** — no timeouts/draws —
so the median is the robust "typical game"; avg ≈ median + ~1, a small right-skew from a few grindy games).
**"Turns" = player-turns** — `turnNumber` increments once per side-switch (`passTurn`), starting at 1, so
a reported ~31 is ~31 *player-turns* ≈ **15–16 turns per player** (~15.5 full rounds), not 31 each:

| config | spread | avg turns | median turns |
|---|---|---|---|
| before (baseline) | 47.9 | 31.0 | 30 |
| nerfs + LP→30 (patch) | 5.9 | 31.9 | 31 |
| all-23 + LP→30 | 6.1 | 31.6 | 30 |

**The whole rebalance moves game length by ~1 turn.** Taking the field from a broken 48 pp spread to a
balanced ~6 pp one leaves the game ~31 turns long either way — the patch is a card-power/LP correction,
not a pacing change. **Nor do the rules levers touch length:** every fast lever sits at ~31–32 avg /
30–31 median (first-player-comp shaves ~1 turn). The **only** pacing lever is board-size (HG/FL +1),
which shortens games to ~27–29 turns — but that is exactly the lever that *re-breaks* the balance (§10d),
so there is no free lunch: the single knob that speeds the game also re-tilts the field toward go-wide.
(This refines §8: at the patched, balanced equilibrium the game length is stable ~31 turns and decisive,
so "shorten the game" is no longer a needed lever once the card-power runaway is removed.)

## 11. The pilot was the instrument — and it was miscalibrated (2026-06-28)

Everything in §0–§10 was measured through the heuristic pilot. Investigating one telemetry oddity —
the bot's `discard_for_energy` rate (~14/game) — exposed a flaw in that instrument big enough to
**invalidate the §10b "balanced" verdict.**

### 11a. The bot wasted 77% of its discards — a self-inflicted handicap

`discard_for_energy` grants **one temporary resource** (spend-it-or-lose-it, wiped end of turn), **once
per turn**, and the legacy pilot fired it as a blind last-resort gated only on `hand.length > 1` — no
lookahead that the +1 would unlock anything. Instrumenting every discard (did a resource-spending play
follow it that turn?) found:

| pilot | discards/game | **pure waste** | hand (early/mid/late) |
|---|---|---|---|
| legacy (blind) | 13.9 | **76–77%** | 3.2 / 1.4 / 1.6 |
| `reachDiscard` (fund a 1-short play only) | 1.4 | **0%** | 5.1 / 4.2 / 3.8 |

Near-identical waste on raw vs rebalanced cards ⇒ **a bot-policy flaw, not a card defect.** The
"hand-starvation" noted earlier was largely self-inflicted: the bot pitched ~10 needed cards/game. The fix
(`reachDiscard`, §11c) makes discard a funded reach — pitch one matching-type card only when a play is
short by exactly one resource and out-values the pitched card by a tempo margin.

### 11b. Fixing the pilot QUADRUPLED the measured spread — the patch is not balanced under competent play

| pilot (on patched + LP30) | Onyx | Radiant | Sapphire | Verdant | spread |
|---|---|---|---|---|---|
| legacy (reproduces §10b control) | 48.4 | 53.3 | 46.8 | 51.5 | **6.5** |
| `reachDiscard` | 38.8 | 57.3 | 45.2 | 58.7 | **19.9** |

The §10b 5.9 pp "balanced" result was an **artifact of a handicapped bot.** The blind discard (a) added a
symmetric handicap compressing everyone toward 50, and (b) specifically propped Onyx up: it pitched ~7
cards/player/turn into the bin, and **Onyx owns 4 of the 5 reanimation cards in the game** (Kaelthar
transform, Morgath, Grave Digger, Necrotic Revival; Sapphire's Ephemeral Cloak is the 5th). The bot was
free-fuelling Onyx's graveyard. Remove the waste and Onyx's recursion engine starves → it craters
48 → 39. Under competent play the patched decks are **~18–20 pp apart**, Onyx the floor, Radiant+Verdant
the ceiling. Every card-tuning conclusion drawn through the legacy pilot must be re-validated.

### 11c. Three pilot upgrades, and the standard we adopted

Behind config flags (default off ⇒ byte-identical baseline), validated by an A/B sweep (patched + LP30,
GPP=400):

| pilot | Onyx | Radiant | Sapphire | Verdant | gap | spread |
|---|---|---|---|---|---|---|
| `reachDiscard` (control) | 38.8 | 57.3 | 45.2 | 58.7 | 16.0 | 19.9 |
| + `exileDiscardForEnergy` | 39.2 | 57.8 | 44.7 | 58.4 | 16.1 | 19.2 |
| + `valuePilot` | 37.8 | 58.3 | 46.8 | 57.2 | 15.5 | 20.5 |
| + both (**adopted standard**) | 39.8 | 58.3 | 45.7 | 56.1 | **14.5** | **18.5** |

- **`exileDiscardForEnergy`** — discard exiles instead of binning, so the resource mechanic can't double
  as reanimation fuel. **Balance-neutral (+0.4 Onyx):** under `reachDiscard` only ~1.4 cards/game are
  discarded, so the subsidy is already gone. This **confirms Onyx's weakness is its real power level, not
  the discard pathway** (the bin fills from combat deaths regardless). Clean design fix; keep it.
- **`valuePilot`** — the heuristic ranks deploy and keep/pitch by the first-principles card-power +
  board/hero synergy engine (`src/balance`) on top of its heuristics. A **refinement, not a regime change**
  (≤1.6 pp): mostly Sapphire +1.6 (the control/value deck has the most synergy to exploit), Verdant −1.5.
- **Adopted standard = reach + exile + value** — the most faithful *and* tightest instrument (spread
  19.9 → 18.5, gap 16.0 → 14.5), now the default in `balance-{resim,trace,discard-probe}.mjs`
  (`NO_REACH` / `NO_EXILE` / `NO_VALUE` ablate).

**The structural verdict is stable:** Onyx ~40 floor, Sapphire ~46, Radiant+Verdant ~56–58 ceiling. The
re-tune target (§11d): buff Onyx, trim Verdant + Radiant; Sapphire is near-centered. Onyx's fix must be
real power (stats, or intrinsic graveyard fuel so its engine doesn't depend on opponent behavior) — not a
discard tweak, which §11c shows is balance-neutral.

### 11d. Re-tuned under the standard pilot — spread 19.5 → 6.0 with 15 surgical edits (2026-06-28)

Re-tuning against the standard pilot converged in four rounds (`balance-faction-tune.mjs`, applying flat
character-stat deltas to the top-N marquee bodies of a faction on top of the budget patch + LP30). The
calibration finding dominated the method: **faction-power is an extreme lever** — a flat ±1 across a whole
faction swings 25–50 pp (Onyx +1/+1 ×13 → **92%**), and even +1 on the top-8 swings +8 to +38 pp (§11e). So
the patch is a *handful of surgical edits*, not a faction-wide rescale. Win rates are relative, so nerfing
the Radiant+Verdant ceiling lifts the Onyx+Sapphire floor for free.

**Converged patch (r4), on top of the budget edits + LP→30:**

| faction | edit | cards |
|---|---|---|
| Radiant | **−1 HP** | Heavenly Knight, Radiant Angel, Archon of Order Uriel, Cleric of Dawn, Archon's Guardian |
| Verdant | **−1 ATK** | Ancient Treant, Guardian Spirit MK-III, Biosteel Golem, Pneumatic Gorilla |
| Onyx | **+1 HP** | Carrion Queen, Zombie Horde, Grave Digger, Soulflay Necromancer |
| Sapphire | **+1 HP** | Arcane Guardian, Master Archivist |

| field (GPP=400, standard pilot) | Onyx | Radiant | Sapphire | Verdant | spread |
|---|---|---|---|---|---|
| budget patch + LP30 (no re-tune) | 40 | 60 | 45 | 56 | 19.5 |
| **+ r4 re-tune** | 46.8 | 48.1 | 52.4 | 52.8 | **6.0** |

15 edits take the field from a 19.5 pp gap to 6.0 (at target), all factions 46.8–52.8. Residuals are ±3 pp,
inside GPP=400 noise (±~1.5 pp), so this is the lock point — pushing lower would chase noise. Note Onyx was
buffed via HP, not ATK, deliberately: §11e shows Onyx is so ATK-sensitive (+38 pp) that an ATK buff would
wildly overshoot — HP is the controllable knob.

### 11e. Why stat tweaks swing so hard — the breakpoint isolation (2026-06-28)

Isolating a single stat (+1 on a faction's top-8 bodies, standard pilot, GPP=250), measured as that
faction's own win-rate lift:

| faction (baseline) | +1 HP | +1 ATK | +1 ARM |
|---|---|---|---|
| Radiant (60) | +10.1 | +8.6 | **+16.1** |
| Verdant (56) | +12.1 | +8.1 | — |
| Onyx (40) | +15.2 | **+38.1** | — |

**The sensitivity is a game-dynamics property, not a valuation error.** Stats matter most at *trade
breakpoints*: a 3/3 into a 3/3 is an even trade; a 3/**4** survives AND kills it — an even trade becomes a
2-for-1 with a surviving threat, and the survivor snowballs. Four amplifiers make ours extreme: low base
stats (a +1 is a +25–50% relative change), **binary breakpoint mechanics** (ARM/shield reduce flat → hard
0-damage thresholds), symmetric mirror-heavy fair-pilot eval (a stat edge is pure and uncountered), and a
grindy ~31-turn combat meta (edges compound dozens of times).

Findings:
- **ARM is the sharpest per-point knob** (Radiant +16.1 for +1 ARM, ~1.6× HP, ~1.9× ATK) — it's the one
  truly binary stat. It is the highest-leverage rule target if the game should be *de-swung*.
- **HP-vs-ATK is faction-dependent — by *bottleneck*, not "aggro vs control."** Onyx is wildly ATK-bound
  (+38: its win condition is closing/trading, and as the weakest faction it has the most headroom);
  Radiant and Verdant are HP ≥ ATK. There is no universal answer to "does HP swing as much as ATK."
- **Sensitivity concentrates on small/mid bodies near breakpoints**, not the biggest ones: −1 HP on
  Verdant's three largest bodies moved nothing (already above any breakpoint), while +1 HP across its
  top-8 (which reaches the trade-relevant range) was +12 pp.

Design implications: (a) the swing is *contextual* (breakpoints vs the opposing board), so re-weighting the
*static* card-power formula cannot fix it — keep using the **sim** for win-rate balance; (b) `W_ARM = 1.3`
arguably under-weights ARM relative to its ~1.6× in-game impact, a defensible small tooling bump for card
ranking only; (c) if the swinginess itself is undesirable, **soften ARM's breakpoint first** (fractional or
capped reduction) and re-measure — it is the disproportionate contributor.

### 11f. Fitting the *narrowed* budget window is a diagnostic, not a mandate (2026-06-28)

After tightening the budget window (`RMSE_MULT` 0.9 → 0.6, ±3.4 → ±2.2 — `balance-data.mjs`), we asked
what a full re-fit to it would do. Answer: **it perfects the budget and breaks the balance.**

- **Budget fit (Phase 1).** One `applyEdits(baseline,{mode:'all',flattenLp:30})` pass lands **64/64**
  starter cards within ±2.2 (measured vs the fixed window). Iterating *past* one pass overshoots — the
  model re-fits a shrinking window each pass and chases it (pass 1–2 = 64 within, pass 5 = 53), so **one
  pass is the fit.** (`balance-refit.mjs`.)
- **Win-rate (the experiment).** Re-simulated under the standard pilot (GPP=20, noisy ±~7 pp but
  unambiguous):

  | tight-window set | Onyx | Radiant | Sapphire | Verdant | spread |
  |---|---|---|---|---|---|
  | budget-fit (`mode=all`, 38 edits) | 50 | **27** | 53 | **71** | **43.6** |
  | nerfs-only (`mode=nerfs`, 15 trims) | 53 | 42 | **35** | **70** | **35.0** |
  | *§11d re-tune (reference, GPP 400)* | *47* | *48* | *52* | *53* | ***6.0*** |

  The pure budget-fit takes the spread from a tuned **6.0 to 35–44** — far *worse* than doing nothing.

- **Why.** The §11 budget-vs-win-rate gap, amplified: (1) the budget can't see **Verdant's ramp/value
  engine**, so it never nerfs Verdant's real strength — trimming everyone *else's* over-budget bodies just
  lifts Verdant to ~70 in *both* sets; (2) the under-budget "buff" lever is **cost cuts**, which over-buffs
  the blind-spot spells the static score under-rates (the doc's own "verify it's actually weak, don't
  auto-buff" warning) — and the 23 cheap spells also make the sim **~10× slower** (more affordable plays
  per turn; game length stays normal ~28 turns, so it is per-turn compute, not stalls); (3) the tighter
  window **over-trims** Radiant/Sapphire bodies.

**Conclusion.** The narrowed window is a good **diagnostic** (it flags ~40% more outliers — 38 vs 23 — for
human review) but a poor **mandate**: mechanically editing every card onto the line fights win-rate
balance. The arbiter remains the **sim** (§11d's targeted, sim-guided re-tune to 6.0 stays the balance
baseline); the budget audit narrows *where to look*, not *what the answer is*. This is exactly why the
scalability toolkit pairs the static audit with the gauntlet/sim rather than trusting the budget alone.

---

## 12. The spread, decomposed — what causes it, what measures it, what no formula sees (2026-07-02)

The question, precisely: **what causes the measured spread on the CURRENT pool** (sha `6928b4ab3b7ef915`;
heuristic says 14.3 pp, rollout-high says 62.5 pp — see balance-targets.md §7), decomposed into
(A) measurement/pilot error, (B) game-rules design, (C) card balance a power formula should catch,
and (D) what no formula can capture. Everything below is anchored to verified runs (§7, §8, both
runHash-authenticated) plus static tests run against the sha-verified pools.

### The one-paragraph answer

The CURRENT pool's *real* spread under the strongest trustworthy instrument is dominated by **two
concentrated card/system defects**: Sapphire ~33 pp below par (no win condition — proven real AND
proven fixable by §8's redesign experiment, which moved it +51 pp) and Verdant ~29 pp above par
(ramp/snowball engine — ratified by the archetype-blind rollout, so it is NOT a pilot artifact;
exact converged magnitude pending the ladder batch). Radiant and Onyx are approximately fine under
strong play. The *disagreement between instruments* (14.3 vs 62.5 pp) is measurement, not reality:
the heuristic's biases — pro-stat-wall, anti-engine — happen to compress the true extremes
(it overrates weak-vs-strong-play Radiant by ~+8, underrates Verdant by ~−25, overrated
pre-redesign Sapphire by ~+26 relative to rollout). Rules-design contributes little to the residual
spread: the big rules wins (LP flatten, transform gates, discard hygiene) are already banked into
CURRENT, first-player advantage is neutralized by protocol and healthy in mirrors (+2.8 pp), with
one open probe (the discard-for-energy valve). The per-card budget formula already caught what it
can catch (the 30-edit patch: heuristic spread 44.5→14.3, Radiant/Onyx fixed at rollout); what
remains is dominated by dynamics that per-card — and to a large extent per-deck — formulas
structurally miss, so the formula's role is *screening and candidate generation*, and the verdict
instrument is the converged pilot panel.

### Bucket A — measurement / pilot error

**A1. Systematic heuristic bias (the dominant measurement term).** Per-faction heuristic-vs-rollout-high
disagreement on CURRENT: Verdant 54.3 vs 79.2 (Δ+24.9), Sapphire 42.7 vs 16.7 (Δ−26.0), Onyx 45.6
vs 55.6 (Δ+10.0), Radiant 57.0 vs 48.6 (Δ−8.4). Mechanisms (documented §3 Layer E, §11): the scorer
has no model for card-advantage→inevitability, values ramp at ~0 in deploy ranking (cost-free
per-card score — same blindness the deck formula's `acceleration` term patches), counters at 0.5,
recursion flat 1. **Instrumented this session:** `rampPilot` (GameConfig knob, default off,
byte-identical no-op proven via runHash `a576f66296c4c11f`) adds the acceleration analogue to the
deploy ranking; `HEUR_RAMP=1` in balance-verify.mjs runs heuristic and heuristic+ramp on the same
seeds so the delta IS the measured ramp-blindness component. Pending: the batch below.

**A2. Reference-instrument uncertainty.** The rollout is archetype-blind (random playouts — verified:
`playoutPolicy ?? 'random'`, no heuristic contamination) but (i) n=72/faction ⇒ ±11–12 pp CIs, and
(ii) NOT converged for Verdant (65.3 → 79.2 rising with budget; §4's gate says "undetermined —
needs stronger play"). Instrumented: third rung `RX_GPP` (r12 d3 c8). Pending: the batch.

**A3. Data integrity (a fifth cause outside the four buckets — it has happened four times).**
Three measurement bugs were found and fixed mid-investigation (faction-scoped re-tune, missing
sim flags, missing `--realDecks`), and one data defect is STILL OPEN: Grovekeeper 3000 (id 142) is
an all-zero stub — 3 dead cards (7.5%) in the tested Verdant deck. Verdant posts its numbers with a
handicap, so its too-strong verdict is a *floor*. Fix pending: DB regeneration
(`sim-data/generate-from-dump.py`, needs the CMS row completed first).

**Verdict-trust rule that falls out of A:** on the redesign pool all strong pilots agree on #1
(Sapphire) — that verdict is instrument-robust. On CURRENT they disagree on #1 (heuristic: Radiant;
rollout: Verdant) — so CURRENT's exact ordering is partially measurement-limited until the ladder
converges; its EXTREMES (Sapphire floor, Verdant ceiling) are already agreed by all instruments.

### Bucket B — game-rules design

- **First-player advantage: not a spread cause.** Neutralized by alternating + marginals; mirrors
  measure it at +2.8 pp under competent play (PASS, third consecutive run on the 17Lands anchor).
  Notable rules property: at random play it is +8.75 pp — initiative is strong under bad play and
  competent play erases it. A curiosity, not a defect.
- **Already banked into CURRENT:** hero-LP flatten (was −6.6 pp of spread), resource-deck-empty
  transform gate (−5.0), ARM-first-instance (−0.7), discard hygiene (`exileDiscardForEnergy`,
  `reachDiscard` — §11a–c). Historic rules levers beyond these were small or backfired (§3 Layer A).
- **One open rules asymmetry, now instrumented:** `discard_for_energy` — hypothesized here as a
  de-facto Verdant-only valve ("Energy only pays Energy costs"). **That premise was wrong**: the
  executor grants a resource *matching the pitched card's type* (Rulebook 11 — the action's name
  understates it), so the valve is universal. The probe measured what it actually does — see §12a.
  Probe: `balance-probe-denergy.mjs` (identical config except the ablation bit; arm-A runHash
  reproduces the standard reference exactly).
- **Defender-forcing (deliberately NOT re-probed):** §3C measured ablating it at −15.7 pp in the
  raw era, but post-patch Radiant is ~50 under strong play — the mechanic inflates Radiant only
  against weak play (a bucket-D skill-conditional effect, not a rules defect to fix). Nerfing it
  now would overshoot the balanced-at-strength Radiant.

### Bucket C — card balance a formula should catch (and whether to tweak the formula)

**What the per-card budget DID catch:** the additive, gross component. The 30-edit budget patch took
heuristic spread 44.5 → 14.3 and fixed Radiant (73.3 → 48.6) and Onyx (40.0 → 55.6) at rollout-high.
That is the formula working exactly as intended.

**What it structurally cannot catch — proven twice, in both directions:**
1. §11f: *mandating* the budget (fit all 64 cards to the line) breaks balance (spread 6 → 35–44).
2. §8: the Sapphire redesign **passes the budget while playing at 60–72%** — refit on the redesign
   pool itself, only 2 of 11 redesigned cards sit marginally over the line and Spellbound Adept
   grades *under*; the sim refutes it by ~+30 pp. Mechanism: engines (spells-matter web on stale
   cost discounts) are invisible to per-card, cost-conditioned pricing.

**The deck-level formula (with this session's `acceleration` + synergy terms) — tested today against
all three measured pools** (Spearman vs rollout-high): raw ρ=0.80, CURRENT **ρ=0.00**, redesign
ρ=0.40. On CURRENT it puts Verdant (79.2% actual) and Sapphire (16.7% actual) **2.1 points apart**
out of ~200, and ranks Radiant #1 by +65 while Radiant plays at 48.6. Systematic bias direction:
**overvalues reactive stat-power, undervalues engine/tempo power** — precisely the axis separating
weak-play outcomes from strong-play outcomes. The formula explained the raw pool because raw
imbalances were additive stat/cost errors; after the patch compressed those, the residual is
dominated by the dynamics it is worst at.

**Should the power calc be tweaked? Split answer:**
- **Per-card budget: no.** Keep it as a gross-outlier gate and trim-candidate generator (its two
  proven wins), never as a verdict or a mandate (its two proven failures).
- **Deck-level: bounded improvements are possible but must be falsifiable, not fitted.** With only
  4 decks × 3 measured pools = 12 anchor points, re-weighting to match sims is memorization.
  Protocol adopted instead: any formula change must **pre-register a prediction** for the next pool
  variant (e.g. predict the Sapphire-v2-trim panel BEFORE it is run) and is judged on that. Candidate
  improvements, in evidence order: (i) a *closure/threshold* term (can the deck convert advantage
  into lethal? — the exact thing §8 changed), (ii) magnitude recalibration of acceleration/synergy
  (currently ~10% of deckValue; the §8 experiment moved win rate ~51 pp on a ~10% deckValue change),
  (iii) a skill-reference declaration (the formula predicts *converged-play* value, not
  weak-play value — Radiant's punish-value is out of scope by definition).

### Bucket D — what no formula of the cards can capture (provable limits)

1. **Skill-conditional value.** The same Radiant deck measures 80.7 / 57.0 / 52.8 / 48.6 as the
   opponent policy strengthens. Win rate is a property of the *joint policy distribution*, not of
   the decklist alone; a deck-text formula outputs one number and cannot output the curve. The
   resolution is a convention, not a formula: we DEFINE balance at converged archetype-blind play
   (§4's ladder), and §12's decomposition is stated relative to that reference.
2. **Threshold discontinuities.** §8: a ~10% deckValue change produced a +51.4 pp win-rate change —
   "can close a game" is a cliff, not a slope. Smooth additive scores cannot represent cliffs; only
   playing the games finds them.
3. **Pairwise (matchup) structure.** Best-scalar check on the CURRENT heuristic matrix (Bradley-Terry
   odds model calibrated on the marginals): residuals up to **±7.9 pp** per cell (Radiant→Verdant
   44.8 actual vs 52.7 scalar-predicted; Verdant→Sapphire −6.4; Sapphire→Verdant +6.4). Four per-deck
   scalars mathematically cannot encode six independent pairwise cells; matchup polarization is
   irreducibly relational. (A pairwise formula could — but fitting it IS measuring the matrix.)
4. **The integral itself.** Expected win rate is an average over draw orders, mulligans, and
   trajectory branches. The simulator is that integral's estimator; any static formula is a model of
   it. "Complexify the formula until it captures everything" converges, literally, to re-implementing
   the simulator. The practical boundary: formulas screen (cheap, per-card/per-deck, explain WHY),
   sims verdict (expensive, exact, explain THAT).

### Composition of the 62.5 pp rollout-high spread on CURRENT (pending batch confirmation)

| Component | Size (pp of spread) | Bucket | Status |
|---|---|---|---|
| Sapphire's missing win condition | ~33 below par | C (system-level card design) | PROVEN real + fixable (§8: +51 pp); v2 trim staged |
| Verdant's ramp/snowball engine | ~29 above par (floor: 3 dead cards) | C (system) ± B (energy valve) | Real per all pilots; converged size + valve share pending batch |
| Radiant / Onyx residuals | ~5–6 combined | C (minor) | Inside/near target; watch |
| Heuristic-vs-rollout gap (14.3 vs 62.5) | measurement, not balance | A1 | rampPilot A/B quantifies the ramp share |
| Rules-design residual | ~0 known + 1 open probe | B | denergy probe pending |

### The batch that pins down the pending numbers (run locally, commit `10380ea`+)

All three items are deterministic and runHash-verifiable; nothing here changes any default behavior.

1. **Instrument panel on CURRENT** — pilot A/B + convergence ladder + tighter CIs, one command:
   `HEUR_RAMP=1 RX_GPP=32 GPP_MATRIX=3000 RL_GPP=96 RH_GPP=48 AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json GAUGE_OUT=./bv-CURRENT-ladder.json node balance-verify.mjs`
   Reads: heuristic+ramp − heuristic deltas (A1's ramp share); rollout-low/high/max trend for
   Verdant (converged or still rising); ±5–6 pp rollout CIs.
2. **Discard-for-energy ablation on CURRENT** (bucket B's open probe):
   `AETHERION_CARDS=./generated-pools/aetherion-CURRENT.json GPP=2000 node balance-probe-denergy.mjs`
   Reads: per-faction delta of removing the valve; Verdant's share of it.
3. *(Optional, remediation not diagnosis)* the Sapphire v2 trim panel once the trim numbers are
   approved — and per bucket C's new protocol, the deck formula's prediction for it will be
   pre-registered before the run.

### 12a. Batch results — the pending numbers, measured (2026-07-02)

Batch run externally on commit `fe456cd` tooling (ladder: `HEUR_RAMP=1 RX_GPP=32 GPP_MATRIX=3000
RL_GPP=96 RH_GPP=48`; probe: `GPP=2000`), both on the sha-verified CURRENT pool. The ladder's
random and heuristic legs reproduce §7's marginals exactly (same seeds — internal re-validation).

**A1 — the ramp-deploy hypothesis is REFUTED (a clean null).** `heuristic+ramp` vs `heuristic`
on identical seeds flipped **2 games out of 30,000** (Verdant 54.28 → 54.31, +0.02 pp; every other
cell byte-identical or ±1 game). The heuristic's ~20 pp Verdant underrating is NOT a deploy-ranking
failure: Verdant's ramp bodies were already being deployed (they have deployable stats; the bonus
of ≤ ~2.8 rarely reorders anything). The remaining instrument bias is plan-level (sequencing,
attack/hold policy, what to do WITH the ramp) — the kind of behavior a local scoring bonus cannot
buy. Consequence, adopted as policy: **stop trying to patch the heuristic toward strong play.** Its
role is cheap relative deltas on like-vs-like comparisons; verdicts come from the rollout ladder.

**A2 — the ladder is rank-stable; magnitude convergence is provisional at these n** *(see the
caveat below — the first version of this section overclaimed "converged")*.

| rung | n/faction | Onyx | Radiant | Sapphire | Verdant | spread |
|---|---|---|---|---|---|---|
| r4 d2 c5 | 288 | 57.3 | 54.5 | 22.2 | 66.0 | 43.7 |
| r8 d3 c8 | 144 | 54.2 | 50.0 | 19.4 | 76.4 | 56.9 |
| r12 d3 c8 | 96 | 52.1 | 51.0 | 25.0 | 71.9 | 46.9 |
| **pooled r8+r12** | **240** | **53.3** | **50.4** | **21.7** | **74.6** | **52.9** |

Rank order identical on every rung, and the EXTREME verdicts are CI-robust (Verdant's lower bounds
clear 57% at r8 and r12; Sapphire's upper bounds clear 43% at every rung) — those two verdicts
stand at any plausible resolution. **Honest caveat (added after review): the magnitude-convergence
claim is weaker than first stated** — "r8 and r12 agree within CIs" at n=144/96 means CIs of
±8–12 pp, wide enough to hide real movement (Verdant 76.4 vs 71.9 is compatible with anything in
~66–80). Point estimates like "74.6" carry ±~5.5 even pooled. The high-n diagnostic rerun (§12c
batch: r8 at n≥450, r12 at n≥300, with per-cell mechanism evidence) is what settles magnitudes;
until then treat the pooled row as the best current estimate, not an established constant.
Final instrument-bias table (heuristic − converged): Verdant −20.3, Sapphire +21.0, Onyx −7.7,
Radiant +6.6 — the compression pattern §12 predicted, now quantified.

**B — the discard-for-energy result, with the corrected mechanism.** 20k games/arm; removing the
rule moves (ON→OFF): Onyx 44.66→41.81 (**the rule helps Onyx +2.85 pp**), Radiant 58.23→56.98
(+1.25), Sapphire 42.42→46.40 (**the rule HURTS Sapphire −3.98 pp**), Verdant 54.37→54.71 (−0.34,
null). Root cause of the wrong hypothesis: the action is misnamed — `executeDiscardForEnergy`
grants +1 of the pitched card's OWN resource type (Rulebook 11), so every faction can use it. What
it actually is: a **universal surprise-tempo valve** — reach/aggro finishers convert the once-per-
turn +1 into extra lethal pushes (Onyx, Radiant), and the deck that wants long games and gets burst
through pays for it (Sapphire). Verdant neither needs nor abuses it. Net spread effect ≈ −0.6 pp
(15.8 → 15.2): **not a spread cause**, but a real ~4 pp lever on Sapphire specifically — worth
remembering when fine-tuning the post-redesign Sapphire (turning the rule off is worth about +4 pp
of Sapphire at heuristic level, a bigger single lever than most card tweaks).

### 12b. Composition — best current estimates (magnitudes provisional pending §12c)

Sizes below carry ±~5 pp CIs and the A2 caveat; the SIGNS and ranks are CI-robust, the exact
magnitudes are not yet. The §12c high-n diagnostic rerun replaces this table with tight numbers
AND per-cell mechanism evidence (the first version of this section presented these point estimates
as settled — they are estimates). **→ §12c has since run: measured values are Verdant 73.4
[70.6–76.2], Sapphire 19.7 [17.3–22.3], Onyx 54.8, Radiant 52.1 (Sapphire-subsidized) — read §12c
for the final numbers and the two new findings (the Radiant subsidy, the Echoes×Robe loop).**

| Component of the ~53 pp strong-play spread (est.) | Size (est.) | Bucket | Evidence |
|---|---|---|---|
| Sapphire: no win condition | **~−28 pp** below par | C (system-level card design) | all pilots agree; §8 redesign moved it +51 pp — fixable, staged (v2 trim) |
| Verdant: ramp/snowball engine | **~+25 pp** above par (a floor — 3 dead Grovekeeper cards) | C (system) | archetype-blind rollout, rank-stable, CI-clear of 57 at r8+r12 |
| Onyx / Radiant residuals | ~+3 / ~0 pp | C (minor) | inside targets — watch |
| Heuristic-vs-rollout gap | measurement only | A1 (plan-level bot bias) | ramp-deploy share measured ≈ 0; compression pattern quantified |
| Rollout noise/convergence | rank settled; magnitudes ±5 pp | A2 | §12c batch tightens to ±3 pp with mechanism detail |
| Rules design | ~0 net (denergy ≈ −0.6 pp spread; ±4 pp Sapphire lever) | B | probe measured at 20k games/arm; big rules wins already banked |
| First-player | 0 (protocol-neutralized; +2.8 pp mirrors, PASS) | B | three consecutive runs on the 17Lands anchor |
| Data integrity | Verdant understated (unquantified until DB regen) | A3 | Grovekeeper stub ×3 still in deck |

**The §12 question, answered in one line each:**
- *Measuring error due to pilot imperfection?* — Yes, huge BETWEEN instruments (it compresses ~53 pp
  to 14 pp at heuristic level), quantified per faction; the verdict instrument (rollout ladder) is
  rank-stable with CI-robust extremes, magnitudes still ±5 pp pending §12c.
- *General game rules / setup favoring X?* — No. Every measured rules term is ≤ ~1 pp of net spread
  today (the big rules fixes are already in CURRENT); first-player is healthy; the one suspicious
  rule turned out to be a universal valve with a −4 pp Sapphire side-effect, not a faction subsidy.
- *Card balance the power calc should catch?* — The additive part, yes — and it already did (patch:
  44.5 → 14.3 heuristic, Radiant/Onyx fixed). The remaining 53 pp is TWO system-level design gaps
  (Sapphire lacks closure, Verdant's engine compounds) that per-card budgets provably pass (§8) and
  the deck formula currently misranks (ρ=0.00 on CURRENT). Tweak policy: per-card budget stays a
  gate/generator; deck-formula changes only under pre-registered prediction (first test: Sapphire v2).
- *Something no formula can capture?* — Yes, four proven limits (skill-conditional value, closure
  cliffs, pairwise matchup structure, the trajectory integral) — which is exactly why the pipeline is
  formula-screens → sim-verdicts, and why the rollout ladder, not a richer formula, is the arbiter.

### 12c. High-n mechanism run — magnitudes settled, one degenerate combo found (2026-07-02)

The §12b "provisional" caveats are now resolved by the high-n run (rollout n/faction: 900 / 600 /
360; 100–300 games per matchup CELL; full mechanism diagnostics from commit `d3a8412`'s reporting
layer). Random/heuristic legs reproduce §7 byte-for-byte (same seeds).

**Magnitudes (pooled r8+r12, n=960/faction):** Verdant **73.4 [70.6–76.2]**, Onyx **54.8
[51.6–57.9]**, Radiant **52.1 [48.9–55.2]**, Sapphire **19.7 [17.3–22.3]** — true strong-play
spread **~53.7 pp**. Convergence, properly: Verdant genuinely RISES r4→r8 (67.2 vs 74.3, CIs
disjoint — the low-budget rollout underrates ramp), then r8→r12 is flat (74.3 vs 71.9, CIs nested).
Sapphire is flat across all three rungs. The §12b estimates survived (+/−1.5 pp) — now they are
measurements.

**The subsidy finding (new — only visible with per-cell rollout data).** Radiant's "healthy" 52%
is **Sapphire-subsidized**: it farms Sapphire at 82% while losing 20–29% to Verdant. Excluding all
Sapphire cells, the 3-faction field reads **Verdant 69.3 / Onyx 44.0 / Radiant 36.8**. Every
faction feasts on Sapphire (70–84% cells), so fixing Sapphire will DROP everyone else's marginal,
Radiant's most. **Pre-registered matrix-carryover prediction for the post-Sapphire-fix panel**
(assumes non-Sapphire cells hold, as §8 demonstrated for matrix pilots): Verdant ~65, Sapphire ~50
(by construction if the fix lands), Onyx ~46, Radiant ~41. If that run shows Radiant near 41,
"Radiant is fine" was an artifact of a broken opponent — judge the prediction then.

**Mechanism evidence (per-faction detail, rollout rungs, stable across r4/r8/r12):**
- *Verdant's engine is real and visible*: resource development 3.2 / 8.1 / 13.9 by turns 5/10/15 —
  **+41% over Radiant/Sapphire at turn 10** and the gap widens; highest early deploys (2.4/game vs
  Sapphire's 0.94). And the compounding signature: when Radiant LEADS Verdant at turn 10, Verdant
  still wins **57–60%** of those games (the only cells where the turn-10 leader is a favorite to
  LOSE, consistent on every rung) — early leads do not stick against ramp payoff.
- *Sapphire is dominated, not "close but can't close"*: lowest early development, longest games,
  and 100% of its rollout losses are KILLS with the winner at median 19–26 of 30 LP — opponents
  finish barely scratched. It also transforms the MOST (79–81%) and LATEST (turn ~33) with the
  worst transformed win rate (~33%) — the hero flip is not a comeback mechanism for it.
- *Transform system, generally*: transformed win rates run far below untransformed for
  Radiant/Verdant (~38–50 vs ~72–84) — mostly selection bias (transform triggers when losing or
  late), but the design-relevant read is that transformed sides RESCUE almost nobody: no faction
  except arguably Onyx (T 51–55% vs N 48–60%) converts the flip into wins.
- *First-player, resolved*: rollout mirror FP = 50.6 / 54.0 / 50.6 across rungs — the earlier
  58.9/64.6 readings were small-n noise, as suspected. One watch item: Onyx mirrors pooled ~62%
  FP (n≈620) — the grindy Onyx mirror rewards initiative.

**The degenerate combo (found BY the new reporting, then verified by hand).** The heuristic
Sapphire row showed an impossible `earlySpellsPerGame: 344.87`. Traced: ~7–9% of every
Sapphire-involving heuristic cell (205–490 games per cell) ends as a step-cap abort with **up to
7,990 casts of Arcane Echoes in one game** (worst case: turn 4). Verified causal chain, each link
checked in a captured game:
1. The §7 budget patch mechanically cut **Arcane Echoes 5 → 1 mana** (under-budget "buff" lever).
2. **Wizard's Robe** ("Arcane spells you cast cost 1 less Mana") has **no minimum-1 floor** — the
   designers DID floor Lyria's own discount ("minimum 1"), the Robe just predates the danger.
3. Echoes' effect (`copy_card` from discard, filter Arcane spell) can select **itself**; the copy
   preserves cost 1 + the Arcane tag (verified on a live copy: `{mana:1}, isToken, tags:[Arcane]`).
4. Robe in play ⇒ the copy casts for **0** ⇒ cast → recopy → cast… until the 8,000-step cap voids
   the game as an undecided draw.
Impact: heuristic-only (the rollout does not take the bait — looping never wins a playout — so all
rollout verdicts are clean). It voids ~7–9% of Sapphire's heuristic games (inflating `timeoutPct`
17.7%, shortening measured p25 lengths to 11–17, and explaining §11f's "Sapphire sims ~10× slower"
note). **Fixes, pending approval (CURRENT stays byte-frozen until then):** (a) next pool revision
reverts Echoes toward 3 mana — already the §8 v2-trim number; (b) card-design fix: Robe needs
"minimum 1" like Lyria's; (c) systemic: `applyEdits` should run the balance core's EXISTING
loop-detector (`detectCardLoops`) on the post-edit pool and veto/flag any edit that creates a loop
risk — §11f's "don't auto-buff blind-spot spells" warning now has its concrete catastrophe.

**Bottom line vs §12b:** composition unchanged in shape, now measured: Sapphire **−30.3 pp** below
par and Verdant **+23.4 pp** above par ARE the spread; Onyx +4.8 (watch), Radiant +2.1 — but
Radiant's number is Sapphire-subsidized and will fall when Sapphire is fixed. Plus one pool defect
(Echoes×Robe loop) to remove in the next revision.

---

## 13. The mispricing autopsy — why the buff arm over-buffed, and the repair (2026-07-02)

Direction (design review): **no blind reverts** — find out WHY the formula under-priced the
buff-arm cards, repair the valuation so the formula itself re-derives correct costs, and keep
formula-outlier cards to a bare minimum. Method: score all 19 buff-arm cost cuts with
`computeCardPower`, trace each gap to an effect-class weight, fix the class from Rulebook/engine
anchors (never from win rates), re-audit. All repairs in `src/balance/effect-value.ts` +
`signal-extract.ts` + `weights.ts`, each pinned by a unit test (`effect-value-repair.test.ts`).

### What was actually wrong (bugs first, weights second)

| Defect | Exhibit | Old → new |
|---|---|---|
| **`any`-side heals priced ZERO** (enemy-facing convention misapplied to beneficial effects) | Vinecall Elder's heal scored 0.00 | side=`enemy` only ⇒ zero; `any` heals ≈ allied |
| **Heal/debuff AoE width dropped** (damage had it; heal and the enemy-modify branch didn't) | Celestial Aegis 1.54; Plague Burst 2.0 | × AOE_WIDTH (2.5) |
| **Debuffs ignored their dynamic part** + sign confusion | Haunting 0.9 | sign decides buff/debuff; dynamic counted; capped at AVG_BODY_HP per body |
| Tokens at half stats, no traits, no zone | Guardian Spirit's 3×4/1 = 5.0; Chorus's Defender angels = 2.0 | stats × TOKEN_BODY_FACTOR (0.8) + traitValue + **RESERVE_TAP_VALUE (1.8) for Reserve tokens** (Rulebook 8.4: a Reserve body taps +1 temp resource/turn — the §12c battery, now priced AND signalled as `ramp`) |
| Resources at 1.0/unit | Tech Bloom 3.0 | RESOURCE_VALUE 1.5 (≈ ACCEL_RAMP_TEMPO), temporary 0.75 |
| Tutors/copies/counters/reanimation ~flat | Archivist 1.44, Echoes 1.2, counters 0.5, reanimate 1.8 | selection premiums (×1.5 discard / ×2 deck), counter = CARD_VALUE+0.5, reanimate-to-play = AVG_WEAK_BODY+CARD_VALUE |

### Re-audit at ORIGINAL costs (the falsifiable check)

Seven of the implicated cuts are **de-justified** — the corrected formula prices them at/near their
printed costs, so their discounts came from mispricing: **Guardian Spirit 15.0 → 20.0 (dead on the
8E line — the 6E cut evaporates), Biomass Surge 2.0 → 6.8 (WITHIN at 5E), Heavenly Chorus → 4.4
(WITHIN), Plague Burst → 5.0 (≈ON), Illusionist Adept → 6.72 (ON)**, Tech Bloom → 4.5 and Celestial
Aegis → 3.85 (both most of the way). The new over-list stays sane and adds **Protector of Faith**
(its heal-all was invisible before) while dropping **Archon's Guardian and Uriel to +0.1** — their
CURRENT −1 HP nerfs were likely mispricing-driven too and become un-nerf candidates.

### The two honest residual classes

1. **Line-shape bias (documented, deliberately NOT auto-corrected).** The linear characters fit
   (power ≈ 0.8 + 2.3·cost) demands 12–19 power at costs 5–8 while the pool's actual bodies deliver
   8–14 — so Vinecall (7.4), Biosteel (13.9), Archivist (9.4), Zombie Horde (8.4) still read
   "under" at original cost. That is the regression extrapolating past its support, not an effect
   weight. Per §11f discipline the line is not re-fit here; per standing policy these unders are
   review-only. (If a line change is ever wanted, it goes through the pre-registration protocol.)
2. **True outliers (the bare-minimum list, guard-enforced): Arcane Echoes.** Even corrected, the
   formula wants to cheapen it (−3.3) — recursion/self-copy value is unbounded in cost-space, so
   recursion cards are never auto-buffed; the min-effective-cost guard (§13a) enforces this
   structurally rather than by hand-maintained exceptions.

### Instrument version bump (measured, explicit)

`computeCardPower` is shared with the value pilot by design, so the repairs change HEURISTIC bot
behavior: the standard GPP=20 reference moves `a576f66296c4c11f` → `4eab42890b61a849`. Heuristic
numbers before/after this commit are not directly comparable. **The verdict instrument is
unaffected**: the rollout pilot's candidate selection is kind-ordered + lexicographic (verified —
no value ranking) with random playouts, and the random pilot never consults the pricer — the §12c
ladder stays comparable. 768 tests pass.

### 13a. Loop guards + the frozen baseline + the re-derived candidate (2026-07-02)

**Cost floor (rule guard, `config.costFloor`).** Stacked cost reductions can no longer take a card
below an effective TOTAL of 1 unless its printed cost is already 0 — the engine-wide "(minimum 1)"
Lyria's Supreme Intellect already prints, now true for every discount (`effectiveCost`,
cost-checker.ts; threaded through all engine call sites; the bot's reach-estimate site stays
legacy — the engine gate is authoritative). Adopted into the standard configs
(balance-standard-sim / balance-verify BASE / the denergy probe). Proven: flag off reproduces the
post-§13 heuristic reference `4eab42890b61a849` byte-for-byte; the new standard reference (floor
on) is **`d4614969ee101895`**.

**Static loop guards in `applyEdits` (§12c would have been caught before a single sim).** Every
cost-LOWERING edit must now pass: (1) *min-effective-cost* — new cost minus the max cost_reduction
the pool can stack at that card must stay >0 if the card has a recursion-class effect
(copy/search/return); (2) `detectCardLoops` — any non-'none' risk level vetoes. First live run:
**"Arcane Echoes: cost −3 — VETOED (min-effective-cost 2−2 ≤ 0 on a recursion card)"** (Robe −1 +
Lyria −1 stack to 2) and a bonus catch, "Spellbound Adept: cost −1 — VETOED (loop risk 'watch')".

**The baseline is now a frozen fixture.** The §13 repairs change `computeSuggestions`, so
re-deriving CURRENT through the live formula would silently produce different bytes
(`7ea3048881b0f9fc` ≠ `6928b4ab3b7ef915`). CURRENT's derivation era is over: its exact bytes are
committed at `sim-data/pools/aetherion-CURRENT-frozen.json` (+ the §8 Sapphire variant), and
`make-pools.mjs` COPIES them with a hard hash check at generation time — a mismatch is a fatal
error, never drift. Live derivations are clearly renamed `derived-*` with changes-as-formula-
improves notes.

**The A2 re-derived candidate — `derived-nerfs-lp30` (sha `cdbe44a3c1930df3`).** Corrected-formula
nerf arm + LP→30, buff arm review-only per policy. 10 edits, 7 mechanical: the Radiant wall cluster
(Shieldbearer Paladin −1/−1, **Protector of Faith cost +2 — new**, Faithkeeper −2 HP), Sapphire
Sentinel +1, Crystal Golem −1 HP, and Archon's Guardian/Uriel −1 HP (both only +0.1 over — marginal
calls the sims will judge); Angelic Strike/Morgath/Sprout routed to manual review (ability-driven).
Not yet a runnable pool for verdicts: it awaits the Grovekeeper DB regen + the Sapphire v2 trims
before becoming Pool α′ per the approved plan.

### 13b. Transform autopsy — instrument + static audit (2026-07-02; B3 measurement pending)

Design-review challenge: transformed kits READ strong (auras/triggers/ultimates), so why do they
swing nothing? §12c's win-when-transformed (33–50%) cannot say — it is conditioned on mostly-losing
flips. Instrumented instead:

**B1 (in every run now, hash-exempt — standard reference `d4614969ee101895` unchanged):** per
faction — LP at flip (how dead was the hero), turns survived after the flip, and hero-ability
USES per game split pre/post flip with a per-ability-index breakdown (the "were the buttons
pressed" question, answerable per ultimate). Printed as the "Transform autopsy" block and carried
in `factionDetail`.

**B2 static kit audit (`balance-hero-audit.mjs`):** all 8 hero sides with activation cost /
cooldown / once-per-game / §13-corrected value. Highlights: Kaelthar's transformed kit reads
**21.7 points on paper** (Undead Horde 8.4/turn + Plague of Shadows 8.4 + Resurgence 4.9) yet
Onyx's measured transform payoff is flat; Valkyrie's ATK=ARM aura alone reads **11.7**; and one
§13 pricing hole surfaced — **Synthetic Evolution (RIA transformed ultimate) values 0** (the
`multiply` dynamic modifier is priced 0) while costing 10 at flip time.

**Smoke-scale preview (NOT conclusions — n is tiny):** flips happen near-death (heuristic avg LP
at flip 9–14.7, i.e. the LP≤10 gate dominates even though the resource-empty gate opens ~turn 16),
heroes live only ~5–10 turns after, and the buttons ARE pressed (ultimates fire in most flipped
games). If B3 confirms at scale, the story is "flips are last rites — too late, from too far
behind", pointing at the sanctioned timing knob (LP gate 10 → 12–15, config-able) and per-kit
cost/cooldown tuning rather than at bot-usage bugs. The rollout's depth-3 horizon may also
undervalue flip timing (a long-horizon payoff) — read B3's rollout rungs with that caveat.

### 13c. Hero power budget — the parity band, first results (2026-07-02)

Design question answered: heroes get a power target, but as a **parity band** (±20% of the
four-hero mean), not a cost line — heroes are free and singular, so the constraint is comparable
effective value (LP→30's logic extended to the kit axis). Definition + rationale in
`docs/balance-valuation.md`; implementation in `balance-hero-audit.mjs` (H1 `multiply` pricing
hole fixed first — card re-audit confirmed ZERO verdict flips, the modifier is hero-only today).

First run (frozen CURRENT, §12c placeholder availability 0.70 × 0.25):

| Hero | baseNet | transformNet | heroBudget | verdict |
|---|---|---|---|---|
| Verdant (RIA-09) | **7.89** | 5.07 | **8.78** | FLAG over — cost/cooldown-up candidate |
| Onyx (Kaelthar) | 4.86 | 15.06 | 7.50 | PASS |
| Sapphire (Lyria) | 3.40 | 8.59 | 4.90 | FLAG under |
| Radiant (Seraphina) | 2.00 | 15.45 | 4.70 | FLAG under |

Two reads worth recording: (1) the band **independently rank-agrees with the measured §12c
field** — Verdant's flag is driven by the base kit (the always-on battery), exactly the measured
mechanism, and the two flagged-under heroes are the two weak/subsidized factions; the H5
pre-registration survives its first contact. (2) Netting exposed four **negative-net abilities**
(activation cost exceeds priced value): Synthetic Evolution −2.62 @cost 10, Unflinching Charge
−0.80 @4, Protector's Bulwark −0.60 @3, Arcane Singularity −0.28 @5 — concrete candidates for the
sanctioned cost/cooldown knobs, to be confirmed against B3's usage data (an ability can net
negative on paper and still be worth casting situationally; usage + payoff decides).

### 13d. B3 results — v2-instrument baseline; the transform verdict; hero band with measured availability (2026-07-02)

External batch on the frozen CURRENT (GPP_MATRIX=3000, RL=300, RH=200, RX=120), first run under
the v2 instrument (§13 pricing + §13a cost floor).

**The loop kill, confirmed at scale.** Heuristic decided% 95.9 → **100.0**, Sapphire
earlySpellsPerGame 344.87 → **0.98**, step-cap draws zero, avgTurns 27.6 → 30.5 (the voided games
were artificially short). The §12c Echoes×Robe class is closed.

**The strong-play verdicts are instrument-robust.** Pooled r8+r12 (n=960/faction): **Verdant 73.9 /
Onyx 54.8 / Radiant 52.3 / Sapphire 19.1** — statistically identical to §12c (73.4/54.8/52.1/19.7)
despite the pricing repairs shifting heuristic behavior and the floor touching every pilot's games.
Rank order stable on all rungs; the Radiant→Verdant comeback signature (56–59% overturns) and the
Radiant-farms-Sapphire cell (82–83%) persist. The diagnosis does not depend on the instrument
version. (Heuristic marginals: 44.6/57.9/42.1/55.5, spread 15.8 — the new heuristic reference.)

**Transform autopsy at scale — the §13b question answered:**
- *Strong play flips EARLIER and healthier than the heuristic* — rollout flips at LP 15–17 around
  turn 29–33 (the resource-empty gate; the LP≤10 gate cannot produce LP-16 flips), heuristic at
  LP 9–14 — **and still doesn't rescue** (lives +9–16 turns after, payoffs below).
- *Usage is NOT the bottleneck* for Onyx/Radiant/Verdant: Kaelthar presses his flip kit 6+/game
  (Plague of Shadows fires in most flipped games), Valkyrie's cry fires reliably. **Sapphire is
  the exception: 0.6–0.8 presses/game post-flip** — Arcane Singularity (cost 5, cd 3) is starved
  exactly when it matters.
- *Payoff read (selection-confounded — flips correlate with losing):* Sapphire is the ONLY faction
  where transformed win% EXCEEDS untransformed at rollout (32.6 vs 25.4 at r8; 32.5 vs 29.4 at
  r12) — its flip genuinely helps when reached. Onyx roughly neutral-positive; Radiant/Verdant
  "flip = was losing" markers.
- *Evidence-based read on the LP-gate 12–15 idea:* strong play ALREADY flips at LP 15–17 via the
  resource gate and it does not rescue — raising the LP gate would mostly replicate what strong
  play already does. Weak lever. The measured picture is that transforms function as a mid-game
  identity shift, not a comeback rescue; whether that is a design problem is a designer call, but
  the balance work stays on the decks either way.

**Hero parity band with MEASURED availability** (per-faction P(flip) × liveFraction from this
batch, replacing placeholders): **Onyx 10.39 (over)** — its flip side is live 44% of the remaining
game and hammered; **Verdant 8.65 (over)** — the always-on base battery; **Sapphire 5.05 (under),
Radiant 4.25 (under)**. Band [5.67–8.50]. H5 verdict: partially survives — Onyx/Sapphire flags are
direction-consistent with usage + payoff data; Valkyrie's paper-strong/practice-confounded gap
stands as the known open case (the winPctWhenTransformed confound is documented).

**The one clearly evidence-backed hero knob right now: Arcane Singularity cost 5 → 3** (Sapphire
is under-band, the button is starved, and its flip is the only one measured to help). Onyx/Verdant
over-band flags fold into the Phase-C pool work rather than solo hero edits — both factions' hero
engines are already part of the deck-level story.

### 13e. The hero three-window tune — encoded, all windows PASS; remeasure pre-registered (2026-07-02)

Direction (design review): hero balance is the lever — three windows, then remeasure. Framework
(in `balance-hero-audit.mjs`): **W1** each NORMAL form within ±30% of the base-kit mean (the
loosest window — an Aura-heavy base kit can't be knob-tuned below its aura floor); **W2** each
TRANSFORM within ±25% of the transform mean AND above an impact floor (≥10 — a flip must swing
the game); **W3** the composite **0.66·base + 0.33·transform** within a TIGHT ±10% band — heroes
get wiggle room to skew normal-vs-flip, but the packages stay matched. All flag-only; tuning is
via the sanctioned knobs.

**Design-review correction (caught before any measurement ran):** the first draft of this tune put
wrapper cooldowns on **Biotech Harvest** and **Undead Horde** — both card-type **Aura**, and Auras
are always-on engines that never take costs or cooldowns (a cooldown breaks aura logic). The tune
was re-solved through Trigger/Ultimate knobs only, and `make-hero-tune.mjs` now **hard-fails on
any knob that targets an Aura ability** so the class of mistake cannot recur.

**The tune (`make-hero-tune.mjs`, aura-safe knobs only — every one engine-enforced):** RIA-09
Bloom Assembly cd 2→6 + gains cost 2E (the battery governor routes entirely through the activated
half; Harvest untouched); Vanguard Overgrowth 5E→2E + Synthetic Evolution 10E→3E (the flip becomes
reachable and impactful); Lich King Deathly Resurgence cd 1→2 + Plague of Shadows cost 7→9 (the
over-window flip trims around the untouchable Horde); Seraphina Bulwark 3→1 + cd 3→1
(un-negatives the base kit); Valkyrie's cry gains cost 3M; Lyria Singularity 5→1 + cd 3→2 and
Convergence's printed cooldown removed (§13d: the starved button on the only flip measured to
help). Plus the **Grovekeeper 3000 hand-fix** (per direction — no DB regen): restored as the
intended X-cost construct (tags `x_cost`, 1/1 base, "enters with +X/+X where X is the Energy
spent", mirroring Steel-Root Armor's engine-real `x_cost` dynamic) — un-deadening 3 of Verdant's
40 cards.

**Result: all 12 checks PASS** — W1 [3.03–5.62]: S 3.40 / V 5.44 / O 4.86 / R 3.60; W2 [9.54–15.91]
floor 10: S 12.96 / V 10.54 / O 13.53 / R 13.87; W3 [6.35–7.76]: O 7.67 / V 7.07 / R 6.95 / S 6.52.
Pool: `CURRENT-plus-hero-tune` (sha **`44dbb1870ec34b65`**), assembled from the frozen fixture.

**Pre-registered prediction for the remeasure** (per protocol, falsifiable): the hero tune
compresses but does NOT close the gap — the deck-level engines (Verdant's Sapling/Reserve battery,
Sapphire's missing closure) are untouched, and the Grovekeeper fix partially counteracts the RIA
governor by un-deadening Verdant cards. Pooled r8+r12 predictions: **Verdant 64–72** (from 73.9),
**Sapphire 21–28** (from 19.1), Onyx 49–55, Radiant 48–54; spread **40–52** (from 53.7); rank
order unchanged (V top, S bottom). If Verdant lands BELOW 64 the hero share of its power was
bigger than assessed; if Sapphire clears 28 the flip fix was bigger than assessed.

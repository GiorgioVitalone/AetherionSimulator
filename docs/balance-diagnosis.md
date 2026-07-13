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
over-window flip trims around Horde — aura SCHEDULING is off-limits, though aura EFFECT VALUES
remain a legal design surface, unused this pass); Seraphina Bulwark 3→1 + cd 3→1
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

### 13f. Hero-tune remeasure — Sapphire fixed by hero work alone; three factions at parity; Verdant is the remainder (2026-07-02)

External batch on **`CURRENT-plus-hero-tune`** (sha256 `44dbb1870ec34b65`), same sizes as §13d
(GPP_MATRIX=3000, RL=300, RH=200, RX=120), v2 instrument. Provenance, verified without
re-simulation: the pool re-derives bit-identically to the pre-registered sha (`make-pools.mjs`
fatal fixture check), the config echo matches the standard, and the run carries the tune's own
mechanism fingerprints (below: Resurgence presses exactly halved, Singularity presses doubled,
Bulwark presses tripled, Bloom presses cut to a third) — signatures only the tuned pool can
produce. **Protocol change from this run on:** full bit-for-bit rung reproduction (the §7/§8
check) is dropped as disproportionate — it re-spends a rung's full compute to confirm what the
mechanism diagnostics already pin — and `balance-verify.mjs` now embeds the pool path + sha in
its header and output JSON, so every future run self-certifies and verification is a read, not a
re-simulation. Bit-repro stays reserved for runs whose internals look inconsistent (the reported
rung hashes `9e8abe51fa4e1f18` / `153902d4526f35c9` / `09d68d0720c1fe7b` are on record for any
future spot-check).

**Prediction scorecard (§13e, judged bound by bound):**

| Pre-registered (pooled r8+r12) | Actual (n=960/faction) | Verdict |
|---|---|---|
| Verdant 64–72 | **67.4** [64.4–70.3] | ✓ dead center |
| Sapphire 21–28 | **44.3** [41.2–47.4] | ✗ over by +16 — the registered clause fires: *the flip fix was bigger than assessed* (much bigger) |
| Onyx 49–55 | **42.3** [39.2–45.4] | ✗ under by ~7 |
| Radiant 48–54 | **46.0** [42.9–49.2] | ✗ under by ~2 |
| Spread 40–52 | **25.1** | ✗ — under half the §13d spread; far better than predicted |
| Rank unchanged (V top, S bottom) | V top ✓ — but S is 3rd and Onyx bottom | ✗ half |

**Post-mortem — one root miss, the rest is bookkeeping.** Marginals sum to 200 (wins are
conserved), so Sapphire's +20-over-midpoint had to be paid by someone. The exact pooled cell
deltas (§13d → here) show who: S gained **uniformly** against every opponent (+25.9 vs O, +25.3
vs R, +24.4 vs V — the signature of a real power fix, not a matchup artifact), which deleted the
farm cells that defined every panel since §7 (Onyx-farms-Sapphire 75.0→49.1, Radiant-farms-
Sapphire 82.8→57.5). Decomposing each marginal (Δmarginal = mean of its three cell Δs):
**Onyx −12.5 = −8.6 from losing the S farm, −2.5 vs Verdant, −1.4 vs Radiant** (those last two
are the Resurgence-cd/Plague trim's own bite, ≈ −4 pp); **Radiant −6.3 = −8.4 from losing the S
farm, +1.4 vs Onyx, +0.8 vs Verdant** — Radiant's own knobs net *positive* head-to-head (the
Bulwark cheapening outweighed the Valkyrie trim); **Verdant −6.5 = −8.1 from S's fix, +2.5 vs
the trimmed Onyx, −0.8 vs Radiant**. The O/R "misses" are composition, not new surprises; the S
bound was the real error, and the pre-registered escape clause names it.

**The headline: three factions now sit at parity; the entire remaining spread is Verdant's
altitude.** Pack-internal pooled win% (O/R/S among themselves): **Onyx 47.3 / Radiant 55.9 /
Sapphire 46.7**. Against Verdant: 32.2 / 26.3 / 39.4 — Verdant farms the whole pack at 67.4% and
is the only faction outside every window. Spread 54.8 → **25.1 pp**.

**Knob-by-knob mechanism audit (r8 detail, §13d → here) — every knob did its mechanical job:**
- **Sapphire** (Singularity 5→1 cd 2, Convergence cd removed): presses/flip 0.81 → 1.53; **T-win
  32.6 → 53.4 while N-win 25.4 → 24.7** — only the treated arm moved: the cleanest causal
  signature this program has produced. The flip is now a genuine wincon (S wins the majority of
  flipped games at every rollout rung) — worth +20–28 pp of marginal from two knobs on one hero.
- **Onyx** (Resurgence cd 1→2, Plague 7→9): post-flip presses exactly halved (6.08 → 3.52 per
  flipped game; #0 total presses 4421 → 2276). T-win 53.4 → 44.3 — the flip no longer out-earns
  staying normal.
- **Radiant** (Bulwark 3E/cd3 → 1E/cd1, Valkyrie's cry +3M): Bulwark presses 1.89 → 5.72/game and
  N-win **71.7 → 71.7, exactly flat** — cheap Bulwark spam does not convert into wins (defensive
  value without a closer). The Valkyrie trim shows as T-win 38.9 → 32.1.
- **Verdant** (Bloom Assembly cd 2→6 + 2E): hero presses 3.77 → 1.39 — the governor bit — **and
  the resource curve moved −0.16** (res@t10 8.11 → 7.95). The battery survives its hero governor.
- **Grovekeeper fix**: strictly positive at every skill level, as predicted — random-pilot Verdant
  +5.4 pp with res@t10 8.95 → 9.84 (the X-cost body is a sink converting battery output into
  stats, and at X=0 it is another free Reserve tapper); random/heuristic Verdant ROSE despite the
  governor (heuristic +9.5, also fed by Onyx's decline redistributing wins).

**Cross-pilot note:** first panel where heuristic AND all three rollout rungs agree top=Verdant
(random still says Radiant — the long-documented big-body artifact). The heuristic spread widened
15.8 → 31.6 for an instrument reason worth recording: heuristic Onyx flips at LP 9.3 and leaned
on Resurgence spam (6.79 presses/flip in §13d), so the cd knob hit the heuristic pilot hardest —
heuristic Onyx 33.4 vs rollout 41.0–44.4; heuristic-only reads on Onyx are now biased low.
Rollouts are the verdict layer, as established in §11.

**Convergence ladder:** Verdant 62.8 → 65.7 → 70.3, still RISING with pilot strength — by §4's
gate its true strong-play number is not converged: read 67.4 as a floor. Sapphire dips at r12
(46.8 → 40.0, n=360, CI ±5): direction-consistent with a flip-dependent plan being punished by
stronger opposition, but within noise — watch, not a verdict.

**Where Verdant's altitude actually lives (why the hero governor couldn't touch it).**
*[CORRECTED in §13j: engine recon showed Reserve taps never set Harvest's condition flag — the
battery is the flat 2-slot Reserve tap annuity + cheap fodder, and Harvest is a minor piece. The
resource-curve and deck-feeder evidence below stands; the "any tap breeds a tapper" loop does
not exist in the engine.]* The claimed compounder was **Biotech Harvest — the Aura**: "at end of your turn, if you gained temporary
Energy this turn, create a 1/1 Bio-Construct" — and ready Reserve bodies tap +1 temp Energy per
turn (Rulebook 8.4), so any tap breeds a tapper. The deck feeds the loop from turn 1:
Bio-Seedling ×3 (0E 0/2 — a FREE Reserve tapper, the only battery piece the corrected formula
flags, +0.7 over), Sprout ×3 (2E → 1 Sapling), Biomass Surge ×2 (3E → 2 Saplings), Tech Bloom ×2,
Grovekeeper ×3 as the X-cost sink, and post-flip Symbiotic Expansion pays +2/+2 on every
temp-resource deploy. Each card prices fairly in isolation — this is a Bucket-D system effect
(§12): the rate constant of a loop spanning a rule × an aura × token density, invisible to
per-card pricing by construction. The measurement isolates it cleanly: with the activated half
governed (presses −63%) the resource curve barely moved, and Verdant still beats every faction
(67.8 / 73.7 / 60.6 per-cell).

**Queue for the next round (proposals — nothing encoded yet):**
1. **Verdant, recommended lever: Harvest's effect values** — the aura surface explicitly
   sanctioned for design edits (thresholds/amounts, never scheduling). E.g. fire on 3+ temp
   Energy gained this turn (not 1+), or downgrade the created token to 0/1. One edit, aimed at
   the compounding term itself; the deck untouched.
2. **Verdant, deck-side alternative/supplement:** Bio-Seedling 0E→1E (removes the free-tapper
   opening; the one formula-flagged battery piece) ± Sprout 2E→3E (battery payback 2→3 turns;
   formula-fair, so it would be a documented measurement-driven outlier — the Echoes precedent).
3. **Onyx: NO give-back**, despite 42.3 looking low — pack-internal 47.3 IS parity; the marginal
   is depressed by Verdant suppression, not by over-trimming. Any Verdant fix mathematically
   lifts all three pack marginals. Re-judge after that lands.
4. **Sapphire §8 avenue: shelve.** The redesign (and its staged v2 trims) addressed "no win
   condition" — the hero flip fix solved that on the ORIGINAL cards (uniform +25, farm cells
   gone). Applying the deck buffs now would overshoot exactly as §8 measured; the frozen fixture
   stays as the record.
5. **Radiant: leave.** Its knobs measured net-positive head-to-head; pack-internal 55.9 is the
   pack's top and the first re-center candidate only if a later round needs one.

Prediction discipline holds: whichever Verdant lever is picked gets encoded as a frozen-derived
candidate (`CURRENT-plus-hero-tune-plus-…`), pre-registered before the next batch.

### 13g. Hero-tune v2 — W1 becomes a FIXED window; Verdant's package re-split base→flip (2026-07-02)

**Direction (design review of the §13e window table):** tighten W1 NORMAL to a **fixed
[3.00 – 4.99]** window, nerf RIA-09's normal form into it, and buff her transform slightly so the
W3 composite stays where it is. Window semantics change with it: W1 was mean-relative (±30%),
which let the very hero it should catch drag the window up — Verdant's 5.44 *passed* a band whose
ceiling its own value had lifted to 5.62. W1 is now absolute in `balance-hero-audit.mjs`
(`W1_LO`/`W1_HI`, default 3.00/4.99); W2/W3 stay mean-relative (they measure parity among the
four, not an absolute design ceiling).

**The v2 edits (`applyHeroTuneV2`, layered on the §13e tune):**
- **Biotech Harvest token 1/1 → 0/1** — an aura EFFECT VALUE, the explicitly sanctioned surface
  (scheduling untouched). Base kit 5.44 → **4.38**, mid-window. Bloom Assembly's activated 1/1
  token is deliberately left stronger — it is the paid, cd-6 unit; Harvest's passive byproduct is
  now a fragile shell. Engine-real trivially: token stats are data
  (`interpreter.ts` `executeDeployToken` reads `token.atk/hp`), and 0-ATK bodies have precedent
  (Bio-Seedling is 0/2).
- **Overgrowth Protocol cd 3→2** and **Synthetic Evolution 3E→2E** (engine-enforced knobs):
  transform 10.54 → **12.77**. Both sized from the audit identity gross = per-use × recurrence,
  so the moves were computed before they were made — and landed exactly.

**Result (audit on the new pool): all 12 checks PASS under the tightened W1.**

| Hero | W1 normal (fixed [3.00–4.99]) | W2 transform ([9.96–16.60], floor ≥10) | W3 composite ([6.35–7.77]) |
|---|---|---|---|
| Verdant RIA-09 | 5.44 → **4.38** | 10.54 → **12.77** | 7.07 → **7.10** |
| Onyx Kaelthar | 4.86 | 13.53 | 7.67 |
| Radiant Seraphina | 3.60 | 13.87 | 6.95 |
| Sapphire Lyria | 3.40 | 12.96 | 6.52 |

W2's pack tightened as a side effect (span 12.77–13.87, was 10.54–13.87). Pool:
**`CURRENT-plus-hero-tune2`** (sha256 **`75947cc9a0d1a7d7`**), derived frozen-CURRENT → §13e tune
→ v2 layer; the measured §13f pool (`44dbb1870ec34b65`) is untouched as the reference. Smoke run
clean (300 games, runHash `fd11cc9156a42bd0` — engine-legality only, not a verdict).

**Pre-registered prediction for the remeasure** (falsifiable): the real-game bite of v2 is
MODEST by §13f's own mechanism evidence — the tap-loop compounder (any temp gain → new tapper)
is untouched; the token nerf mostly trims Harvest bodies as pump targets and combat filler, and
the transform buff moves power into a flip Verdant reaches in only ~52–59% of rollout games.
Pooled r8+r12: **Verdant 62–68** (from 67.4 — a real but small step down), Radiant 43–49,
Sapphire 41–47, Onyx 40–46, spread 17–27, Verdant still top at every rollout rung. Secondary
signature: Verdant's T-win should RISE toward its N-win (the buffed flip converts better), and
its transform% may tick up. **Falsifiers:** V below 62 → the token-stat share of the base
battery was bigger than assessed; V at/above 68 → the hero axis is exhausted (all windows PASS
at the fixed ceiling) and the next lever MUST be the compounding loop itself — an engine
condition threshold on Harvest ("gained 3+ temp Energy this turn"; needs a new `event_context`
check, i.e. engine work, not data) or the §13f deck-side feeders.

**Focused run protocol (new; ~40% of a full panel's wall clock for 100% of its information).**
v2 edits Verdant cards only, and game seeds are a pure function of (seedBase, pairing, game) —
so the six non-Verdant pairings of a full panel would replay the §13f reference **byte-for-byte**
(proven empirically before adopting: rollout-low all-pairs at small gpp on both pools, all six
non-Verdant cells byte-identical). `balance-verify.mjs` gained `FOCUS=<faction>`: it runs only
the focus faction's four pairings at the SAME per-pairing sizes, so every informative cell keeps
identical n (pooled Verdant marginal still n=960 at r8+r12, CI ±3.0 — the resolution the 62–68
falsifier needs). Non-focus full marginals are reconstructed exactly at analysis time: two of
each faction's three cells are byte-frozen §13f counts; only the vs-Verdant cell is new. The
matrix layer also drops to GPP_MATRIX=1000 (context layer; ±1.8 pp is plenty). Cross-pilot gate
is skipped in focus mode (partial marginals); the Verdant-per-rung ladder direction still reads.

```bash
cd packages/engine && node make-pools.mjs   # confirm CURRENT-plus-hero-tune2 sha 75947cc9a0d1a7d7
FOCUS=Verdant AETHERION_CARDS=./generated-pools/aetherion-CURRENT-plus-hero-tune2.json \
GPP_MATRIX=1000 RL_GPP=300 RH_GPP=200 RX_GPP=120 \
GAUGE_OUT=./bv-hero-tune2.json node balance-verify.mjs | tee bv-hero-tune2.txt
```

(The full-panel command — same but without `FOCUS` and with `GPP_MATRIX=3000` — remains valid
if a whole-pool re-baseline is ever wanted; it buys nothing extra for single-faction candidates.)

### 13h. Hero-tune v2 remeasure (first FOCUS run) — prediction confirmed, hero axis spent, the loop is what remains (2026-07-03)

External FOCUS=Verdant batch on **`75947cc9a0d1a7d7`** — the first self-certified run (pool path +
sha in header and JSON, matching the §13g pre-registration; no re-simulation verification needed).
Rung hashes on record: `8bdd43d76fec5479` / `12f025f64f9b8d68` / `f51e01018fc76d85`.

**Prediction scorecard (§13g).** Full marginals for the pack reconstructed exactly as designed:
two frozen §13f pack-internal cells + the fresh vs-Verdant cell each (sum check 200.0 on the nose).

| Pre-registered (pooled r8+r12) | Actual | Verdict |
|---|---|---|
| Verdant 62–68 | **64.2** [61.1–67.1] (from 67.4) | ✓ — the "real but small step down" called in advance |
| Radiant 43–49 | **47.4** (reconstructed) | ✓ |
| Sapphire 41–47 | **41.8** (reconstructed) | ✓ low edge |
| Onyx 40–46 | **46.7** (reconstructed) | ✗ grazes +0.7 — inside reconstruction noise (±1.8), inconclusive |
| Spread 17–27 | **22.4** | ✓ |
| V top at every rollout rung | 58.9 / 63.0 / 66.1 | ✓ |

**Secondary signature MISSED, and it teaches something.** T-win did NOT rise (r8: 41.0 vs §13f
45.4; n_T=564) even though the buffed flip kit is pressed **+24% per flip** (Overgrowth at cd 2:
1.74 presses/flip vs 1.40). Verdant's flips remain "was losing" markers (winPctWhenTransformed 41
vs winPctWhenNot 79.6): paper value moved into Verdant's transform converts WORSE than the same
value in its base — the composite's 0.33 transform weight is generous to V in practice. Worth
remembering next time a composite-preserving swap is sized.

**Where the −3.2 pp came from (cell anatomy):**
- **Random-pilot Verdant is IDENTICAL: 66.3 → 66.3, res@t10 9.84 → 9.95.** The battery untouched
  at weak play — the v2 design conserved exactly what it intended to conserve, to the decimal.
- The entire bite is strong-play, concentrated in **V v Onyx: 67.8 → 54.7** (−13.1, >CI) — in the
  long grind matchup (p50 ~40 turns) Harvest's 0/1 shells no longer trade or chip against Onyx's
  token war; Onyx is now near-even with Verdant under rollouts (and WON the r4 rung 54.3).
- V v Radiant 73.7 → 69.7 (−4, ns). **V v Sapphire 60.6 → 68.1 (+7.5, ~1.4σ — watch, don't
  conclude)**: possibly the harder-flipping Verdant profile against Sapphire's flip plan, possibly
  seed noise (focus runs use fresh pairing seeds).
- Ladder rising again (58.9 → 63.0 → 66.1): not converged; 64.2 is a floor.

**Verdict: the hero axis is spent.** All 12 window checks PASS at the fixed W1 ceiling; two full
hero passes (knobs, then a window-tightened re-split) took Verdant 73.9 → 67.4 → 64.2, but the
pack sits at 41.8–47.4 and Verdant still farms it at ~64 with a rising ladder. What remains is
what §12/§13f identified all along: the battery *[§13j correction: the flat 2-slot Reserve tap
annuity + cheap fodder — NOT a Harvest self-catalysis loop; taps never set Harvest's flag]*
whose rate no hero cost/cooldown/token-stat reaches. Next-round options:
1. **Deck feeders (data-only, recommended first):** Bio-Seedling 0E→1E — the turn-1 FREE Reserve
   tapper, ×3 copies, the one battery piece the corrected formula flags (+0.7 over). Optionally
   + Sprout 2E→3E (payback 2→3 turns; formula-fair ⇒ documented measurement-driven outlier).
   Data edits, FOCUS-verifiable at ~20 min.
2. **The threshold (engine work):** Harvest fires only on 3+ temp Energy gained this turn — a new
   parameterized `event_context` condition (evaluator + DSL type + tests), then priced into the
   formula. The surgical loop governor; keeps the big-battery identity, kills the trickle
   ignition. More build, bigger expected effect.

### 13i. The concrete plan + feeder-trim candidate, pre-registered (2026-07-03)

**The plan, in order:** (1) trim the loop's ignition feeders, data-only — measure. (2) Only if
Verdant still reads ≥62 pooled: build the Harvest threshold (parameterized `event_context`
"gained N+ temp Energy this turn" — engine condition + tests + pricing) — measure. (3) Formula
stays as-is (guardrail + hero bookkeeping; see balance-valuation.md traced-answer section).
O/R/S stay untouched; re-judge the pack after Verdant lands.

**Step 1 encoded:** `CURRENT-plus-hero-tune2-battery` (sha **`adec431841b82df5`**) =
hero-tune2 + Bio-Seedling 0E→1E + Sprout 2E→3E (`make-battery-trim.mjs`, guarded). Hero windows
untouched (12/12 PASS). Smoke clean (300 games).

**Pre-registered prediction (pooled r8+r12, FOCUS reconstruction):** Verdant **55–62** (from
64.2); this one SHOULD show at weak play too (unlike v2): random Verdant 60–65 (from 66.3),
res@t10 down ≥0.5 (from 9.95). Falsifiers: V ≥62 → feeders insufficient, go to step 2 (threshold);
V <55 → overshot, revert Sprout to 2E and keep Bio-Seedling 1E.

```bash
cd packages/engine && node make-pools.mjs   # confirm CURRENT-plus-hero-tune2-battery sha adec431841b82df5
FOCUS=Verdant AETHERION_CARDS=./generated-pools/aetherion-CURRENT-plus-hero-tune2-battery.json \
GPP_MATRIX=1000 RL_GPP=300 RH_GPP=200 RX_GPP=120 \
GAUGE_OUT=./bv-battery.json node balance-verify.mjs | tee bv-battery.txt
```

### 13j. Feeder-trim results; threshold escalation CANCELLED by engine recon; round-2 fodder trim (2026-07-03)

**Results (FOCUS run, self-certified `adec431841b82df5`):** pooled r8+r12 **Verdant 62.1**
[59.0–65.1] (predicted 55–62 — landing ON the escalation line), reconstructed pack **Radiant
49.0 / Onyx 46.5 / Sapphire 42.5** (sum 200.0), spread **19.6** — the four rounds read
54.8 → 25.1 → 22.4 → 19.6. Per-cell: V beats O 55.3 / R 65.0 / S 65.9 — the altitude now lives
vs Radiant/Sapphire; Onyx is near-even. Secondary predictions: random V 64.6 (60–65 ✓ at the
edge); res@t10 −0.27 vs predicted ≥0.5 ✗ — the trim bit at half strength. Rung hashes
`2f0d2d1d26675b03` / `e2d961c4ece667e7` / `31774d7046a58f01`.

**The ≥62 escalation rule fired — and implementation recon KILLED the planned threshold,
correcting §13f/§13h:** the only writer of `gainedTemporaryResource` is the `gain_resource`
EFFECT; **Reserve taps (`generateReserveEnergy`) and discard-for-energy grant temp WITHOUT
setting the flag** (game-state.ts documents the narrow scope). Harvest therefore fires only on
rare effect-temp turns (Bloom's temp option, ~1.5–1.9 presses/game) — the "tap → token → tapper"
self-catalysis previously described DOES NOT EXIST in the engine, and a threshold on that flag
would govern nothing. **Corrected mechanism:** the battery is the flat Reserve annuity — 2 slots
× (+1 temp per ready body per turn, Rulebook 8.4) ≈ +2/turn from ~turn 2 — fed by cheap bodies.
(Harvest-as-printed would count taps; the engine's narrower flag is already a nerf vs card text.
Left as-is.)

**Round 2, replacing the threshold — the last cheap-fodder holes (`applyBatteryTrim2`):**
- **Grovekeeper 3000 0E+X → 1E+X** — the bot pays X = spare (`chooseXValue`), so at printed 0E
  it deploys as a FREE 1/1 tapper exactly when resources are tight (the hole Bio-Seedling 0E→1E
  closed), ×3 copies.
- **Biomass Surge 3E → 4E** — two tappers for 3E was the strongest remaining battery rate
  (payback 1.5 → 2 turns).

Pool **`CURRENT-plus-hero-tune2-battery2`** (sha **`2d85729c672d4b8f`**); all four prior edits
verified in-bytes; hero windows untouched (12/12 PASS); smoke clean.

**Pre-registered prediction (pooled r8+r12, FOCUS):** Verdant **57.5–61.5** (from 62.1), spread
15–20, random V 62–65, res@t10 −0.2 to −0.4. **Falsifiers:** V ≥61.5 → the data-only card space
is EXHAUSTED and the residual is the tap rule itself — next is a rules decision (present the
non-vetoed options) or accept ~60 and re-center the pack. V <55 → Biomass reverts to 3E.

```bash
cd packages/engine && node make-pools.mjs   # confirm CURRENT-plus-hero-tune2-battery2 sha 2d85729c672d4b8f
FOCUS=Verdant AETHERION_CARDS=./generated-pools/aetherion-CURRENT-plus-hero-tune2-battery2.json \
GPP_MATRIX=1000 RL_GPP=300 RH_GPP=200 RX_GPP=120 \
GAUGE_OUT=./bv-battery2.json node balance-verify.mjs | tee bv-battery2.txt
```

### 13k. Fodder trim round 2 — the income thesis is DEAD; switching to the conversion thesis (2026-07-03)

**Results (FOCUS run, self-certified `2d85729c672d4b8f`):** pooled r8+r12 **Verdant 62.6**
[59.5–65.6] vs predicted 57.5–61.5 — **the ≥61.5 falsifier fires cleanly** (last round grazed;
this one is unambiguous). Reconstructed pack: **Radiant 49.1 / Onyx 46.4 / Sapphire 42.0**,
spread 20.6 (flat vs 19.6). Rung hashes `9712dfb50bc5266a` / `f51de5ca49d83c77` /
`9adc77137124a174`.

**Why this kills the income thesis rather than just the round:** every MECHANISM prediction hit —
random res@t10 9.68 → 9.32 (predicted −0.2..−0.4 ✓), rollout curves down ~0.2–0.3, random V 64.2
(62–65 ✓) — and the win rate did not move (62.1 → 62.6). Two rounds of income pricing: −2.1 pp,
then ~0. The decisive comparative: **Onyx now out-taps Verdant** (res@t10 8.4 vs 7.2 at r8) and
sits at parity — tap income per se does not confer the altitude. Verdant's is in CONVERSION:
it wins 76–81% of its UNFLIPPED rollout games, deploying 18.5–19 bodies/game (R: 12), i.e. the
engines that turn income into board and cards, which the per-card formula is structurally quiet
about (§12 Bucket D; the traced-answer section in balance-valuation.md).

**Round 3 — the last card-side thesis (conversion payloads, ×3-copy engines, never yet touched):**
`applyPayloadTrim`: **Rampant Evolution 3E→4E** (destroy an ally → deploy from deck at cost+1 —
the tutor-tempo engine; `deploy_from_deck` priced flat 4, novelty-flagged) and **Biotech Engineer
3E→4E** (Aura: friendly gains stats → draw, fed by every buff and X-sink in the deck — the
card-advantage engine; its synergy web is audit-capped by design). Card-cost data edits only;
aura effect values untouched. Pool **`CURRENT-plus-ht2b2-payload`** (sha **`34cf3a286ea726f6`**);
all six Verdant edits verified in-bytes; hero windows 12/12 PASS; smoke clean.

**Pre-registered prediction (pooled r8+r12, FOCUS):** Verdant **57–61**; spread 15–19; Verdant
deploys/game down ≥0.8 and its unflipped win% down ≥4 (the thesis-specific signature — if V drops
WITHOUT those moving, the mechanism story is wrong even if the number is right). **Falsifiers:**
V ≥61 → the card-side space is FULLY exhausted (income AND conversion theses dead) — the residual
is systemic and the decision is: (a) rules knob — cap Reserve generation at 1/turn total (hits
income leader Onyx hardest, would need an Onyx give-back; engine + tests), (b) starter-deck LIST
changes (composition, not card data — a product decision), or (c) accept V ≈ 62 and re-center
targets. V <55 → revert Biotech Engineer to 3E.

```bash
cd packages/engine && node make-pools.mjs   # confirm CURRENT-plus-ht2b2-payload sha 34cf3a286ea726f6
FOCUS=Verdant AETHERION_CARDS=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json \
GPP_MATRIX=1000 RL_GPP=300 RH_GPP=200 RX_GPP=120 \
GAUGE_OUT=./bv-payload.json node balance-verify.mjs | tee bv-payload.txt
```

### 13l. Round 3 null — the card-COST space is closed; the surplus-income insight; DECISION BRIEF (2026-07-03)

**Results (FOCUS run, self-certified `34cf3a286ea726f6`):** pooled r8+r12 **Verdant 63.3**
[60.2–66.3] vs predicted 57–61 — falsifier fires. The thesis-specific signatures are decisive:
deploys/game FLAT (18.65 vs 18.55 at r8; predicted −0.8+), unflipped-win FLAT (77.1 vs 76.9;
predicted −4+). Reconstructed pack: R 47.4 / O 46.4 / S 42.9, spread 20.4. Rung hashes
`a86677aa2e86df43` / `b4ee9ba3e626cb7e` / `224c6f4dbec73ccd`.

**The full card-nerf ledger on Verdant** (8 data edits across 4 rounds): 67.4 → 64.2 (hero
re-split, −3.2) → 62.1 (feeders, −2.1) → 62.6 (fodder, +0.5) → **63.3** (converters, +0.7).
The three COST rounds net to ~0, and random-pilot Verdant has been flat at ~64.3 since v2.

**Why every cost edit failed — the unifying insight:** the Reserve annuity gives Verdant a
structural income SURPLUS (+2–3/turn over Radiant/Sapphire, who essentially never tap — their
res@t10 ≈ the resource-draw baseline). A deck with surplus income is **price-inelastic**: +1E on
any card is paid out of surplus and changes nothing about what gets deployed. Cost-side card
edits tax the one resource Verdant has too much of. (Effect-side card edits — weaker stat lines,
smaller effect amounts — are the one untested card class, but the same surplus logic predicts
substitution to the next converter; low confidence.)

**DECISION BRIEF (pre-registered in §13k — this is a design-authority call):**
- **(A) RECOMMENDED — rules knob: Reserve energy generation capped at 1/turn total** (config-
  gated in `generateReserveEnergy`; one simple rule, less tracking than the vetoed per-token
  ideas). Attacks the surplus itself. Expected: V −4–8 pp, Onyx −3–6 (it taps hardest: res@t10
  8.3) → stage an Onyx give-back BEHIND the measurement (candidate: Deathly Resurgence cd 2→1
  revert, the §13e knob). CAVEAT: a rules change touches ALL pairings — the next run is a FULL
  panel, not FOCUS (~50 min class).
- **(B) Starter-deck LIST change** (product decision): swap Verdant fodder copies for mid-cost
  bodies. FOCUS-verifiable, zero engine work — but the same surplus logic that killed rounds
  2–3 predicts the annuity persists with any playable 40.
- **(C) Accept & re-center:** V ≈ 63 / pack 43–47 / spread ~20 as the shipped state — declares
  the ≤10 pp target unreachable under the current tap rule and the vetoed-lever list.
- **(D) Effect-side card edits** (untested class, low confidence per the surplus logic):
  e.g. converter effect amounts. Available if (A) is unpalatable.

No new pool is cut; the §13k candidate chain stops here pending the pick.

### 13m. The Reserve tap rules package — choice (rules-accuracy) + strain (designer's rule), implemented (2026-07-03)

**Direction (design review):** the §13l brief was answered with a designer's rule instead of the
cap: tapping strains the character. Implementation recon first verified the engine against the
Rulebook: (1) **tapping was AUTOMATIC** — every eligible ready Reserve body tapped at Upkeep,
though Rulebook 8 step 4 (and the engine's own comment) says the player *may* — a rules-accuracy
divergence; (2) exhaustion itself was correct (tap sets `exhausted` + `reserveEnergyExhausted`,
recovery at next Upkeep's ready step); (3) the all-abilities-disable was correct and two-tiered
(combat exhaustion leaves auras/triggers alive per Rulebook 3; Reserve-tap exhaustion disables
everything: `aura-recompute.ts:177`, `trigger-registry.ts:122`, `available-actions.ts` gate).

**The package (both config-gated; absent ⇒ byte-identical):**
- **`reserveTapChoice`** (rules-accuracy fix): automatic upkeep generation off; a `tap_reserve`
  Strategy-phase action per eligible body replaces it (same eligibility incl. the Sniper
  exclusion, same +1 matching temp resource, same all-abilities exhaustion). Heuristic policy:
  taps ability-less, equipment-less bodies first each turn (tapping an ability body silences its
  auras AND its equipment's — the rule's real price, which fodder bypasses); random/rollout
  pilots get tap actions in their enumerations (rollout searches them by outcome).
- **`reserveTapStrain`** (the designer's rule): a tap deals **1 direct damage** — no ARM
  mitigation, no damage triggers (wear, not an attack) — and a character with 1 HP left is too
  weak to generate. Death-free by construction. Each body's lifetime income = HP − 1 (+heals).

**Verification:** 784 tests green (9 new in `tests/actions/reserve-tap-choice.test.ts`); flags-off
byte-identity proven (tiny rollout rung reproduces the pre-change baseline `8b4782f6ff56b5ed`
bit-for-bit); flags-on smokes decided 100% at heuristic and rollout with the designed income
collapse: res@t10 falls to the resource-draw baseline for every faction (Onyx 9.4 → 5.0
heuristic; the 1-HP fodder class — Saplings, 0/1 Harvest tokens, X=0 Grovekeepers, Onyx
skeletons — can no longer tap at all; 2HP+ bodies tap down to 1 HP and stop).

**Pre-registered prediction (FULL panel — a rules change touches every pairing; wide bands, this
is a new ruleset):** pooled r8+r12 **Verdant 48–58** (the surplus dies, and the six §13i–k cost
edits — absorbed by surplus until now — start biting), Radiant 48–58, Onyx 40–50, Sapphire
44–54; spread ≤20; the top slot genuinely open for the first time. Hard mechanism signatures:
res@t10 for V and O collapses from 7.2–8.4 to ≈5.0–5.6 at the rollout rungs; decided% stays 100.
**Falsifiers:** V ≥58 → the annuity was never the edge — deep re-diagnosis; V <45 → the package
over-taxes on top of the stacked §13i–k cost edits — un-stack them (they were tuned under the
old rule and are candidates for reversal once the surplus is gone either way).

```bash
cd packages/engine && node make-pools.mjs   # pool unchanged: CURRENT-plus-ht2b2-payload 34cf3a286ea726f6
RESERVE_TAP=1 AETHERION_CARDS=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json \
GPP_MATRIX=3000 RL_GPP=300 RH_GPP=200 RX_GPP=120 \
GAUGE_OUT=./bv-tapstrain.json node balance-verify.mjs | tee bv-tapstrain.txt
```

### 13n. Tap-package remeasure — spread 13.2, the largest single improvement on record (2026-07-03)

**Full panel, self-certified** (`34cf3a286ea726f6`, RULES PACKAGE ON in header; rung hashes
`3bb88b0c1278878d` / `90fcd24a0bcb2c89` / r12 in JSON). **Prediction scorecard (§13m):**

| Pre-registered (pooled r8+r12) | Actual | Verdict |
|---|---|---|
| Verdant 48–58 | **57.3** [54.1–60.4] (from 63.3) | ✓ top of band — the annuity was ~6 pp of the edge |
| Radiant 48–58 | **47.2** [44.0–50.4] | ✗ grazes −0.8, inside CI |
| Onyx 40–50 | **51.5** [48.3–54.6] (from 46.4) | ✗ grazes +1.5, inside CI — losing everyone's income HELPED Onyx |
| Sapphire 44–54 | **44.1** [41.0–47.2] | ✓ low edge |
| Spread ≤20 | **13.2** | ✓✓ — program history: 54.8 → 25.1 → 22.4 → 19.6 → 20.6 → 20.4 → 13.2 |
| res@t10 collapse to ~5.0–5.6 | V 5.5 / O 5.1 at rollouts (from 7.2–8.4) | ✓ hard signature hit exactly |
| decided 100% | 100% every pilot | ✓ |

Neither falsifier fired (V under 58, above 45): the package landed in-band with no un-stacking
forced. **Rollout-low posted the first three-PASS rung ever** (O 48.0 / R 54.8 / V 52.8 PASS,
S 44.4 FLAG, spread 10.3).

**Pooled cells:** Onyx v Verdant **50.9** (dead even — the §13f 67.8 farm is gone), Sapphire v
Verdant **45.9** (near-even), Onyx v Radiant 46.9, Onyx v Sapphire 56.6, Radiant v Sapphire 57.2
(the residual polarization), Radiant v Verdant **31.3** — Verdant's whole remaining altitude is
now ONE matchup: it out-tempos slow Radiant 68.7% even without the battery.

**Instrument caveats, honestly:** the heuristic layer diverged hard from the rollouts this panel
(heuristic Onyx 27.7 vs rollout 51.5; heuristic Sapphire 57.2 vs 44.1) — the v1 heuristic tap
policy (greedily tap every vanilla) plus heuristic Onyx's income-fueled early-flip plan do not
represent strong play under the new rule; the rollout rungs SEARCH tap decisions by outcome and
are the verdict layer. The cross-pilot top gate reads NO (Radiant/Verdant split) — at spread 13
the "top faction" is genuinely contested between 47–57 values, which is what closing the gap
looks like. Random remains the known artifact floor (Radiant 78.8).

**Standing decisions now on the table:**
1. **Adopt the package into the standard baseline** (recommended: `reserveTapChoice` is a
   rules-accuracy fix and belongs in the default regardless; `reserveTapStrain` is measured at
   −6 pp Verdant / +5 Onyx / spread −7 with games 100% decided). Adoption = flags into
   balance-verify BASE unconditionally + Rulebook text for the strain rule.
2. Residual work at spread 13.2: Verdant 57.3 rides one cell (v Radiant 68.7); Sapphire 44.1 is
   hyper flip-dependent under the new economy (winPctWhenNot 25.9 at r8). Both are now
   ordinary single-matchup/single-faction tuning problems, FOCUS-probeable at ~20 min.
3. The six §13i–k cost edits were tuned under the old rule; with Verdant still on top they stay,
   but any future Verdant relief should un-stack those before touching anything new.

### 13o. Package ADOPTED; the Sapphire-discard audit (answer: it's healthy); the 12-card Resource Deck probe (2026-07-03)

**Adoption (design sign-off):** `reserveTapChoice` + `reserveTapStrain` are now unconditional in
the standard baseline (`balance-verify.mjs` BASE, `balance-standard-sim.mjs`,
`balance-probe-denergy.mjs`). Panels before 2026-07-03 predate the package. The engine flags
remain opt-in (defaults off) so historical replays stay byte-identical; the Rulebook text for the
strain rule is pending (Documentation submodule is not writable from this environment).

**Sapphire discard audit — the bot does NOT overvalue discard-for-energy:**
1. *Policy is tempo-gated by construction:* the standard heuristic runs `reachDiscard`
   (`src/bot/heuristic.ts` chooseReachDiscard) — a discard fires ONLY to fund a specific play
   that is short by exactly one resource, pitching the lowest-value matching-type card, and only
   when the play out-values the pitch by REACH_MARGIN 1.5 with MIN_REACH_PLAY 2. Every heuristic
   discard funds a same-turn tempo play — precisely the "discard for tempo-gaining plays"
   principle. (Legacy blind pitching was the §11 self-handicap, fixed and adopted then.)
2. *The measured value check:* the §12a A/B DISABLED the rule entirely — Sapphire dropped
   **−4.0 pp**, the largest hit of any faction. The discards win games; they are not a leak.
3. *Why the volume is high for Sapphire specifically:* it is the draw-engine faction — it holds
   the most surplus cards, so its marginal card value is the lowest and converting excess cards
   into tempo is correct play. The outcome-searching rollout pilot (no reach heuristic) also
   discards most with Sapphire (2.5–3.4/game vs R/V 0) — independent confirmation.
   Under the adopted tap package the rule's value rises further (it is now the main flexible
   income source), so Sapphire leaning on it harder is rational adaptation, not bias.
   No change made; if a re-quantification under the new economy is ever wanted, the §12a probe
   (`balance-probe-denergy.mjs`) re-runs in ~20 min.

**The 12-card Resource Deck (`resourceDeckSize`, config-gated, engine default 15):** each
player's Resource Deck is truncated to N cards AFTER the setup shuffle (type mix preserved in
expectation). Two effects by construction: total permanent income caps at 12, and under
`resource_deck_empty_transform` the transform gate opens ~3 own-turns earlier. Threaded through
setup → sim config → runHash → CLI (`resourceDeckSize`) → `RESOURCE_DECK=<n>` env in
balance-verify. 788 tests green (4 new); flags-off byte-identity re-proven
(`8b4782f6ff56b5ed`); smoke on the new ruleset: decided 100%, transformAvgTurn 25–27 (from
30–33) — the earlier-transform effect is real and visible at smoke size.

**Pre-registered prediction (full panel, RESOURCE_DECK=12, vs the §13n reference
O 51.5 / R 47.2 / S 44.1 / V 57.3, spread 13.2):** earlier universal flips help the factions
whose transformed kits WIN (§13n T-vs-N: Onyx ~50/53, Sapphire 54/26) and do nothing for those
whose flips are losing markers (Radiant 31/69, Verdant 43/77). Pooled r8+r12: **Sapphire 46–53**
(up — flip-dependent, biggest winner), **Onyx 49–56**, **Radiant 43–50** (down — expensive
top-end under a 12-income cap), **Verdant 53–59** (flat); spread **10–16**. Hard signatures:
rollout transformAvgTurn drops to ~25–27, transform% up ≥8 pp, decided 100%. **Falsifiers:**
spread >16 → revert to 15 (the probe stays a probe); Radiant <43 → the income cap overhits its
archetype — revert or pair with Radiant relief.

```bash
cd packages/engine && node make-pools.mjs   # pool unchanged: CURRENT-plus-ht2b2-payload 34cf3a286ea726f6
RESOURCE_DECK=12 AETHERION_CARDS=./generated-pools/aetherion-CURRENT-plus-ht2b2-payload.json \
GPP_MATRIX=3000 RL_GPP=300 RH_GPP=200 RX_GPP=120 \
GAUGE_OUT=./bv-rd12.json node balance-verify.mjs | tee bv-rd12.txt
```

### 13p. The 12-card Resource Deck — first sub-10 spread; the game's imbalance reduces to ONE cell (2026-07-03)

**Full panel, self-certified** (`34cf3a286ea726f6`, adopted ruleset + RESOURCE_DECK=12; rung
hashes `32bfb71e5b4301e2` / `400aee98aec17cea` / r12 in JSON). **Prediction scorecard (§13o):**

| Pre-registered (pooled r8+r12) | Actual | Verdict |
|---|---|---|
| Sapphire 46–53 (biggest winner) | **52.7** [49.5–55.8] (from 44.1) | ✓ high end — earlier flips, as predicted |
| Onyx 49–56 | **51.5** [48.3–54.6] | ✓ |
| Radiant 43–50 (down) | **43.1** [40.0–46.3] | ✓ bottom edge |
| Verdant 53–59 | **52.7** [49.5–55.8] | ✗ grazes −0.3, inside CI |
| Spread 10–16 | **9.6** | ✗ BETTER than the band — first sub-10 in program history |
| Flip turn → ~25–27 | 25.3–27.6 at rollouts (from 29–31) | ✓ |
| transform% up ≥8 pp | +7 to +13 by faction | ✓ |
| decided 100% | 100% every pilot | ✓ |

Neither falsifier fired. **Rollout-low posted the first ALL-PASS rung ever: spread 1.2**
(O 50.6 / R 49.7 / S 50.4 / V 49.3). Program history: 54.8 → 25.1 → 22.4 → 19.6 → 20.6 → 20.4 →
13.2 → **9.6** — inside the §3 starter-deck acceptance band (~8–10 pp "watch").

**The structural read — five of six cells are healthy; ONE is not:** pooled r8+r12 cells:
O v R 54.7, O v S 45.9, O v V 53.8, R v S 50.0, S v V 54.1 — all within 46–55 — and
**Radiant v Verdant 34.1/65.9**, the game's entire residual imbalance. Verdant now LOSES to both
Onyx (46.2) and Sapphire (45.9); its 52.7 marginal is propped solely by farming Radiant. Radiant
is at parity with Onyx (45.3) and Sapphire (50.0); its whole 43.1 deficit is the Verdant cell.
The cross-pilot "top" is fully contested (O/S/V within 1.2 pp) — deep parity at strong play.

**One hygiene regression to watch: mirror first-player edge** rose under the tighter economy —
r4 +5.1 / r8 +5.6 (FAIL vs the ≤+3 target), r12 −0.4, heuristic +4.6. Plausible mechanism: with
12 total resources + chosen taps, first-mover tempo compounds harder. Needs a dedicated probe
before RD12 adoption is finalized (could be pilot artifact: tap-order interactions).

**Queue:**
1. **Adopt resourceDeckSize 12** (recommended, pending the FP probe): measured beyond prediction,
   spread inside the acceptance band, transforms ~3 turns earlier as designed.
2. **The last cell (R v V 34/66):** formula-aligned Radiant relief — its top-end bodies are the
   corrected formula's biggest over-budget flags (Shieldbearer +4.5, Protector of Faith +4.4,
   Faithkeeper +4.3) and the 12-income cap squeezes exactly that top-end. A conservative 1E cut
   on 2–3 of them lifts Radiant mostly where it races Verdant. Card-only change ⇒ FOCUS=Radiant
   verifiable (~20 min).
3. **Mirror-FP probe:** quantify the +5 edge's source (tap-choice ordering vs economy tempo);
   instrument-level.

### 13q. Rule lock — verdict layer, FP gate, ablation battery, adoption (2026-07-10)

Everything from here runs through the new pipeline: presets + thresholds from
`sim-data/balance-targets.json` (single source of truth; the doc mirrors it), every run ledgered
in `balance-runs/ledger.jsonl` with pool sha, resolved ruleset, and per-pilot runHashes.

**Step 0 — the verdict layer, resolved.** The §4 validity gate ("pilots agree") has failed since
§13n: the heuristic reads Verdant 63.9/Onyx 32.3 on the same pool where rollouts read near-parity.
Before any lock decision, we scaled the rollout ladder to CI-resolving sizes
(RL/RH/RX = 600/400/400 gpp, RD12, pool `34cf3a28`, ledger `2026-07-10_verify_34cf3a28_rd12-verdict`):

| Faction | r4 (n=3600) | r8 (n=2400) | r12 (n=2400) | Δ(r8→r12) |
|---|---|---|---|---|
| Onyx     | 49.0 [46.7–51.3] | 53.4 [50.6–56.2] | 52.8 [50.0–55.6] | 0.6 |
| Radiant  | 49.6 [47.3–51.9] | 41.8 [39.0–44.6] | 44.2 [41.4–47.0] | 2.4 |
| Sapphire | 52.1 [49.8–54.4] | 52.2 [49.3–55.0] | 50.2 [47.3–53.0] | 2.0 |
| Verdant  | 49.3 [47.0–51.6] | 52.7 [49.8–55.5] | 52.8 [50.0–55.6] | 0.1 |

Pre-registered rule, graded: **every faction's r8→r12 drift is ≤3 pp OR its CIs overlap
(either suffices — a small drift is convergent on its own, and overlapping CIs mean a larger
drift is within sampling noise). All four pass — the ladder's top is converged; no r16
escalation.** r4 is the outlier (calls Radiant parity where
r8/r12 separate it below 50 with disjoint CIs) — the r4 searcher (depth 2, 5 candidates) sits
below the skill knee and is demoted to a dose-response rung, not a grading rung.

**DECISION: the grading layer for all lock decisions is pooled rollout r8+r12** (~2,400
games/faction, CI ±2.0 pp). Current pooled read: Onyx 53.1, Radiant 43.0, Sapphire 51.2,
Verdant 52.8 — spread ~10.1, all of it Radiant's known R-v-V card deficit (§13p queue 2).
Random and heuristic remain diagnostic floors only.

**The heuristic's demotion is mechanistic, not hand-waving** (autopsy of the §13p panel's
factionDetail): under the heuristic, Verdant wins **92.8%** of games in which its hero never
transforms (rollout: 68%) while deploying 4.3 fewer bodies/game (13.7 vs 18.0) and holding
resources (7.84 vs 8.71 @t15) — the heuristic finds Verdant's degenerate hold-and-win line and
never pays the transform risk. Onyx under the heuristic flips 2.5 turns earlier (22.7 vs 25.5)
at a 90.6% rate yet wins LESS when flipped (38.3% vs 50%) — it commits without board readiness.
The heuristic's tap policy predates the §13m package; its play pattern is stale on two engine
generations. Its reads are useful as a floor and for mechanism instrumentation, not for grading.

**Mirror-FP dose-response from the same panel** (context for Step 1): r4 +4.0, r8 +4.3,
r12 **+2.0** — the edge falls at the strongest rung, the signature of a pilot-skill artifact
(§7 precedent: random-play FP +8.75 erased to +1.6 under rollout). Dedicated mirror probes
(4,000 mirror games/condition, CI ±1.5 pp) are running: E1 r12/r8/r4 @RD12, E2 r8 @RD15 control.

**Step 1 — the mirror-FP probes overturned the panel's optimistic read: the seat edge is REAL,
and it is NOT RD12's fault.** Dedicated mirror-only probes (4 mirrors × 1,000 games each,
`balance-fp-probe.mjs`, ledgered `fp-r{4,8,12}-rd12`, `fp-r8-rd15`):

| Condition | FP edge (pp over 50) | vs ≤+3 gate |
|---|---|---|
| E1 r4 @RD12  | +4.50 [2.95 … 6.04] | FLAG |
| E1 r8 @RD12  | +6.43 [4.88 … 7.95] | FAIL |
| E1 r12 @RD12 | **+6.63 [5.08 … 8.15]** | **FAIL** |
| E2 r8 @RD15  | **+5.13 [3.58 … 6.66]** | **FAIL** |

The pre-registered rule fires: the r12 CI lower bound (5.08) clears +3 → **real FAIL**, Step 2
triggers. Two structural findings: (1) the edge RISES with pilot skill — the opposite of the
artifact signature; stronger play exploits first-mover tempo harder, so E3 (tap-order mechanism
split) is moot. (2) E2: RD15 fails too — **the seat edge is a base-game property** (~+5 at r8),
not an RD12 regression (RD12 adds ~+1.3, inside joint noise). RD12 is exonerated; the §6–§9-era
"+2.6/+2.8" reads were under-powered mirrors, not a healthier game. (The §13p panel's r12 mirror
read of −0.4/+2.0 came from 1,600 mirror games vs the probes' 4,000; probes govern.)

**Step 2 — compensation sweep (mirror-only, r8 @RD12): the Hearthstone-style lever works.**
`firstPlayerCompensation: 'card'` (second player draws +1 at game start): FP edge
**+2.08 [0.53 … 3.62] — PASS** (from +6.43 uncompensated; ledger `fp-comp-card-r8-rd12`).
The sweep's `resource`/`both` arms were pre-empted: `card` is the minimal lever, it clears the
gate, and it is the established genre solution (HS coin, MtG play/draw). r12 confirmation run
queued (pooled r8+r12 will put ~8,000 mirror games on the estimate); `both` would only risk
overshoot. `play_or_draw` is engine-modeled as `card` (sim-runner header) — same lever.

**Step 3 — ablation battery (partial; compute-constrained).** One of seven completed before the
shared machine reclaimed the cores: `RULE_OFF=armFirstInstanceOnly` @RD12 (ablation preset,
ledger `abl-armFirstInstanceOnly`): rollout-low spread 1.6, rollout-high 8.8 — no collapse, no
pathology; retained on the fidelity/no-harm grounds of the retention rule. The remaining six are
queued (`balance-runs/lowimpact-chain.sh`); per the pre-registered retention rule, four of them
have standing retention cases independent of the ablation data — `reserveTapChoice` (Rulebook 8
step 4 "may" — rules fidelity, locked regardless), `reserveTapStrain` (designer sign-off, §13m),
`costFloor` (§12c infinite-loop guard — named pathology), `terminationMode` (stall-class/
transform-deadlock guard — named pathology). `exileDiscardForEnergy` additionally has the §13-era
denergy A/B on record (spread 15.81 → 15.17 with the rule on). The battery remains worth running
for the record, but no retention decision hinges on it alone.

**Step 4 — adoption decision (PROVISIONAL, pending the ratification panel).** On the evidence
above, the ruleset-v1 composition is:

| Rule | Disposition | Basis |
|---|---|---|
| `reserveTapChoice` | LOCK | Rulebook fidelity + §13n panel |
| `reserveTapStrain` | LOCK | Designer rule (§13m) + §13n panel (spread −7) |
| `armFirstInstanceOnly` | LOCK | Ablation clean; adopted since pre-§13 |
| `terminationMode: resource_deck_empty_transform` | LOCK | Stall-ender; decided 100% on every §13q panel |
| `costFloor` | LOCK | §12c loop guard |
| `exileDiscardForEnergy` | LOCK | §11 discard-bot fix + denergy A/B |
| `resourceDeckSize: 12` | **ADOPT + LOCK** | §13p spread 9.6; §13q verdict-layer read 10.1; FP-exonerated by E2 |
| `firstPlayerCompensation: 'card'` | **ADOPT + LOCK** | Step 1 real FAIL (+6.6 @r12) neutralized to +2.08 PASS; base-game defect, not RD12's |

**Interlude — the card gate's first vetoes (the framework earning its keep).** The §13p queue-2
prescription (1-cost cuts on Shieldbearer/Protector/Faithkeeper) FAILED the gate's static stage:
those three are the pricer's biggest OVER-budget flags (+3.5/+6.0/+2.6 beyond tolerance after
the cut) — cutting their cost pushes them further over; the §13p brief had read "over-budget"
as "has headroom" when it means the opposite. Take 2 (buff arm by cost: Banner 4M→3M, Uriel
7M→6M) also failed: the character budget slope is ~4.8 power/cost, so a full 1M step on Uriel
overshoots to +3.3 over. **Take 3 — Symphonic Banner 4M→3M + Uriel +1 HP (4/3/0→4/4/0)** — is
static-clean (SIM-NEEDED grade, synergy-cap notes only) and awaits its graded FOCUS=Radiant
run: pool `CURRENT-plus-ht2b2-payload-radiant` sha `340607a91bb5cba3`. Two semantics lessons
were codified: (a) budget deviations grade SIM-NEEDED, hard-stop only for loops/hero-band/
egregious (>4 power points past tolerance — `cardGate.staticOverBudgetHardFail`), because the
sim is the verdict layer and every deliberate rebalance moves cards relative to budget; (b) the
suggestions module and the audit carry different budget models (Uriel: −1.5 vs +1.3 at
baseline) — a known inconsistency; the audit is the gate's pricer, the sim arbitrates.

**The gate's first graded verdict (take 3, FOCUS=Radiant, ledger
`2026-07-10_card-gate_340607a9_gate-Radiant`): FAIL — and the rejection is the framework's
strongest validation yet.** The patch FIXED the target cell (R v V 34.1 → 45.3) but collapsed
Radiant v Onyx 45.3 → 30.2 (past 65/35, ~5σ beyond noise) and worsened the like-for-like spread
16.8 → 26.6; Radiant's marginal net-DROPPED 45.8 → 44.1. Formula-blessed buffs shifted the
faction's matchup texture without lifting it — the exact fixes-one-cell-breaks-another failure
mode the gate exists to catch, invisible to the pricer and to any single-cell eyeball. Radiant
relief iteration continues as ordinary post-lock card work (each take is one ~35-min gate run);
the rule lock proceeds on the unpatched pool per the pre-registered plan, R v V logged as the
open card-track item.

**Takes 4 and 5 (Verdant side: Guardian Spirit MK-III 6E→7E, then −1 ATK): both "FAIL" — and
the failure pattern exposed a measurement confound that RETRACTS all three gate verdicts.**
Take 4 fixed the target cell (V v R 67.1 → 59.0) but read V v Onyx 48.1 → 32.4; take 5 (a pure
stat trim, no cast-window change) read V v O 31.3 — three DIFFERENT edits (a Radiant buff, a
cost bump, a stat trim) all "collapsing" the focus faction's Onyx cell by ~15 pp. Cards don't
do that; instruments do. Diagnosis chain (2026-07-10 evening):
1. **Shared seed stream:** game seeds are `seedBase + pairingIndex·100003 + gameIndex·7919`
   (sim-runner ~:1391) and FOCUS mode always puts the Onyx cell at pairing index 0 — the three
   "independent" collapses were ONE observation. Still ~6σ vs the full panel — not stream luck.
2. **Seat-swap A/B (the decisive control, 2×2,000 heuristic games, same seeds):** V v O reads
   **68.0% with Verdant in seat 0 vs 72.8% with Verdant in seat 1** (Δ4.8 pp, ~3.3σ) — and the
   effect persists with comp on (69.3 vs 74.5) and with first-player% equal in both arms.
   **The engine (or bot) carries a seat-index asymmetry**, distinct from the first-player axis.
3. Scope of the taint: FOCUS mode seats the focus faction at p0 while all-pairs seats
   alphabetically — so every FOCUS-vs-full comparison (the card gate's Stage B) measured the
   seat effect, not the card. Worse: EVERY historical panel seated Onyx at p0 in all its cells
   and Verdant at p1 in all of its — faction marginals, the R v V 33% cell, and the
   ratification spread 10.6 all embed seat bias of unknown per-cell size. Mirror-FP probes
   remain valid (identical decks cancel the seat axis). The earlier "RD12 quantization law"
   note above is RETRACTED pending seat-clean re-measurement — the 15 pp swings it explained
   were the instrument, not the income cap.
4. Remediation in flight: (a) locate the seat-indexed code path (suspect: simultaneous
   trigger/upkeep ordering by seat instead of active-player-relative — a rules-fidelity
   question against the Rulebook's priority system); (b) regardless of the engine verdict,
   add seat alternation to the measurement harness (the seat-axis twin of
   `firstPlayer: 'alternating'`) so panels are seat-neutral by construction; (c) re-baseline
   and re-run ratification seat-clean. The lock machinery (balance-lock.mjs) is unaffected
   and waits on the clean panel.

Pre-registered ratification acceptance (unchanged): pooled r8+r12 spread ≤10 (aspiration ≤6),
no faction CI clearing 43/57, worst cell ≤70/30, mirror FP ≤+3 with comp, decided ≥85%, ladder
converged. **The lock is NOT declared until that panel runs and passes** — with COMP=card in
BASE for the first time, the panel is also the first full-matrix read of the compensated game
(comp was measured on mirrors; the cross-matchup effect needs the panel). Known watch item
going in: Radiant ~43.0 at the verdict layer — the R-v-V card fix (§13p queue 2) is the
designated remedy and runs through the new card gate as its first client.

**Ratification attempt 1 (seat-confounded, ledger `ruleset-v1-ratification`, 2026-07-10):
5/6 PASS, spread 10.6 vs ≤10 — FAIL by 0.6 pp, all of it the R-v-V cell.** Routed to the card
track per protocol; the card takes then exposed the seat confound (above), retracting both the
takes AND this panel's read.

**Ratification attempt 2 (seat-clean: apnapAnyOrderFix + seatAlternation adopted, ledger
`2026-07-11_verify_34cf3a28_ruleset-v1-ratification-v2`): ALL 12 GRADE ROWS PASS — RULESET v1
IS LOCKED** (`sim-data/ruleset-v1.json`, written by `balance-lock.mjs`, defended by
`tests/sim/ruleset-v1-lock.test.ts`, 4/4 green):

| Criterion | Measured | |
|---|---|---|
| Pooled r8+r12 spread | **6.3 pp** | PASS (target ≤10; a whisker from the ≤6 aspiration) |
| Faction CIs | O 50.6–54.6, R 44.4–48.4, S 46.5–50.5, V 50.5–54.5 | PASS |
| Worst cell | **R v V 37.6/62.4** (dev 12.4, n=800) | PASS — inside 65/35 |
| Mirror FP (comp on) | **+0.5 pp** | PASS |
| Decided | 100% | PASS |
| Convergence r8→r12 | max drift 4.4 pp (Sapphire), all CIs overlap | PASS |

**The denouement: the "one broken cell" was mostly instrument.** Seat-clean, R v V sits at
37.6/62.4 without ANY card change — Verdant's seat-1 inflation and Onyx's fixed seat-0 history
were carrying the 32.9/67.1 read. Card takes 1–5 are closed as unnecessary; the §13p queue-2
item is resolved by measurement repair, not card surgery. Program parity-spread history, final:
**54.8 → 25.1 → 22.4 → 19.6 → 20.6 → 20.4 → 13.2 → 9.6 → 6.3 (locked)**.

Locked ruleset v1 (nine rules): `armFirstInstanceOnly`, `terminationMode:
resource_deck_empty_transform`, `costFloor`, `reserveTapChoice`, `reserveTapStrain`,
`exileDiscardForEnergy`, `resourceDeckSize: 12`, `firstPlayerCompensation: 'card'`,
`apnapAnyOrderFix`. Measurement standard: alternating first player AND alternating seats.
Amendment procedure per docs/balance-framework.md §1 — v1 never mutates. The §13 series closes
here; future card work goes through the gate (`pnpm balance card`), future rule questions
through the amendment procedure.

### 13r. Post-lock probe — the "resource-skip" second-player compensation (2026-07-11)

Designer proposal, evaluated under the amendment machinery two days after the lock: replace
`firstPlayerCompensation: 'card'` with a package where the first player DRAWS normally on turn 1
(removing the printed skip-draw penalty) but does NOT draw a resource card on their first Upkeep
— a permanent one-resource-card offset that, under RD12 + transform-on-empty, also delays the
first player's transform gate by one turn. Napkin from prior probes: one card swing ≈ 4–6 pp of
first-player edge, so the resource package had to be worth ~10–12 pp to land at even.

Engine variants `firstPlayerSkipsFirstResource` + `firstPlayerDrawsNormally` (default off,
byte-identity tested), probed mirror-only via `FP_VARIANT=resource_skip` at 4,000 mirror
games/condition (ledger `fp-rskip-r8-rd12`, `fp-rskip-r12-rd12`):

| Condition | FP edge (pp over 50) | vs ±3 gate |
|---|---|---|
| r8 @RD12 | −3.83 [−5.37 … −2.28] | FLAG (over-corrects) |
| r12 @RD12 | **−4.08 [−5.61 … −2.53]** | FLAG (over-corrects) |

**REJECTED — the package over-corrects: the SECOND player becomes favored beyond the band**
(the compounding resource+transform tax is worth ~14–16 pp of swing, more than the ~10–12
needed). The locked `card` compensation stands (+2.08 probe / +0.45 ratification). The variant
flags remain in the engine as measurement instruments; a softer sibling (first resource enters
exhausted rather than skipped) is the noted next candidate if the no-free-cards aesthetic is
ever revisited.

### 13s. Completion battery — every §13q promise closed seat-clean (2026-07-12)

All runs under the locked manifest (loud override banners otherwise), ledgered:

**comp-card confirmation @r12 (ratified pool, 4,000 mirrors): +2.33 [0.78 … 3.87] — PASS.**
The compensation rule is now confirmed at every rung it can be measured at.

**Step-3 ablation battery, complete** (rollout-low/high spreads; locked baseline ≈ 5–11):

| RULE_OFF | Spread (r4 / r8) | Reading |
|---|---|---|
| terminationMode | **37.1 / 32.0** | catastrophic — the transform-on-empty rule carries the late game |
| apnapAnyOrderFix | 9.7 / **15.8** | clearly worse — the fidelity fix earns its place on balance too |
| reserveTapChoice | 7.1 / **14.7** | worse — retained (also Rulebook-fidelity-locked) |
| costFloor | 3.6 / 9.7 | spread-neutral — retained on the §12c loop-pathology ground |
| reserveTapStrain | 5.1 / 7.5 | neutral — retained on designer sign-off + §13n package evidence |
| exileDiscardForEnergy | 4.7 / 5.7 | neutral — retained on the §11 graveyard-fuel ground |
| resourceDeckSize→15 | 14.7 / 5.7 | mixed at ablation n — RD12's case rests on the full panels |

Every retention ground pre-registered in Step 3 held; two rules upgraded from
principle-retained to evidence-retained.

**Card-gate validation, both directions:** a byte-identical no-op pool PASSes (static
short-circuit, no sim burned); the historical §8 Sapphire redesign — the pool the static pricer
approved and the sim later read at 60–72% — is REJECTED outright by the hardened gate against a
fresh seat-clean CURRENT-pool baseline (`sapphire-val-baseline`): Sapphire marginal **71.5%**,
all three cross cells 70–72%, every acceptance rule FAILed (ledger
`2026-07-12_card-gate_396fd91f_gate-Sapphire`). The gate demonstrably catches the class of
destructive change it was built for, under the rules it governs.

With that, the external audit's path-to-100% is closed: manifest consumed as the source of
truth, gate hardened and validated, batteries complete, pre-registration committed. The
balance program's evidentiary record is whole.

## §14. Layer 2 — deck-space balance (2026-07-13 → )

The designer's three-layer model (adopted as the program's official taxonomy): **Layer 1**,
cards priced in abstraction against a formula with leeway (built — the pricer); **Layer 2**,
cards balanced in the context of the pool decks are built from (this chapter); **Layer 3**,
cards balanced in live interaction (built, but only ever measured on the four fixed starter
decks). Layer 2 is measured with a frozen, versioned deck set (`sim-data/deck-sets/
constructed-v1.json`: 5 archetypes × 4 factions from deck-sampler.mjs, fixed seed 20260713,
ratified pool) driven through a new deck-vs-deck panel (`balance-deck-panel.mjs`), under the
locked ruleset and the standard measurement config (alternating first player + seats).
Plan of record: the externally-reviewed 8-step ladder (Terra, 2026-07-12), committed in this
chapter as executed.

### §14a. Pre-registered decision rules (written BEFORE any Layer-2 run)

**Step-4 screen (20 set decks × 4 starter decks, 64 gpp, r8):** a SCREEN, not a verdict — its
only output is selection: per faction, carry the strongest and the median sampled deck (by
win% vs the pooled starter field) into the step-5 field. Health anomalies (pacing WATCH bands
from balance-targets.json) are noted for step-5 attention, never graded here.

**Step-5 field (8 selected decks, round-robin incl. same-faction, 128 gpp, r8+r12):**
- A set deck is a **deck-balance problem** iff its pooled r8+r12 win% vs the field exceeds 57
  AND it beats its own faction's median deck with CI separation (Wilson 95%) — the
  "auto-deck" signature.
- An archetype is a **template-or-package problem** iff it sits below 43 pooled across BOTH
  its factions' entries in the field (not a card-quality verdict until step-6 triage).
- A **hidden game-balance problem** iff any pairing shows pacing beyond the WATCH bands
  (natural-kill <85%, tiebreak >15%, p50 outside [23,43], leader@10 >64, comeback <36) with
  n ≥ 128 — recorded and escalated per the framework's change-type tree (cards first).
- Close/alarming cells may be extended to 512 games; nothing else is re-run.

**Step-6 triage (card-usage report):** never-sampled ⇒ template gap (fix template or note "no
home yet"); included-but-rarely-used in ≥2 reasonable homes ⇒ dead-card candidate;
included+used across winning styles ⇒ auto-include suspect. Only suspects surviving triage
get step-7 trials.

**Step-7 matched pairs (with/without the suspect vs 3 representative opponents, 128 gpp r8;
strongest findings confirmed r12):** removal hurts in TWO homes with CI separation ⇒ real
auto-include; removal changes nothing AND the card is rarely used ⇒ redesign candidate;
matters only alongside a package ⇒ adjust the package, not the card. Any resulting edit goes
through the card gate; the pricing formula is never tuned to these results.

Results follow below as they land; every run ledgered.

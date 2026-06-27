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

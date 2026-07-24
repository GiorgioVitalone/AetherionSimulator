# Aetherion Balance Targets & Verification Protocol

**Status:** living document — re-check the bands each balance pass.
**Last updated:** 2026-06-27.
**Scope today:** the 4 official starter decks (Onyx, Radiant, Sapphire, Verdant). Crimson & Amethyst have no card data yet and are out of scope until they do.

This document records (1) the **numeric balance goals** we hold ourselves to, derived from how real competitive card games are actually balanced, and (2) the **protocol** for measuring our game against them credibly. It exists so the goals are written down and stable rather than re-argued each time.

---

## 1. Why these numbers (provenance)

There is **no universal "balanced" number** — every credible figure is meta/patch-dependent. The targets below are anchored to published aggregator data and developer statements from the games with the richest, most rigorous data. **Hearthstone is the closest analog** (a fixed roster of "classes" ≈ our fixed factions); MTG Limited (17Lands) supplies the cleanest first-player figure.

| Benchmark | Value | Confidence | Source (date) |
|---|---|---|---|
| "Viable deck" win-rate band | **~47–53%** (~6 pp wide; **width floats with the meta**) | High | Vicious Syndicate Power Score, vS Data Reaper Report (2026) |
| Normal "best deck" win rate | **~53%** | High (dev) | Ben Brode, HS Game Director (2017) |
| "Dangerous"/peak outlier deck | **~55–57%** | Medium (soft) | Dean Ayala, Blizzard |
| Worst broken deck ever (Undertaker Hunter), ~25% meta share | **~60%** | Medium (not a hard ceiling) | HS dev-era reporting |
| Even matchup | **45–55%** | High | HS Win-rate wiki |
| Realistic "bad matchup" extreme | **~70/30 → 80/20** (90/10 is speculative, ~never seen) | High | HS wiki + vS data |
| First-player advantage | **+2 to +2.7 pp** on the play (52.2–52.7%), SD ~1.1 pp, 53.9M games | High | 17Lands (pooled cross-set) |
| Single-deck meta-share cap | **~10%** (≥25% = historic alarm) | Medium (dev) | Second Dinner / Marvel Snap (2025) |
| Viable-deck count target | Riot aimed **~10**; says HS/MTG usually **2–5** | Medium | Riot / Legends of Runeterra (~2021) |
| Devs reject *exact* 50% parity as a literal goal | "would not be fun" | Medium | Riot |

**Methodology anchors worth copying:** Vicious Syndicate report #352 ran **1.4M games stratified across 6 rank brackets**; 17Lands uses **per-game** as the unit of analysis, reports **Wilson 95% confidence intervals**, and keeps a **min ~100 games/matchup** floor.

### Do NOT cite these — adversarially refuted during research
Kept here so nobody re-adds the myths: the Hearthstone "going first = 51.65% / +3.3% coin advantage" stat (refuted); **all** Pokémon TCG meta numbers (refuted — paper-game data too sparse to verify); "55% is *the* hard nerf line" and "nothing ever broke 60%" (both overreach — treat the dev numbers as soft reference points, not hard rules); a "Druid 57% class peak" and a "Jan-2017 4 pp top-tier spread" (both refuted).

---

## 2. The targets (mapped to our metrics)

> The machine-readable canonical copy of these thresholds lives at
> `packages/engine/sim-data/balance-targets.json`; on any conflict between this
> table and that file, **the JSON wins**. Threshold changes require a cited
> full-panel ledger run id.

Because our 4 factions only play **each other** (a closed round-robin), wins and losses sum to zero across the pool — the **field average is pinned to ~50% by construction**. So the meaningful quantity is the **spread around 50%**, not an absolute level. "Every faction inside 47–53%" is therefore read as "≤6 pp spread centered on 50%."

| Metric | ✅ Healthy | ⚠️ Flag / watch | ❌ Imbalanced | Anchored to |
|---|---|---|---|---|
| **Per-faction win %** (round-robin, non-mirror) | 47–53% (core 48–52%) | <45% or >55% | sustained <43% or >57% | vS viable band + HS "dangerous >55%" |
| **Parity spread** (max−min faction) | **≤6 pp** | >6 pp | >8–10 pp | vS ~6 pp band width |
| **Worst matchup cell** (per ordered pair) | within 65/35 | >70/30 | >80/20 | HS even-band + real-data extremes |
| **First-player edge** (measured on mirrors) | **≤+3 pp** over 50% | >3 pp | >5 pp | 17Lands +2.7 pp, SD 1.1 |
| **Single faction/archetype meta share** \* | ≤~10–15% | >15% | ~25%+ | Marvel Snap cap / HS alarm |
| **Decided %** (own hygiene, not external) | ≥~85% | <85% | <70% | timeouts bias against control decks |

\* Only relevant once we model an actual *metagame* (e.g. the Nash-equilibrium deck distribution over the matchup matrix). At equal play it is moot.

### Watch metrics (ungated)

**Status:** WATCH-grade only — these are NOT part of the locked ruleset-v1 acceptance criteria above and never FAIL or affect an exit code. Added §13s-era per an external audit finding a blind spot: `decided%` counts turn-cap tiebreaks as decided, so a degenerate tiebreak-heavy meta would still pass that gate — natural-kill share is the missing guard. Bands measured on the 3 rollout pilots of the ratification archive (`balance-runs/runs/2026-07-11_verify_34cf3a28_ruleset-v1-ratification-v2.json`, 2026-07-11); see `sim-data/balance-targets.json` `thresholds.pacing.provenance` for the exact figures. `balance-verify.mjs` prints these per agg pilot as `Pacing (watch)`.

| Metric | Measured (ratified baseline) | ⚠️ WATCH |
|---|---|---|
| **Natural-kill %** (winMethod.kill share) | ~100.0% | <85% |
| **Tiebreak %** (winMethod.tiebreak share) | ~0.0% | >15% |
| **Turns p50** (pooled, games-weighted) | 32–33 | <23 or >43 |
| **Leader-at-10 win % conversion** (turn-10 leader who goes on to win) | ~51.7–52.7% | >64% |
| **Comeback %** (turn-10 leader overturned) | ~47.3–48.3% | <36% |

---

## 3. Three caveats that govern how the targets are applied

1. **These are human-on-tuned-decks numbers; ours are bot-on-starter-decks.** The *spreads* are the right goalposts, but the data behind them comes from large human samples on evolving, balance-tuned decks — the opposite of our setup. So apply these thresholds to a **trustworthy** measurement (see §4), never to raw single-bot output. And because starter decks are deliberately simple and **not** balance-tuned, treat 6 pp as the *aspiration*: a spread up to **~8–10 pp** at the starter-deck stage is "watch," not necessarily a card-balance defect.

2. **The band floats every patch.** vS explicitly states the viable range "will vary" — its ceiling is pinned to whatever the current strongest deck is. Re-derive the band from our own strongest faction each balance pass; don't hard-code 47–53% as a law. The dev thresholds (53 / 55–57 / 60%) are soft reference points, not proven limits.

3. **Parity is a band, not a point.** Per Riot, exact 50.0% is neither achievable nor desirable. A faction at 51.8% is not a problem; a faction at 58% is.

---

## 4. How we verify against these targets (the protocol)

A balance number is only as good as the player generating it. A single heuristic bot is **not** trustworthy here — in this engine the top faction *flips* between the random bot and the heuristic bot. So the protocol is built to expose that, not hide it.

**Controlled design**
- Run the **real 4 starter decks** (committed `packages/engine/sim-data/aetherion-decks.json`), full all-pairs **including mirrors**.
- **`firstPlayer: 'alternating'`** so each deck goes first equally often (removes the first-player confound from faction win %). **Mirrors are the first-player control** (any deviation from 50% there is pure going-first advantage + noise).
- **`fixHandSizeStall: true`** + a documented timeout policy (`termination: 'tiebreak'`, LP then board); **report `decided %`** so stalls are visible, never silently dropped.

**Pilot panel (the core move)** — measure balance as the quantity that is *invariant across independent pilots of increasing strength*:
- `random` — null model / floor.
- `heuristic` — cheap, archetype-biased reference (board-value/grind).
- `rollout` — outcome-driven MCTS pilot with **no archetype prior**; run it at **increasing budgets** (e.g. rollouts 8 → 16 → 32, depth 3 → roll-to-end) as a **skill axis**.

**Gates** — only promote a result to "established" if:
- **Convergence:** win rates have stopped moving as rollout budget rises (if a cell is still moving at the top of the ladder, it is *undetermined — needs stronger play*).
- **Agreement:** the strongest 2–3 pilots agree on ranking and sit on the same side of 50% with overlapping CIs. Disagreement → reported as **measurement-limited**, with "improve the pilot" as the action item, not a balance verdict.

**Statistics**
- **Per-game** as the unit of analysis.
- **Wilson 95% CIs** per faction and per matchup cell; G-test for overall imbalance; bias-corrected parity spread with a bootstrap CI (all already in `packages/engine/src/stats/`).
- **Multiple-comparison correction** (Holm/FDR) across the matchup cells.
- **Sample size:** floor **100 games/cell** (vS practice); target **2,000–5,000 games/cell** so a 50% Wilson CI is ≈ ±1.5–2 pp — enough to resolve a 5 pp imbalance. Pre-register seeds (the runner is deterministic via `runHash`).
- **Read the verdict off CIs**, not point estimates: a faction is "imbalanced" only if its CI clears the threshold after correction.

**Verdict rule.** For each metric, emit `PASS` / `FLAG` / `FAIL` against the §2 thresholds, **per pilot**. The headline verdict is the *agreement* across the strongest pilots; where they disagree, the honest output is "undetermined (measurement-limited)," and the next action is a stronger pilot — not a card change.

---

## 5. One-line summary

Target every faction inside **47–53%** (spread **≤6 pp**, ~8–10 pp tolerated for un-tuned starters), no matchup worse than **~70/30**, mirror first-player edge **≤+3 pp**, decided **≥85%** — and only trust the numbers once the **random / heuristic / rollout** pilots **agree** and the rollout has **converged**.

---

## 6. Verification run — 2026-06-27 (first measurement)

**Method.** Real 4 starter decks (committed fixture), all-pairs incl. mirrors, first player **alternating**, hand-size stall fixed, undecided games LP-tiebroken. Pilot panel run via `packages/engine/balance-verify.mjs`, deterministic (seeded). Reproduce: `cd packages/engine && node balance-verify.mjs` (env knobs `GPP_MATRIX`, `RL_GPP`, `RH_GPP`).

| Pilot | Games | Radiant | Verdant | Onyx | Sapphire | Parity spread |
|---|---|---|---|---|---|---|
| `random` (floor) | 10,000 | 94.2% | 57.2% | 14.8% | 33.8% | 79.3 pp |
| `heuristic` | 10,000 | 81.6% | 43.1% | 37.1% | 38.2% | 44.5 pp |
| `rollout` r4/d2 | 200 | 73.3% | 73.3% | 31.7% | 21.7% | 51.7 pp |
| `rollout` r8/d3 | 100 | 73.3% | 73.3% | 40.0% | 13.3% | 60.0 pp |

Heuristic CIs are tight (±~1.5 pp); rollout CIs are wide (±~12–18 pp, small n).

**Result: FAIL on every faction-level target — and it is a _trustworthy_ FAIL.** All four pilots, including the archetype-neutral outcome-driven `rollout`, independently rank **Radiant #1 by a wide margin** (73–94%), and the two rollout budgets agree (converged). Because the verdict does **not** flip with pilot strength, this is real faction imbalance, not a bot artifact — the central validity risk is cleared.

| Target | Result | Observed vs target |
|---|---|---|
| Faction win% in 47–53% | ❌ FAIL (all factions) | Radiant 73–94%, Sapphire 13–38%, Onyx 15–40% |
| Parity spread ≤6 pp | ❌ FAIL | 44–79 pp (≈7–13× over) |
| Worst matchup within 30/70 | ❌ FAIL | Radiant→Onyx 99%, Radiant→Sapphire 88% |
| Mirror first-player ≤+3 pp | ✅ PASS | **+2.6 pp** (heuristic, real-finishing games) — matches the 17Lands +2.7 pp benchmark |
| Decided ≥85% | ⚠️ not meaningfully tested | tiebreak forces 100%; avgTurns ≈31 (heuristic) implies games close — re-run with `termination:'none'` to measure true stall rate |

**Confidence by faction.** *High* on the extremes — **Radiant is overpowered** and **Sapphire is weakest** under **every** pilot. *Medium* on the middle: **Verdant** looks mediocre under the heuristic (43%) but ties Radiant at the top (73%) under the rollout — the classic **under-piloted-faction** effect (the heuristic doesn't pilot Verdant's plan well; outcome-driven search does), so Verdant is plausibly *also* top-tier and its true rank is unsettled pending a larger rollout. **Onyx** is weak-to-mid.

**Headline.** The starter pool is severely imbalanced — roughly **Radiant (/Verdant) ≫ Onyx ≫ Sapphire** — with a parity spread ~7–13× the target and multiple near-unwinnable matchups. **Turn order is not the culprit** (first-player advantage is healthy at ~+2.6 pp); raw faction power is. Next step is balance work on the decks/cards, then re-run this exact (deterministic) panel after each change to watch the spread close toward ≤6 pp.

---

## 7. Verification run — 2026-07-02 (post-patch, CURRENT pool)

**Method.** Same protocol as §6, on the **CURRENT** pool — the narrow (0.6-window) budget patch (30 edits) + all hero LP flattened to 30 — regenerate with `node make-pools.mjs`, sha256 `6928b4ab3b7ef915`. Two rules changes now in the standard `BASE`: `armFirstInstanceOnly` and `terminationMode: 'resource_deck_empty_transform'`. Sizes: `GPP_MATRIX=3000` (30,000 games per matrix pilot), `RL_GPP=48`, `RH_GPP=24`. Run executed on external hardware; **cross-verified** by reproducing the rollout-low leg in a clean environment against the sha-verified pool — `runHash 3c016733bc4145cb` matched bit-for-bit.

| Pilot | Games | Radiant | Verdant | Onyx | Sapphire | Parity spread |
|---|---|---|---|---|---|---|
| `random` (floor) | 30,000 | 80.7% | 61.0% | 31.7% | 26.7% | 54.0 pp |
| `heuristic` | 30,000 | 57.0% | 54.3% | 45.6% | 42.7% | **14.3 pp** |
| `rollout` r4/d2/c5 | 480 | 52.8% | 65.3% | 56.3% | 25.7% | 39.6 pp |
| `rollout` r8/d3/c8 | 240 | 48.6% | **79.2%** | 55.6% | **16.7%** | 62.5 pp |

Heuristic CIs ±~1 pp; rollout CIs ±~8–11 pp (low) / ±~11–12 pp (high).

**Result: two factions fixed, two confirmed broken — in opposite directions.**

| vs §6 (raw pool) | §6 rollout-high | Now | Verdict |
|---|---|---|---|
| Radiant | 73.3% | 48.6% | **fixed** — falls monotonically with pilot strength (80.7→57.0→52.8→48.6); its residual edge only punishes weak play |
| Onyx | 40.0% | 55.6% | **fixed** — stable ~56 at both rollout budgets, watch |
| Sapphire | 13.3% | 16.7% | **still FAIL (too weak)** — last under all four pilots; both rollout CI upper bounds (33.4, 26.9) clear the 43% fail line. The "no win condition" diagnosis; the Sapphire redesign pool is the staged fix |
| Verdant | 73.3% | 79.2% | **FAIL (too strong)** — first at both rollout budgets with CI lower bounds (57.2, 68.4) clearing 57%; **rising** with budget, so not converged: read as "≥ ~65, possibly worse" |

**Hygiene:** mirror first-player edge **+2.8 pp** (heuristic, 11.5k mirror games) — PASS, again matching the 17Lands +2.7 anchor. Decided 95.9% — PASS (17.7% hit the turn cap, tiebroken). Worst heuristic cell Radiant→Sapphire 67.8% — inside 70/30, watch. At *random* play the mirror first-mover edge is +8.75 pp — the rules reward going first heavily under bad play; competent play erases it (rollout mirrors +1.6).

**Two caveats on Verdant.** (1) The heuristic-vs-rollout gap (54.3 vs 65–79) confirms the heuristic under-pilots ramp — but the rollout has no archetype prior, so Verdant's strength is *real*, needing card nerfs, not just a better bot. (2) Verdant posts these numbers with **3 dead cards** — Grovekeeper 3000 ×3 is a broken all-zero entry in the committed fixture (X-cost design never made it into the data; DB regeneration pending). Its true strength is a **floor**.

**Headline.** The budget patch + LP-30 + two rules changes cut the heuristic spread 44.5 → 14.3 pp and fixed Radiant and Onyx under strong play. Remaining work, in evidence order: apply the Sapphire redesign (worst FAIL), regenerate the fixture from the DB (Grovekeeper), then nerf Verdant — re-running this exact panel after each step.

---

## 8. Verification run — 2026-07-02 (Sapphire redesign pool)

**Method.** Identical protocol and sizes as §7, on **CURRENT-plus-sapphire-redesign** (sha256 `396fd91fac214ef3`; regenerate with `node make-pools.mjs`) — the §7 pool with `docs/sapphire-redesign-proposal.md`'s 9 redesigns + 2 tweaks applied to 11 Sapphire cards. Cross-verified two ways: the rollout-low leg reproduced bit-for-bit in a clean environment (`runHash c704cddab229029f`), and all six non-Sapphire random-pilot matrix cells are **byte-identical** to §7's (deterministic seeds + only Sapphire cards changed ⇒ non-Sapphire matchups replay exactly; all six Sapphire cells moved in Sapphire's favor).

| Pilot | Games | Radiant | Verdant | Onyx | Sapphire (§7 →) | Parity spread |
|---|---|---|---|---|---|---|
| `random` (floor) | 30,000 | 72.6% | 55.6% | 29.9% | 26.7 → **41.9%** | 42.7 pp |
| `heuristic` | 30,000 | 47.0% | 45.2% | 37.5% | 42.7 → **71.5%** | 34.0 pp |
| `rollout` r4/d2/c5 | 480 | 44.4% | 51.4% | 43.8% | 25.7 → **60.4%** | **16.7 pp** |
| `rollout` r8/d3/c8 | 240 | 37.5% | 58.3% | 36.1% | 16.7 → **68.1%** | 31.9 pp |

**Result: the redesign works — and overshoots hard.** Sapphire goes from last under every pilot to **first under every strong pilot** (heuristic CI 70.5–72.4 clears the 57% line massively), beating all three factions near-uniformly (76/64/74% heuristic cells) — a flat power overshoot, not one polarized matchup. Two findings worth keeping: the deck is now **pilotable at every skill level** (even random play rose 26.7 → 41.9 — a win condition exists), and rollout-low's 16.7 pp is the healthiest rollout-level spread yet measured — the pool is close, just centered on the wrong faction.

**The instructive failure: the budget model approves this pool.** Refit on the redesign itself, only Arcane Focus Blade (+0.5) and Arcane Echoes (+0.2) sit marginally over the line, and Spellbound Adept grades *under*-budget — while the sim reads 60–72%. §11f's budget-blind-spot lesson, mirrored in the buff direction: per-card budgets cannot see a synergy engine. Mechanism: the §7 budget patch had already discounted Sapphire's costs for its *old, weak* effects (deck avg cost 3.13 → 2.67; 18/40 cards ≤2 mana); the redesign then made those effects strong **without the stale discounts moving** — strong effects at weak-effect prices.

**Staged next step (v2 trim, function-preserving, stale discounts first):** Arcane Echoes 1→3 mana; Master Archivist 3→4 mana (keeps the ATK-4 redesign); Arcane Focus Blade 2→3 mana; Arcane Storm reach cap 6→4. Engine cores (Scholar, Adept, Librarian, draw spells) deliberately untouched — they are the archetype. Re-run the panel; if Sapphire still >55%, the engine cores are the next lever.

**Hygiene:** mirror FP +3.0 pp (heuristic) — PASS, third consecutive run on the 17Lands anchor. Decided 96.5% — PASS. Worst cell Sapphire→Onyx 76.4% — FLAG (>70/30). Verdant reads 58.3% at rollout-high *while suppressed by super-Sapphire* — its too-strong verdict from §7 stands and returns to the top of the queue once Sapphire is trimmed.

---

## 9. Verification run — 2026-07-02 (hero-tune pool)

**Method.** Identical protocol and sizes as the §13d v2 baseline (GPP_MATRIX=3000; rollout rungs 300/200/120 gpp; v2 instrument incl. cost floor), on **CURRENT-plus-hero-tune** (sha256 `44dbb1870ec34b65`; regenerate with `node make-pools.mjs`) — the frozen CURRENT + the §13e hero three-window knob tune (9 aura-safe cost/cooldown knobs across all four heroes) + the Grovekeeper 3000 X-cost hand-fix. Provenance verified without re-simulation: pool re-derives bit-identically to the pre-registered sha, config echo matches, and the run carries the tune's mechanism fingerprints (`balance-diagnosis.md` §13f) — from this run on, `balance-verify.mjs` embeds the pool path + sha in its header and output JSON, so runs self-certify (rung hashes on record: `9e8abe51fa4e1f18` / `153902d4526f35c9` / `09d68d0720c1fe7b`).

| Pilot | Games | Radiant | Verdant | Onyx | Sapphire | Parity spread |
|---|---|---|---|---|---|---|
| `random` (floor) | 30,000 | 78.0% | 66.3% | 28.7% | 27.0% | 51.0 pp |
| `heuristic` | 30,000 | 51.3% | 65.0% | 33.4% | 50.3% | 31.6 pp |
| `rollout` r4/d2/c5 | 3,000 | 49.6% | 62.8% | 41.0% | 46.7% | 21.8 pp |
| `rollout` r8/d3/c8 | 2,000 | 46.5% | 65.7% | 41.0% | 46.8% | 24.7 pp |
| `rollout` r12/d3/c8 | 1,200 | 45.3% | 70.3% | 44.4% | 40.0% | 30.3 pp |
| **pooled r8+r12** (§13d →) | n=960/faction | 52.3 → **46.0%** | 73.9 → **67.4%** | 54.8 → **42.3%** | 19.1 → **44.3%** | 54.8 → **25.1 pp** |

**Result: the hero tune alone halves the strong-play spread and produces the first three-at-parity pack.** Radiant/Onyx/Sapphire land PASS-or-FLAG at every rollout rung and are at parity among themselves (pack-internal 55.9 / 47.3 / 46.7); Sapphire is fixed **without any of its §8 deck changes** (hero flip knobs only: 19.1 → 44.3, uniform ~+25 against every opponent, the farm cells gone). Verdant is the sole FAIL and is **not converged** — still rising with pilot strength (62.8 → 65.7 → 70.3), so read 67.4 as a floor. First panel where heuristic and all rollout rungs agree on the top faction. Full mechanism analysis, prediction scorecard, and next-round queue: `balance-diagnosis.md` **§13f**.

**Hygiene:** mirror FP heuristic +1.6 pp, rollouts +0.7/+2.3/+1.0 — PASS everywhere. Decided **100.0%** on every pilot — PASS (the §13a cost floor keeps the §12c loop class dead at scale). Worst heuristic cell Onyx→Verdant 28.4% — FLAG (just outside 30/70); worst pooled rollout cell Radiant→Verdant 26.3%.

---

## 10. Verification run — 2026-07-03 (hero-tune2, first FOCUS run)

**Method.** First **FOCUS=Verdant** panel (only Verdant-involving pairings; per-pairing sizes unchanged, GPP_MATRIX=1000; ~40% of a full panel's compute for 100% of its information — the six non-Verdant pairings are byte-identical replays of §9, proven in §13g) on **CURRENT-plus-hero-tune2** (sha256 `75947cc9a0d1a7d7`). First self-certified run: pool path + sha embedded in header/JSON, matching the pre-registration — verification was a read.

| Pilot | V games | Verdant | O / R / S vs Verdant |
|---|---|---|---|
| `random` | 3,000 | **66.3%** (§9: 66.3 — identical) | 13.3 / 65.4 / 22.5 |
| `heuristic` | 3,000 | 63.5% (§9: 65.0) | 30.5 / 34.7 / 44.3 |
| `rollout` r4 | 900 | 58.9% | — |
| `rollout` r8 | 600 | 63.0% | — |
| `rollout` r12 | 360 | 66.1% | — |
| **pooled r8+r12** | 960 | **64.2%** [61.1–67.1] (§9: 67.4) | 45.3 / 30.3 / 31.9 |

**Reconstructed full marginals** (frozen §9 pack-internal cells + fresh vs-V cells; sum 200.0): **Verdant 64.2 / Radiant 47.4 / Onyx 46.7 / Sapphire 41.8 — spread 22.4 pp** (§9: 25.1). §13g prediction confirmed (V dead in band; only the Onyx bound grazed, inside reconstruction noise). All 12 hero-window checks PASS at the fixed W1 — the hero axis is spent; remaining work is the Verdant deck/loop (see `balance-diagnosis.md` §13h). Decided 100% everywhere; mirror FP −0.1 to −2.5 pp — PASS.

---

## 11. Verification run — 2026-07-03 (Reserve tap rules package, full panel)

**Method.** Full panel at §13d sizes on **CURRENT-plus-ht2b2-payload** (`34cf3a286ea726f6`) with the **§13m rules package ON** (`RESERVE_TAP=1`): tapping is a player choice (Rulebook 8 step 4's "may" — rules-accuracy fix) and strains the tapper (1 direct damage; 1-HP characters can't tap — the designer's rule replacing the §13l cap proposal). Self-certified header; flags-off byte-identity to the pre-change engine proven at build time.

| Pilot | Games | Radiant | Verdant | Onyx | Sapphire | Parity spread |
|---|---|---|---|---|---|---|
| `random` | 30,000 | 78.8% | 60.3% | 35.5% | 25.4% | 53.4 pp |
| `heuristic` | 30,000 | 53.4% | 61.7% | 27.7% | 57.2% | 33.9 pp |
| `rollout` r4 | 3,000 | 54.8% | 52.8% | 48.0% | 44.4% | **10.3 pp** |
| `rollout` r8 | 2,000 | 47.0% | 57.3% | 51.2% | 44.5% | 12.8 pp |
| `rollout` r12 | 1,200 | 47.5% | 57.2% | 51.9% | 43.3% | 13.9 pp |
| **pooled r8+r12** (§13l →) | n=960/faction | 47.4 → **47.2%** | 63.3 → **57.3%** | 46.4 → **51.5%** | 42.9 → **44.1%** | 20.4 → **13.2 pp** |

**Result: the largest single improvement on record.** Spread 13.2 pp at strong play (program history: 54.8 → … → 20.4 → 13.2); rollout-low posts the first three-PASS rung; Onyx—Verdant and Sapphire—Verdant are now even cells; Verdant's remaining altitude is a single matchup (beats Radiant 68.7). The tap-income collapse hit the pre-registered hard signature exactly (res@t10 7.2–8.4 → 5.1–5.6). Heuristic layer diverges under the new rule (v1 tap policy) — rollouts are the verdict layer. Full analysis: `balance-diagnosis.md` §13n. Decided 100% on every pilot.

---

## 12. Verification run — 2026-07-03 (12-card Resource Deck probe, full panel)

**Method.** Full panel at §13d sizes on `34cf3a286ea726f6` under the ADOPTED §13m ruleset + `RESOURCE_DECK=12` (§13o probe: Resource Deck 15 → 12, truncated post-shuffle; caps permanent income at 12 and opens the transform gate ~3 turns earlier).

| Pilot | Games | Radiant | Verdant | Onyx | Sapphire | Parity spread |
|---|---|---|---|---|---|---|
| `random` | 30,000 | 77.4% | 61.3% | 38.8% | 22.4% | 55.0 pp |
| `heuristic` | 30,000 | 54.0% | 63.9% | 32.3% | 49.8% | 31.6 pp |
| `rollout` r4 | 3,000 | 49.7% | 49.3% | 50.6% | 50.4% | **1.2 pp — first ALL-PASS rung** |
| `rollout` r8 | 2,000 | 42.3% | 52.8% | 53.0% | 51.8% | 10.7 pp |
| `rollout` r12 | 1,200 | 44.4% | 52.5% | 48.9% | 54.2% | 9.7 pp |
| **pooled r8+r12** (§11 →) | n=960/faction | 47.2 → **43.1%** | 57.3 → **52.7%** | 51.5 → **51.5%** | 44.1 → **52.7%** | 13.2 → **9.6 pp** |

**Result: first sub-10 spread — inside the §3 starter-deck acceptance band.** Five of six pooled cells sit in 46–55; the game's entire residual imbalance is **Radiant v Verdant 34.1/65.9**. Verdant now loses to Onyx and Sapphire; earlier transforms fixed Sapphire's flip-dependence (44.1 → 52.7). Watch: mirror first-player edge rose to +5 at r4/r8 (FAIL vs ≤+3) — probe before final RD12 adoption. Decided 100% everywhere. Full analysis: `balance-diagnosis.md` §13p.

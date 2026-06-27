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

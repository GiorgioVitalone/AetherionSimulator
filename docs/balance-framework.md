# Aetherion Balance Framework

The constitution for how Aetherion's balance is measured, changed, and defended.
`docs/balance-diagnosis.md` is the historical lab notebook (how we got here);
`docs/balance-targets.md` is the target spec + verification-run log; THIS document
is the operating procedure going forward. On any conflict about a number:
`packages/engine/sim-data/balance-targets.json` wins (it is what the tooling reads).

## 1. The ruleset

The game rules are versioned and locked. A "ruleset" is the set of engine
`GameConfig` rule flags that define standard play, distinct from measurement
harness settings (alternating first player, tiebreak termination, turn cap,
seeds), which are not rules.

- **ruleset v1 — LOCKED 2026-07-11** (`packages/engine/sim-data/ruleset-v1.json`,
  ratified by ledger run `2026-07-11_verify_34cf3a28_ruleset-v1-ratification-v2`,
  all 12 grade rows PASS: pooled spread 6.3, worst cell 62/38, mirror FP +0.5,
  decided 100%, ladder converged). Nine rules: the §13m Reserve tap package
  (`reserveTapChoice`, `reserveTapStrain`), `armFirstInstanceOnly`,
  `terminationMode: resource_deck_empty_transform`, `costFloor`,
  `exileDiscardForEnergy`, `resourceDeckSize: 12`,
  `firstPlayerCompensation: 'card'` (second player draws +1 — a real ~+5–6.6pp
  first-player edge at strong play, present at RD15 too, neutralized to +0.5),
  and `apnapAnyOrderFix` (APNAP event-emission order for symmetric effects —
  the §13q seat-asymmetry fidelity fix). Evidence chain: §13q in the lab
  notebook. `tests/sim/ruleset-v1-lock.test.ts` (4/4) pins the manifest, a
  fixed-seed gameplay runHash, and the flags-off legacy replay hash.
- The measurement standard alternates BOTH first player and seats
  (`seatAlternation` — harness config, not a rule): panels are neutral on both
  axes by construction.
- Engine defaults stay OFF for every rule flag: standard play = engine +
  ruleset manifest; a bare engine is legacy/replay mode. Flipping engine
  defaults would silently rewrite every historical replay and test.

### Amendment procedure

A locked rule reopens ONLY on:
1. **Rules-fidelity defect** — the engine contradicts the printed Rulebook; or
2. **Ratification-grade evidence** — a full panel at ≥ ratification sizes on the
   then-current pool showing a target FAIL at the verdict layer, PLUS a
   same-seed A/B with the suspect rule toggled proving causality with CI
   separation, PLUS a finding that no card-level fix reaches the target.

Amendments produce `ruleset-v2.json` and new pinned tests; v1 is never mutated.
Threshold changes in `balance-targets.json` require a cited full-panel ledger
run id in the commit message (enforced socially; the drift test enforces
doc/JSON agreement).

## 2. Targets (and why these numbers)

Canonical: `packages/engine/sim-data/balance-targets.json` → `thresholds`.
Mirror (human-readable): `docs/balance-targets.md` §2, drift-tested by
`tests/sim/balance-targets-doc.test.ts`.

| Metric | Healthy | FLAG | FAIL | Benchmark rationale |
|---|---|---|---|---|
| Faction win% (round-robin) | 47–53 | <45 / >55 | <43 / >57 | Hearthstone/vS viable-class band; HS devs treat sustained >55–57 as intervention territory |
| Parity spread (max−min) | ≤6pp | >6 | >10 | Closed 4-faction field pins the mean at 50; spread IS the imbalance |
| Worst matchup cell | within 65/35 | dev >20 | dev >30 | HS real matchup extremes run ~70/30; 65/35 leaves margin |
| Mirror first-player edge | ≤+3pp | >3 | >5 | 17Lands anchor +2.7pp; our compensated read +2.08 |
| Decided games | ≥85% | <85 | <70 | Stall-class regression guard |

## 3. The measurement instrument

- **Runner**: `sim-runner.mjs` (`runSim(config)`, deterministic, `runHash`
  identity; `sim-parallel.mjs` workers are byte-identical to serial).
- **Panel**: `balance-verify.mjs` — pilots of increasing strength: random
  (floor), heuristic (diagnostic), rollout r4 (dose-response rung), rollout r8 +
  r12 (**the verdict layer**). Grades PASS/FLAG/FAIL from the targets JSON.
- **Verdict layer** (decided §13q Step 0): **pooled rollout r8+r12**. The
  heuristic is demoted to a diagnostic floor with a documented mechanism (it
  finds a degenerate Verdant hold-and-win line and misplays Onyx's transform
  timing); r4 sits below the skill knee. Convergence rule (disjunctive, as
  implemented in balance-lock.mjs): each faction's r8→r12 drift must be ≤3pp
  OR its rung CIs must overlap — a small drift is convergent on its own, and
  overlapping CIs mean a larger drift is within sampling noise. If a faction
  fails both, escalate to r16; if still unconverged, the read is
  measurement-limited and NO balance verdict may be issued from it.
- **Sample-size floor**: no cell graded under 100 games; verdict-layer marginals
  want ≥2,000 pooled games (CI ≈ ±2pp). Mirror-FP probes: ≥4,000 mirror games
  (CI ≈ ±1.5pp) via `balance-fp-probe.mjs`.

## 4. Running it (the pipeline)

Everything goes through the CLI and is ledgered — no ad-hoc output files.

```bash
pnpm balance verify --preset <smoke|ablation|verdict|full> --label <name> \
    [--rd 12] [--pool <path>] [--env RULE_OFF=<flag>] [--env COMP=card]
pnpm balance focus  --faction <F> ...     # FOCUS runs (card changes)
pnpm balance card   <pool.json> --faction <F> [--quick]   # the card gate
pnpm balance audit / hero-audit / pools / ledger
```

- **Ledger**: `balance-runs/ledger.jsonl` (tracked) — every run's id, git rev,
  pool sha, resolved ruleset, env knobs, per-pilot headline + runHash. Full JSON
  in `balance-runs/runs/<id>.json` (gitignored; reproducible from the ledger
  line). Naming: `YYYY-MM-DD_<kind>_<poolSha8>_<label>`.
- **Presets** live in the targets JSON; `--env` overrides come last.
- **CI smoke** (planned `tests/sim/balance-smoke.test.ts`): fixed-seed runHash
  pin + loose envelope in `pnpm test`; the full panel stays manual/nightly.
- Shared-machine etiquette: long chains run `nice -n 19` with bounded WORKERS
  (see `balance-runs/*-chain.sh`).

## 5. The card gate (how new cards ship without breaking balance)

Every new or changed card pool passes `pnpm balance card <pool> --faction <F>`
(`balance-card-gate.mjs`). Exit codes: 0 graded PASS · 2 static FAIL · 3 sim
FAIL · 10 advisory (`--quick` — never a PASS).

- **Stage A — static pricer** (seconds): pool diff vs the ledger's latest
  baseline → changed/added cards priced by the first-principles power formula
  (`docs/balance-valuation.md`; `balance-data.mjs` budget model). Hard stop
  ONLY for statically-provable pathologies: a detected loop, a hero budget-band
  violation, or an egregious budget deviation (> `staticOverBudgetHardFail`
  power points past tolerance). Ordinary beyond-tolerance deviations grade
  SIM-NEEDED — the sim is the verdict layer, and deliberate rebalances by
  definition move cards relative to budget. The pricer is never fitted to win
  rates — it is a design-intent check.
- **Stage B — simulation gate** (mandatory rollout; ~15–45 min): FOCUS panel on
  the changed faction vs the recorded baseline. Acceptance (from `cardGate` in
  the targets JSON): faction marginal CI inside [43,57] and not migrated past
  the band vs baseline; no cell (n≥100) beyond 65/35 unless the baseline's same
  cell already was and the candidate is within CI noise of it; like-for-like
  spread not worsened beyond noise; decided/mirror-FP in band. Rollout cannot
  be skipped: the pricer's PROVEN blind spot is rule×aura×token combo loops
  (§8, §11f — the Sapphire redesign priced clean and simmed 60–72%).
- **Stage C — ledger**: every gate run is recorded, PASS or FAIL.
- **Designer loop**: build the candidate pool (`balance-apply-edits.mjs` /
  `make-pools.mjs`), run the gate, read the per-rule verdicts, iterate.

Validation protocol for the gate itself: it must FAIL the historical
CURRENT→sapphire-redesign pair and PASS a byte-identical no-op (pending
compute; see §7).

## 6. Change-type decision tree

- **New/changed cards** → card gate (§5). No rule changes for card problems.
- **Suspected rule problem** → follow the amendment procedure (§1); the burden
  of proof is a full panel + causal A/B, not a hunch.
- **Faction over/under target on a full panel** → card-level remedy first
  (pricer's over/under-budget flags aligned with the deficit's matchup cells —
  the §13p "formula-aligned relief" method), verified with a FOCUS run.
- **Instrument disagreement** (pilots diverge) → measurement work, not balance
  work; nothing is adopted on a non-converged read.

## 7. Open items (as of 2026-07-12 — ruleset v1 LOCKED, audit items closed)

1. ~~Rulebook text~~ — DONE: all nine rules printed (PR #8 on AetherionDocs;
   bump the submodule pointer after merge).
2. ~~Card-gate historical validation~~ — DONE 2026-07-12 (§13s): no-op PASSes;
   the §8 Sapphire redesign is rejected outright (Sapphire 71.5% marginal vs
   a seat-clean CURRENT baseline) — the gate catches its target class.
3. ~~For-the-record batteries~~ — DONE 2026-07-12 (§13s): comp r12 confirmed
   (+2.33 PASS); all seven ablations run seat-clean; every pre-registered
   retention ground held.
4. Bot seat-correlated tie-breaks (instanceId.localeCompare — finder minor):
   neutralized in aggregate by seat alternation; clean up opportunistically.
5. Instrument upgrades (below, §7 items 5–6 of the 2026-07-10 list): actor-free
   playouts (memory), neural playout policy (quality) — unchanged, post-lock
   engineering work.

## 8. Measurement roadmap — balance vectors beyond match fairness

Two independent audits (2026-07-12, this agent + an external GPT-5.6 review of
the repo) agree: this framework fully covers MATCH FAIRNESS for the current
product stage — four fixed starter decks under strong bot play — and that is
the only claim it certifies. "The game is balanced" in the Hearthstone sense
needs more vectors as the product grows. Priority order:

1. **Pacing & completion health** (added as watch metrics, see targets §2):
   natural-kill vs turn-cap-tiebreak share, turn percentiles, turn-10 leader
   conversion, comeback rate. Rationale: "decided%" alone would pass a
   degenerate tiebreak-grinding meta. Watch-grade now; candidates for gated
   release criteria at the next ratification-class event.
2. **Policy robustness / human validity**: grade how much every faction and
   cell estimate moves across deliberately DIFFERENT competent pilots
   (aggressive / reactive / mulligan-aware), not just across rollout budgets;
   before launch, calibrate bot play against recorded human playtest decisions.
   All current evidence is bot-vs-bot — internally converged, externally
   unvalidated.
3. **Deck/archetype space** (mandatory before constructed play opens): seeded
   archetype gauntlet via deck-sampler.mjs (aggro/midrange/control/tempo/ramp
   templates), faction × archetype win rates, best-list dominance share,
   within-faction spread; per-card paired ablations (swap one card for a
   baseline, measure the marginal win effect + drawn/played rates) — the
   empirical card-power measurement the static pricer cannot provide.
4. **Experience axes** (live-game territory): draw-luck/doomed-start incidence,
   decision density, must-answer counterplay coverage, mirror health beyond
   initiative. Out of scope for the simulator today; listed so nobody mistakes
   silence for coverage.

Known scope boundary, restated: Crimson Wastes and Amethyst Expanse have no
card data — every claim in this document covers four of six factions.
5. **Instrument upgrade — actor-free playouts** (`pilot-rollout.mjs`): each
   decision currently spins ~(candidates+1)×rollouts fresh XState actors from a
   persisted snapshot (~100 per decision); measured cost ~2 GB RSS/worker from
   allocation churn. Refactor playouts to drive the pure engine reducers
   directly from a compact state snapshot (no actor machinery). Acceptance:
   byte-identical runHash on the standard panel vs the actor implementation —
   the framework's determinism contract makes this refactor fully verifiable.
   Interim mitigation shipped: per-worker V8 heap caps + WORKERS default 8.
6. **Future investigation — neural playout policy (GPU/ANE)**: replace random
   playouts with a small policy/value net (AlphaZero-style) evaluated on Apple
   Silicon GPU/Neural Engine. Not a speed play — a QUALITY play: fewer, smarter
   playouts raise the verdict layer's skill ceiling, the standing remedy if the
   rollout ladder ever stops converging (§3). Direct GPU-porting of the sim
   itself is ruled out: branch-divergent game logic gains nothing on GPU and
   would fork the engine into two implementations, breaking runHash identity.

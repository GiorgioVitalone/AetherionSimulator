# balance-lab

Historical balance-diagnosis instruments, superseded by `balance-cli.mjs` +
`balance-verify.mjs` at the engine root. Archived here so the engine root only
carries the live pipeline. They still run from this location — invoke as
`node balance-lab/<script>` from `packages/engine/` (their imports of root
modules like `sim-runner.mjs` and `deck-loader.mjs` were updated to `../`).

Each entry: what question the script answered, and the `docs/balance-diagnosis.md`
section that used it (relative to `packages/engine/`, doc at
`../../../docs/balance-diagnosis.md`).

- `balance-diagnose.mjs` — causal decomposition of the parity spread via ablation, heuristic pilot. §0 intro / §8 root-cause discussion.
- `balance-diagnose2.mjs` — round 2 ablation: past levers + realistic combined stacks, same heuristic harness as `balance-diagnose.mjs`. §0 intro.
- `balance-diagnose-fair.mjs` — causal decomposition of the spread under the trustworthy (fair rollout) pilot. §8 Root cause — it is a PACING issue.
- `balance-diagnose-rollout.mjs` — validity cross-check: does the focused Radiant nerf close the real gap or only the heuristic pilot's? §0 intro.
- `balance-diagnose-static.mjs` — static structural profile of the 4 starter decks (no sim). §1 The decks at a glance (static profile).
- `balance-discard-probe.mjs` — measures whether discard-for-energy is a productive ramp or a reflexive dead pitch for the bot. §11c Three pilot upgrades, and the standard we adopted.
- `balance-faction-index.mjs` — cheap no-sim invariant: per-faction aggregate card power + starter deck value. Exploratory, unreferenced.
- `balance-fair-ab.mjs` — A/B the opt-in fairPilot mode (Step 0 validation) for heuristic vs rollout pilots. §7 Step 0 executed — the fairPilot measurement fix + A/B.
- `balance-gauntlet.mjs` — runs one test deck against a fixed field of official starters instead of the expensive all-pairs sweep. Exploratory, unreferenced.
- `balance-matrix.mjs` — screens the user's 13 balance levers against the win-rate spread, solo and in stacks. §10c Lever matrix — which of the 13 past levers actually move the spread.
- `balance-matrix2.mjs` — stacks 7 rules levers on top of the card rebalance + LP30 patch. §10d Stacking rules levers on top of the patch — none of the 7 help.
- `balance-pacing-test.mjs` — adjudicates "rules/design vs card" as the cause of the spread. §8 Root cause — it is a PACING (rules/design) issue.
- `balance-probe-denergy.mjs` — measures the discard_for_energy rule's contribution to faction balance. §12 Bucket B (rules-design causes) / §13o denergy probe discussion.
- `balance-rebalance.mjs` — constrained, function-preserving rebalance of out-of-window starter cards; compares rebalance "balance vectors". Exploratory, unreferenced.
- `balance-refit.mjs` — iterates the budget-fit (suggest → apply) on the starter pool until the in-window count stabilizes. §11f Fitting the narrowed budget window is a diagnostic, not a mandate.
- `balance-resim.mjs` — runs the 4 starter decks all-pairs under the trustworthy fairPilot, reports faction win% and the top/floor gap. §10 Closing the loop — re-simulating with the valuation-derived changes.
- `balance-standard-sim.mjs` — the canonical CLI wrapper for a trustworthy standard-pilot measurement against the real starter decks (fixed the missing-flag mistakes made three times by hand). §13a Loop guards + the frozen baseline + the re-derived candidate.
- `balance-trace.mjs` — per-turn game-dynamics telemetry for a handful of games via the gated `__trace` hook. §11c Three pilot upgrades, and the standard we adopted.
- `balance-transform-test.mjs` — tests two workshopped pacing changes (empty-deck transform, 10-card Resource Deck) against the §8 pacing diagnosis. §9 Workshopped pacing changes tested.
- `make-sapphire-redesign.mjs` — encodes `docs/sapphire-redesign-proposal.md`'s 9 redesigns + 2 light tweaks into testable card JSON. Exploratory, unreferenced.

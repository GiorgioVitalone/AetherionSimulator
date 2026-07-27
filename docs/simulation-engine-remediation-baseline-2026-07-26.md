# Simulation Engine Remediation Baseline

- Capture date: 2026-07-26
- Base commit: `524d648443e2cee7bf2e90a5b63d1feac27de184`
- Initial tracked dirty-patch SHA-256:
  `8272c1bd5bfe83aee1b91876ba89a3527d2eedb5ab6888b67a1f96a9b03e1dfa`
- Review: `docs/simulation-engine-deep-review-2026-07-26.md`
- Plan: `docs/simulation-engine-remediation-plan-2026-07-26.md`
- Artifact classification: **diagnostic**

The patch hash covers tracked changes present when remediation execution began.
Untracked files are inventoried by the contemporaneous `git status --short` and
are intentionally not represented by that Git patch digest.

## Authoritative input hashes

| Input | SHA-256 | Status |
|---|---|---|
| `Documentation/game/Rulebook.md` | `42f52afe6dad19f447355fe805233ac3206471d6848aa05b76d1dcbd17730f7c` | current authority |
| `packages/engine/sim-data/ruleset-v1.json` | `fffa2d5840413cd284ec3164300070258f23398245859e927088b167e3cd71a0` | legacy |
| `packages/engine/sim-data/ruleset-v2.json` | `f2000be5882e433d7a6be67be7ebc5baeb71d2e4a1d5a2883e302532f344c279` | legacy |
| `packages/engine/sim-data/ruleset-v3.json` | `9bd3aafab8c87fe999f508be9f5d11b9ae3a52922a0d57e38eab7f1893eba324` | legacy / diagnostic |
| `packages/engine/sim-data/aetherion-cards.json` | `7eae99343bb15eaf2587192a994485ba1e332c2199f753af19da0332c04b5695` | diagnostic dirty-tree pool |

## Baseline verification

| Check | Result | Interpretation |
|---|---|---|
| Engine test suite | 142 files, 1,232 tests passed | Existing regression baseline only; does not satisfy remediation gates |
| Engine build through `pnpm` | Failed before build: package-manager fetch failure | Infrastructure failure; direct local compiler check required |
| Engine lint through `pnpm` | Failed before lint: package-manager fetch failure | Infrastructure failure; direct local linter check required |
| Existing rules profile | Most tools default to v1; some probes default to v3 | Fails universal-current-profile requirement |
| Existing balance artifacts | v1 pins and “balanced” reports present | Legacy; must not certify current semantics |

## Frozen focused probe evidence

These outputs are copied from the deep review and retained as the red baseline.

```text
illegal_deploy S upkeep
choose_one_reentry choose_one 0
counters_after_pass {
  spellsCast: 3,
  equipmentPlayed: 2,
  charactersDeployed: 4,
  abilitiesActivated: 0
}
aoe_hexproof_hp [3, 2]
destroyed_filter_missing_card [mana1]
two_deaths_trigger_gain [mana1]
recursive_last_breath_gain [] [DAMAGE_DEALT, CARD_DESTROYED]
negative_hp_survives -1 [STAT_MODIFIED]
```

The review also establishes three harness/statistical probes without a single
compact output line: default hand-size interaction stall (C-05), materially
different v1/v2/v3 behavior (C-10), and the invalid four-rate bootstrap/headline
spread diagnostic (C-09). Their full evidence and reproduction descriptions are
retained in the review.

## Stale or non-certifying artifacts

- v1 ratification hashes and all balance reports derived from them;
- v2/v3 outputs without a current-manifest content hash;
- `balance-compare.html`, balance ledgers, frozen “BALANCED” pools, and diagnosis
  documents in the dirty tree;
- run hashes that do not identify a full replay trace;
- any result that folds engine failure, unresolved interaction, guard exhaustion,
  or harness step-cap exhaustion into an ordinary timeout.

No item above may be relabeled ratified merely because its historical pin still
passes.

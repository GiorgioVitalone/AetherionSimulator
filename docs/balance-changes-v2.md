# Starter-deck rebalance (skill-aware method) — findings

Result of the skill-aware balancing toolkit (see `packages/engine/` — decision logging,
skill ladder, pilotability scorecard, paired comparison; and `neural/` — value net). Recorded
as a **finding**, not yet applied to the tracked card fixture (`sim-data/aetherion-cards.json`)
— that fixture's baseline stats differ from the generated sim pool these deltas were measured
against, so applying them needs a re-measure against the fixture baseline first (see Caveat).

## The diagnosis (two independent methods agree)

The earlier one-ply / value-leaf bots gave **untrustworthy, even inverted** win rates. Two
independent instruments on the baseline pool converged on the real picture:

- **Skill-response curves** (win% per pilot rung, `skill-ladder.mjs`): Onyx rises to ~64% and
  Radiant falls to ~30% at the skilled (rollout) rungs — genuine power imbalance. Sapphire is
  V-shaped (fine → tanks under valueGreedy → fine again) — a piloting artifact, not weakness.
- **Pilotability scorecard** (`pilotability-scorecard.mjs`, 73k decisions): Sapphire has ~2×
  the heuristic value-loss and picks a rollout-unlisted move 23% of the time (vs ~5.5%) — it is
  hard to pilot, not weak. Radiant has the *lowest* value-loss — piloted fine, genuinely weak.

**Verdict:** nerf Onyx, buff Radiant, leave Verdant and Sapphire alone.

## The edits (measured at the validated `r8d3` rung via paired comparison)

Applied to the generated sim pool; each deck's effect is a paired Δ (shared seeds, gpp 150).

| Card | Faction | Change |
|---|---|---|
| Shieldbearer Paladin | Radiant | ATK 1 → 2 |
| Protector of Faith | Radiant | ATK 1 → 2 |
| Radiant Angel | Radiant | ATK 3 → 4 |
| Zombie Horde | Onyx | HP 5 → 4 |
| Skeletal Guardian | Onyx | HP 4 → 3 |
| Ghoul Marshal | Onyx | HP 3 → 2 |
| Morgath, the Undying | Onyx | ATK 4 → 3, HP 4 → 3 |

## Measured effect (r8d3, paired, gpp 150 — the trustworthy rung)

| Deck | Baseline | After | Δ(paired) |
|---|---|---|---|
| Onyx | 66.4% | 53.6% | −12.9 |
| Sapphire | 54.9% | 51.6% | −3.3 |
| Verdant | 48.9% | 48.4% | −0.4 |
| Radiant | 29.8% | 46.4% | +16.7 |

**Win-rate spread: 36.6 → 7.2 points.** All four decks land at 46–54%. Verdant/Sapphire barely
moved (edits well-targeted). Residual: Onyx mildly top (53.6), Radiant mildly bottom (46.4) —
near diminishing returns at ±3.5% CIs; one more small paired-measured nudge could tighten it.

## Method note — why this supersedes the earlier attempt

An earlier same-day rebalance, steered by the 2-ply value-leaf bot ("Stage E"), *looked*
balanced but was **illusory** — Stage E disagrees with full-rollout ground truth on the fine
ordering. These edits were instead derived at `r8d3` (validated against deeper rollout to give
the same ordering) and measured with paired comparisons (common random numbers) that cancel
sampling noise. Composed edits were measured as a *combination*, not summed from isolated
deltas (they interact — the combined Onyx nerf ran −12.9 vs a ~−6 additive prediction).

## Caveat before applying to `sim-data/aetherion-cards.json`

The deltas above were measured on `generated-pools/aetherion-CURRENT.json` (gitignored), whose
baseline stats differ from the committed fixture on some cards (e.g. Shieldbearer Paladin is
2/3 in the fixture vs 1/2 in the pool). Re-measure the edit set against the fixture baseline
(or regenerate the pool from the current DB) before writing these stat changes into the tracked
card source.

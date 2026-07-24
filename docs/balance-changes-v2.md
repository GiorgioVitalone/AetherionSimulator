# Starter-deck rebalance (skill-aware method) — findings

**Final result (ruleset-v2, paired r8d3 gpp150): win-rate spread 36 → 2.0.** All four starter decks
land at **49.1–51.1%** (Onyx 50.4, Sapphire 51.1, Verdant 49.3, Radiant 49.1). This supersedes the
earlier measurement, which was made under a reduced ruleset (the session harness had silently dropped
3 of the 9 locked rules); the edit set was re-derived and confirmed under the full, correct ruleset-v2.

Result of the skill-aware balancing toolkit (see `packages/engine/` — decision logging,
skill ladder, pilotability scorecard, paired comparison; and `neural/` — value net). The edits are
recorded as **SQL + fixture patches** in `docs/patches/` (produced, not applied).

## The diagnosis (two independent methods agree)

Cheap one-ply / value-leaf bots gave **untrustworthy, even inverted** win rates. Two independent
instruments on the shipped pool (`aetherion-CURRENT` = raw + 28 prior derivation edits) converged:

- **Skill-response curves** (`skill-ladder.mjs`): Onyx rises to ~65% and Radiant falls to ~29% at the
  skilled (rollout) rungs — genuine power imbalance. Sapphire is V-shaped — a piloting artifact, not
  weakness.
- **Pilotability scorecard** (`pilotability-scorecard.mjs`, 73k decisions): Sapphire has ~2× the
  heuristic value-loss (hard to pilot, not weak). Radiant has the *lowest* value-loss (piloted fine,
  genuinely weak).

**Verdict:** nerf Onyx, buff Radiant, leave Verdant and Sapphire alone.

## The final edit set (v2-derived, 7 cards — measured per-lever under ruleset-v2)

| Card | Faction | Change | Lever strength (paired Δ, v2) |
|---|---|---|---|
| Zombie Horde (11) | Onyx | HP 5 → 4 | } Onyx −10.7 (engine bodies |
| Skeletal Guardian (16) | Onyx | HP 4 → 3 | } are Onyx's real strength; |
| Ghoul Marshal (9) | Onyx | HP 3 → 2 | } boss Morgath ~0, dropped) |
| Shieldbearer Paladin (48) | Radiant | ATK 1 → 2, HP 2 → 3 | } Radiant +21.1 (the walls |
| Protector of Faith (47) | Radiant | ATK 1 → 2, HP 3 → 4 | } needed ATK to close + |
| Radiant Angel (51) | Radiant | ATK 3 → 4 | } HP to survive — the +HP |
| Faithkeeper of Dawn (49) | Radiant | ATK 2 → 3 | } is what closed 42 → 49) |

These 7 sit on top of the 28 prior derivation edits already in `aetherion-CURRENT`, so the full
patch reproduces raw → `CURRENT` + this set (~30 cards).

## Measured effect (ruleset-v2, paired, gpp 150)

| Deck | Baseline | After | Δ(paired) |
|---|---|---|---|
| Onyx | 64.0% | 50.4% | −13.56 |
| Sapphire | 56.7% | 51.1% | −5.56 |
| Verdant | 51.3% | 49.3% | −2.00 |
| Radiant | 28.0% | 49.1% | +21.11 |

**Win-rate spread: 36 → 2.0** (target was < 6). Verdant/Sapphire land near 50 (well-targeted edits).

## Method note — why this supersedes the earlier attempts

An earlier same-session rebalance looked balanced (spread ~7) but was measured under a **reduced
ruleset** — the harness omitted `resourceDeckSize:12`, `firstPlayerCompensation`, and
`apnapAnyOrderFix`. Once the gates were fixed to load all 9 locked rules, the edit set was
**re-derived from scratch under ruleset-v2** (per-lever paired measurements), which is what produced
the final spread of 2.0. The 12-card resource deck legality was also fixed (starters shipped 15,
now 12 — see the deck-trim in `cards-balance-v2.sql`).

## Caveat before applying to the live DB

The patch (`cards-balance-v2.sql`) targets the **raw** `"Cards"` table with **absolute** stat/cost
values (safe against the raw baseline, idempotent). The fixture patch
(`aetherion-cards.fixture.patch`) applies the same changes to the committed test fixture. Both were
cross-checked: patched fixture == the confirmed balanced pool, 0 mismatches. Apply deliberately;
re-measure after applying to confirm the DB now matches the validated pool.

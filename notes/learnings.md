# Learnings

Verified rules discovered while working on this repo. Consult before starting work.

## The rollout pilot cannot see the board (2026-07-26)

**Rule:** the rollout pilot's leaf evaluation reads **hero life points and nothing else**, so it
cannot distinguish actions that do not change hero LP inside the search horizon. Around **70-75% of
all its decisions are exact top-value ties**, resolved by candidate sort order rather than by
evaluation.

**Verified by:** `tie-audit.mjs Onyx Sapphire 6 8 3 12345` (and a 10x-budget repeat at r32 d8).

| | Onyx r8d3 | Sapphire r8d3 | Onyx r32d8 | Sapphire r32d8 |
|---|---|---|---|---|
| top value is a tie | 75.1% | 69.7% | 72.1% | 65.8% |
| every candidate equal | 38.2% | 16.8% | 38.1% | 14.3% |
| spell chosen over available deploy | 14.5% | 49.0% | 15.8% | 30.6% |

**Mechanism** (three lines, all in `pilot-rollout.mjs`):
- `:274` — a truncated leaf scores `0.5 * ((1 - oppLp/oppMax) - (1 - meLp/meMax))`. No board, hand,
  resource or tempo term.
- `:473` — argmax uses strict `>` with a 1e-12 epsilon, so a tie keeps the **first** candidate.
- `:648` — `KIND_ORDER` sorts `cast_spell: 1` before `deploy: 2`. Every tie between them therefore
  goes to the spell, by table position.

**Consequences:**
- Raising the search budget does **not** fix it — 4x playouts and depth 8 left the tie rate roughly
  unchanged, at ~10x the cost (4m39s for 4 games). The defect is in the leaf evaluation, not the
  search budget.
- Spell-heavy factions (Sapphire) are the most exposed: more of their decisions contain a spell
  candidate for the ordering bias to act on. Their apparent weakness is partly a sorting artifact.
- Round-robin win rates are zero-sum, so this contaminates **every** faction's number, not just the
  spell-heavy ones.

**How to apply:** do not treat rollout-pilot win rates as a card-balance signal until the leaf
evaluation carries a board/tempo term. Re-check with `tie-audit.mjs` after any change to
`outcomeScore`, `KIND_ORDER`, or the search depth.

Related: the memory note `observe-dont-infer` — this was found from decision-log data, not by
reading the code; code reading only explained it afterwards.

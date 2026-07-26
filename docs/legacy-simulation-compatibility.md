# Legacy Simulation Compatibility

Historical simulation behavior is isolated for replay and regression research.
It is never the authority for current correctness.

## Profiles

`legacy-v1`, `legacy-v2`, and `legacy-v3` load frozen manifests through the
simulator adapter. Their archived tests live under
`packages/engine/tests/legacy` and carry an explicit “never evidence for current
correctness” classification.

Legacy-only mutable diagnostics, historical policy defaults, and adapter
bridges remain available solely to reconstruct named artifacts. New gameplay
code must not consult them to decide what is legal.

## Migration rules

- New callers select `rulesProfile: "current"` and submit commands through
  `transition`.
- Old runner flags must not be copied into a current artifact. The current
  manifest owns all correctness settings.
- Historical pins remain unchanged unless the replay/provenance envelope itself
  evolves; any such re-anchor must stay in the legacy suite.
- A historical balance conclusion cannot be relabeled current. It must be
  regenerated from the current rules, card, engine, deck, policy, and seed
  bindings.
- Compatibility comments belong in this note or in the narrow legacy adapter.
  Current-path comments should cite an invariant, rules decision, or semantic
  boundary.

## Identity

Replay identity is content-based. A legacy artifact records its profile and
manifest hash. Current artifacts record the canonical current manifest hash and
cannot silently fall back to a legacy profile.

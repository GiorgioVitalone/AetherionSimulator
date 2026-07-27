# ADR-006: Current and legacy manifest policy

Status: accepted for the diagnostic current profile.

Context: additive flags and scripts selecting different historical manifests
made “default rules” ambiguous.

Decision: `ruleset-current.json` is the sole correctness profile and exports an
immutable `CURRENT_GAME_CONFIG`. Historical manifests are explicitly named
legacy profiles, replay-only, and tested separately.

Consequences: current setup fails closed on conflicting overrides. Historical
pins cannot support current claims. Ratification changes manifest status and
hash rather than mutating an old profile in place.

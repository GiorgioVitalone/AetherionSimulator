# ADR-001: Authoritative validation

Status: accepted for the diagnostic current profile.

Context: action enumeration, UI checks, and bot candidates can be stale or
incomplete. Treating them as authorization allowed illegal direct execution.

Decision: every player operation enters `transition` as an `EngineCommand`.
Validation covers timing, priority, controller, source, costs, readiness,
targets, limits, and interaction identity. Rejection returns the original state
with typed violations.

Consequences: projections may remain optimized and fallible without weakening
rules enforcement. Trusted effect helpers are not public authorization paths.

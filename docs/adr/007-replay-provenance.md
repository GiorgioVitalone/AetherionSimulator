# ADR-007: Replay and provenance identity

Status: accepted for the diagnostic current profile.

Context: seeds and summary hashes alone could not reconstruct a run or detect a
stale engine, card pool, deck, or policy.

Decision: replay records contain the initial state, canonical commands, typed
terminal reason, event/final-state/trace hashes, and content-addressed
provenance. Study artifacts additionally bind rules, study manifest, card pool,
compiled engine build, executable harness build, bot implementation, decks,
complete policy configuration, and seed schedule. The harness and bot hashes
cover the `.mjs` rollout/runtime code that is intentionally outside `dist`.

Consequences: stale bindings fail closed. Declarative observation is detached
and hash-exempt because it cannot alter behavior.

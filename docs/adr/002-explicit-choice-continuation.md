# ADR-002: Explicit choice continuation

Status: accepted for the diagnostic current profile.

Context: callbacks, implicit first-option selection, and duplicated pending
state made choices non-replayable and allowed stale responses.

Decision: every player decision is a serializable `PendingInteraction` with a
unique ID, legal responder, typed options, and continuation data. A response
must match the ID and responder and may resume exactly once.

Consequences: UI and bot adapters share one protocol; replays capture choices
as commands; turn-boundary and effect choices can pause safely.

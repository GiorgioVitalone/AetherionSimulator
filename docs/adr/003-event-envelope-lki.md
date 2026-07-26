# ADR-003: Event envelopes and last-known information

Status: accepted for the diagnostic current profile.

Context: trigger matching against live mutable state loses source facts when a
card moves and cannot define simultaneous ordering reliably.

Decision: events are immutable, monotonically sequenced envelopes carrying
action identity, controller, typed payload, and source/card snapshots. Trigger
matching consumes envelopes and APNAP orders ready batches.

Consequences: leave/destroy/die semantics remain observable after movement;
replay event hashes are stable; trigger guards have an explicit bound.

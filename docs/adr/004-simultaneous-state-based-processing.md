# ADR-004: Simultaneous state-based processing

Status: accepted for the diagnostic current profile.

Context: removing lethal cards one by one made results depend on array order and
let early death triggers observe a partially processed batch.

Decision: after each atomic transition, collect all state-based changes from one
snapshot, apply the batch, emit lifecycle events, then dispatch triggers.
Repeat to a fixed point under a guard.

Consequences: simultaneous deaths are order-independent and auditable. Guard
exhaustion is an engine failure rather than a draw or silent stop.

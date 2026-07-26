# ADR-005: Transactional stack declarations

Status: accepted for the diagnostic current profile.

Context: some actions spent resources or exhausted cards before all declaration
checks completed, and reactions blurred declaration with resolution.

Decision: validate the whole declaration first, then atomically commit costs,
exhaustion, targets, and declaration events into a stack transaction. Priority
responses add links; resolution is LIFO after both players pass.

Consequences: rejected actions have no partial side effects. Countered and
fizzled actions preserve declaration facts while skipping invalid resolution.

# ADR-008: Statistical estimands and clustered inference

Status: accepted for the diagnostic current profile.

Context: games sharing decks, matchups, and seed blocks are not interchangeable
independent Bernoulli observations. Post-hoc endpoints and naive intervals
overstate balance evidence.

Decision: every study declares its population, estimand, observation unit,
cluster, endpoint, practical threshold, multiplicity family, power/stopping
rule, and seat/seed schedule before observation. Current faction contrasts use
schedule blocks as clusters and schedule-preserving resampling/permutation.

Consequences: infrastructure failures are excluded and reported separately;
policy and deck populations limit claim scope; calibration must pass before
decision-grade inference.

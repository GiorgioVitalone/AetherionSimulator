# Rulebook Compliance Matrix

Use this file as the canonical QA matrix for Rulebook verification.

Status values:
- `Pass`
- `Fail`
- `Blocked`
- `Not Yet Verified`

Browser evidence below was verified on 2026-03-12 via `pnpm qa:release`, then supplemented with focused Playwright fixture, resilience, and polish checks against the rebuilt simulator.

| Area | Rulebook Topic | Engine Evidence | Browser Evidence | Manual Scenario | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Setup | Deck legality, mulligan, choose first player | `packages/engine/tests/setup`, `apps/client/src/stores/game-store.test.ts` | `apps/client/e2e/setup-flow.spec.ts` | Setup flow with both players and seeded start | Pass | `setup-flow.spec.ts` passed via `pnpm qa:release`; setup and transition into game were visually reviewed on 2026-03-12. |
| Turn Flow | Upkeep, transform, strategy, action, end | `packages/engine/tests/state-machine` | `apps/client/e2e/gameplay-regressions.spec.ts`, `apps/client/e2e/qa-fixtures.spec.ts` | Multi-turn pass with phase checks | Pass | Strategy to action to handoff verified via `pnpm qa:release`. |
| Deployment | Zone legality, X-cost handling, summon state | `packages/engine/tests/state-machine/rulebook-compliance.test.ts` | `apps/client/e2e/gameplay-regressions.spec.ts` | Deploy into frontline and reserve, verify persistence | Pass | X-cost deploy and board persistence passed via `pnpm qa:release`. |
| Movement | Same-turn restrictions, Haste, slowed, zone adjacency | `packages/engine/tests/state-machine/rulebook-compliance.test.ts` | `apps/client/e2e/gameplay-regressions.spec.ts` | Move legal and illegal units | Pass | Summoning sickness and Haste movement passed via `pnpm qa:release`. |
| Combat | Attack timing, defender, hero attacks, first-turn lock | `packages/engine/tests/combat`, `packages/engine/tests/state-machine` | `apps/client/e2e/gameplay-regressions.spec.ts` | Attack declaration and target rules | Pass | First-turn attack lock verified via `pnpm qa:release`; no illegal attack affordance surfaced. |
| Response Chain | Counter, Flash, pass priority, stack resolution | `packages/engine/tests/stack`, `packages/engine/tests/state-machine/player-response.test.ts` | `apps/client/e2e/gameplay-regressions.spec.ts`, `apps/client/e2e/qa-fixtures.spec.ts` | Open response window, pass, resolve | Pass | Response window open, pass flow, and fixture shell all passed via `pnpm qa:release`. |
| Equipment | Attach, remove, transfer, attach legality | `packages/engine/tests/state-machine/rulebook-compliance.test.ts` | `apps/client/e2e/gameplay-regressions.spec.ts` | Equip allied unit, remove equipment | Pass | Attach and remove flow passed via `pnpm qa:release`. |
| Auras | Aura persistence, aura removal, passive cleanup | `packages/engine/tests/stack/aura-resolution.test.ts` | `apps/client/e2e/qa-fixtures.spec.ts`, `apps/client/e2e/aura-zone.spec.ts` | Observe aura-bearing content near the hero panel and inspect it through hover detail | Pass | Browser QA now exposes persistent aura cards beside the hero and allows detail inspection; removal and cleanup remain engine-covered by `aura-resolution.test.ts`. |
| Hero Rules | Transform availability, transformed lockouts, ultimates | `packages/engine/tests/state-machine/rulebook-compliance.test.ts` | `apps/client/e2e/qa-fixtures.spec.ts` | Transform-ready hero state and button visibility | Pass | Transform-ready fixture passed via `pnpm qa:release`. |
| Victory | Lethal damage, deck-out, concede, game-over UI | `packages/engine/tests/combat`, `packages/engine/tests/state-machine/turn-flow.test.ts` | `apps/client/e2e/qa-fixtures.spec.ts` | Winner overlay and reset path | Pass | Game-over fixture passed via `pnpm qa:release`. |

# Release Scorecard

Release gate: zero known defects.

## Automated Gate

| Check | Command | Result | Evidence |
| --- | --- | --- | --- |
| Engine build | `pnpm --filter @aetherion-sim/engine build` | Pass | Verified via `pnpm qa:release` on 2026-03-12. |
| Engine tests | `pnpm --filter @aetherion-sim/engine test` | Pass | Verified via `pnpm qa:release` on 2026-03-12 (`34` files / `295` tests passed). |
| Client build | `pnpm --filter @aetherion-sim/client build` | Pass | Verified via `pnpm qa:release` on 2026-03-12. |
| Client tests | `pnpm --filter @aetherion-sim/client test` | Pass | Verified via `pnpm qa:release` on 2026-03-12 (`10` tests passed). |
| Client E2E | `pnpm --filter @aetherion-sim/client e2e` | Pass | Verified via `pnpm qa:release` on 2026-03-12 after stabilizing Playwright concurrency and adding aura, resilience, and polish coverage (`16/16` passed). |

## Manual Sign-off

| Track | Result | Evidence |
| --- | --- | --- |
| Rulebook compliance matrix complete | Pass | Matrix updated on 2026-03-12. All tracked areas pass, including `Auras` via `apps/client/e2e/qa-fixtures.spec.ts` and `apps/client/e2e/aura-zone.spec.ts`. |
| UX pass complete | Pass | `UX-01` through `UX-03` completed on 2026-03-12 using Playwright verification plus direct visual review. |
| UI and polish pass complete | Pass | `UI-01` through `UI-03` and `POLISH-01` through `POLISH-03` were reviewed on 2026-03-12. `apps/client/e2e/ui-polish.spec.ts` covers layout overlap, and `apps/client/e2e/qa-resilience.spec.ts` covers animation settling and recovery UI. |
| Exploratory playtest matrix complete | Not Run | No additional multi-seed exploratory matrix was executed beyond the deterministic Playwright scope performed on 2026-03-12. |
| Defect log empty at sign-off | Pass | `DEF-001` through `DEF-003` are closed. |

## Final Decision

- Release Status: `Pass`
- Sign-off Owner: `Codex`
- Date: `2026-03-12`

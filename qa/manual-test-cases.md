# Manual Test Cases

Record evidence next to each case during the QA pass.

| ID | Area | Scenario | Expected Result | Evidence |
| --- | --- | --- | --- | --- |
| UX-01 | Setup | Start a seeded game from hero selection through mulligans and first-player choice | Flow is understandable, no dead ends, no hidden-state leaks | Pass via `setup-flow.spec.ts`; visually reviewed on 2026-03-12 during `pnpm qa:release`. |
| UX-02 | Hot-seat | End a turn and hand the client to the next player | No opponent hand flash, perspective swaps cleanly, controls match active player | Pass via `gameplay-regressions.spec.ts` turn-handoff case on 2026-03-12. |
| UX-03 | Interaction | Select cards, cancel actions, reselect a different card | Highlights and action bar update correctly without stale state | Pass via Playwright interaction coverage and direct review on 2026-03-12; no stale deploy or cast affordances remained after cancel. |
| UI-01 | Readability | Inspect board, hand, hero panels, and log on desktop | Text is readable, no clipping, no overlapping controls | Pass via direct visual review plus `ui-polish.spec.ts` at 1440x1200 on 2026-03-12. |
| UI-02 | Feedback | Deploy, move, attack, cast, equip, and remove equipment | Every action produces clear visible feedback and correct board updates | Pass via `gameplay-regressions.spec.ts` during `pnpm qa:release` on 2026-03-12. |
| UI-03 | Modal layering | Trigger pending choices, target overlay, turn handoff, and game over | Overlays stack correctly and never trap the player in a broken state | Pass via `qa-fixtures.spec.ts`, `qa-resilience.spec.ts`, and full `pnpm qa:release` on 2026-03-12. |
| RULE-01 | Turn one | First player cannot attack on turn one | Attack affordance is absent and the engine rejects the action | Pass via `gameplay-regressions.spec.ts` during `pnpm qa:release` on 2026-03-12. |
| RULE-02 | Movement | Fresh non-Haste character cannot move on deploy turn | Move affordance is absent and card remains summoning sick | Pass via `gameplay-regressions.spec.ts` during `pnpm qa:release` on 2026-03-12. |
| RULE-03 | Response | Trigger a response window and pass | Response modal is clear, pass resolves cleanly, board remains consistent | Pass via `gameplay-regressions.spec.ts` and `qa-fixtures.spec.ts` on 2026-03-12. |
| RULE-04 | Equipment | Equip an allied character, then remove the equipment | Attach and removal both resolve correctly with no stale bonuses | Pass via `gameplay-regressions.spec.ts` during `pnpm qa:release` on 2026-03-12. |
| RULE-05 | Transform | Bring a hero to a transform-ready state | Transform phase is visible and the transform affordance is obvious | Pass via `qa-fixtures.spec.ts` during `pnpm qa:release` on 2026-03-12. |
| RULE-06 | Victory | Reach a win state and reset to setup | Winner overlay is correct and Play Again returns to setup | Pass via `qa-fixtures.spec.ts` during `pnpm qa:release` on 2026-03-12. |
| RULE-07 | Aura | Load an aura-bearing fixture and inspect the persistent aura near the hero | Aura remains visible in a dedicated browser surface and can be inspected without obscuring play | Pass via `qa-fixtures.spec.ts` and `aura-zone.spec.ts` on 2026-03-12. |
| POLISH-01 | Animation | Watch card deploy, move, damage, and destroy animations | Motion appears, resolves, and settles into the correct final state | Pass via `qa-resilience.spec.ts` animation-preview plus gameplay reruns on 2026-03-12. Subjective artistic smoothness was not separately headed-reviewed. |
| POLISH-02 | Log | Play several turns and inspect the game log | Log entries are readable, timely, and useful for debugging | Pass via `ui-polish.spec.ts` on 2026-03-12; the open log no longer overlaps or steals interaction from right-side hand cards at 1440x1200. |
| POLISH-03 | Error Handling | Trigger a recoverable UI error path if available | App shows a usable recovery path instead of a broken screen | Pass via `qa-resilience.spec.ts` on 2026-03-12; the QA fault path shows the recovery UI and `Return to Setup` restores the setup screen. |

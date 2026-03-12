# QA Workspace

This directory is the tracked workspace for desktop-web simulator release QA.

Use it for:
- the Rulebook compliance matrix
- the manual UX/UI/polish checklist
- the defect log
- the release scorecard

Primary release-gate command:

```bash
pnpm qa:release
```

That command runs:
- engine build
- engine tests
- client build
- client tests
- client Playwright E2E against the Dockerized simulator

Release policy:
- zero known defects at sign-off
- every Sev-1, Sev-2, and Sev-3 issue must be fixed and reverified
- every gameplay defect must cite `Documentation/game/Rulebook.md`

Tracked QA artifacts:
- [rulebook-compliance-matrix.md](./rulebook-compliance-matrix.md)
- [manual-test-cases.md](./manual-test-cases.md)
- [defect-log.md](./defect-log.md)
- [release-scorecard.md](./release-scorecard.md)

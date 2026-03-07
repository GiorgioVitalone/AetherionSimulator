# Testing Rules

## Framework
- Vitest for all packages
- Engine tests run in `node` environment — never `jsdom`
- Client tests use `jsdom` environment

## Practices
- Arrange-Act-Assert pattern
- Descriptive test names: `it('should deal 3 damage to target character')`
- One assertion per test when practical
- No test interdependencies — each test runs in isolation
- Co-locate tests next to source files or in `tests/` directory
- Test pure functions with direct input/output assertions
- Test state machines with XState's `createActor` + `snapshot`

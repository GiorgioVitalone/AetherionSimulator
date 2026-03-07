# Engine Rules

## Critical Constraint
- **Zero DOM imports** — the engine's `tsconfig.json` excludes `"DOM"` from `lib`
- If you import anything DOM-related, TypeScript will error. This is intentional.
- The engine is a pure state machine: `(state, action) => newState`

## XState Patterns
- Use XState v5 `setup()` + `createMachine()` API
- Define events as discriminated unions
- Use guards for conditional transitions
- Keep machine definitions separate from implementation logic

## State Design
- All state objects are readonly / treated as immutable
- Engine functions return new state, never mutate input
- Immer lives in the client (Zustand store), NOT in the engine

## Type Patterns
- Discriminated unions for all algebraic types (Effect, Trigger, Condition)
- Always handle exhaustively with `switch` + `never` default
- Use branded types for IDs (CardInstanceId, PlayerId) to prevent accidental mixing
- All functions should be pure or explicitly flagged as effectful

## Event System
- Game events are data — logged, replayable, serializable
- Event ordering follows the Rulebook's priority system
- Triggers evaluate against the event log, not against mutations

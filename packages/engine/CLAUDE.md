# @aetherion-sim/engine

Game simulation engine for the Aetherion TCG. Pure TypeScript, zero DOM dependencies.

## Architecture

The engine is a **pure state machine** — it takes game state + an action and produces new game state. No side effects, no DOM, no rendering.

### Module Responsibilities
| Directory | Purpose |
|-----------|---------|
| `types/` | DSL type definitions — Effect, Trigger, Condition, Duration, TargetExpr |
| `state-machine/` | XState machine definitions for game flow (phases, turns, priority) |
| `effects/` | Effect resolution — evaluate Effect DSL nodes against game state |
| `zones/` | Zone management — Reserve, Frontline, High Ground movement rules |
| `combat/` | Combat resolution — damage calculation, blocking, Defender trait |
| `events/` | Event bus — game event log, trigger evaluation, event ordering |
| `cards/` | Card instance management — runtime card state (buffs, damage, zone) |

### Key Constraints
- **Zero DOM imports** — `tsconfig.json` excludes `"DOM"` from `lib`. If you import anything from the DOM API, TypeScript will error. This is intentional.
- **Pure functions preferred** — All state transitions should be `(state, action) => newState`. Side-effectful operations must be explicitly marked.
- **Discriminated unions** — Use `type` field for all union types (Effect, Trigger, etc.). Always handle exhaustively with `switch` + `never` default.
- **Immutability** — Game state objects are treated as immutable. The client layer (Zustand + Immer) handles mutable-style updates. Engine functions return new state, never mutate input.

### Testing Patterns
- Co-locate tests next to source or in `tests/` directory
- Test pure functions with direct input/output assertions
- Test state machines with XState's `createActor` + `snapshot` pattern
- No mocking of engine internals — if you need to mock, the boundary is wrong

## Domain Glossary
| Term | Meaning |
|------|---------|
| Hero | Player's avatar card, has Life Points, 1 per deck |
| Character | Deployed unit with HP/ATK/ARM stats |
| Spell | One-shot effect, discarded after resolution |
| Equipment | Attaches to Character, grants stats/abilities |
| Mana | Magic resource (blue) |
| Energy | Tech resource (gold) |
| Flexible | Either Mana or Energy, player's choice |
| Zone | Board position: Reserve (2), Frontline (3), High Ground (2) |
| Deploy | Play a card from hand to a zone |
| Trigger | Conditional effect that fires on game events |
| Aura | Passive continuous effect while card is in play |
| Last Breath | Effect that fires when the card is destroyed |

## Effect DSL
Effects are data, not code. The `Effect` type is a discriminated union that gets interpreted by the effect resolver. This separation lets us:
1. Serialize effects (for networking, replays, save states)
2. Validate effects at card creation time
3. Display effect descriptions from data (no string parsing)

@import ../../Documentation/game/Rulebook.md

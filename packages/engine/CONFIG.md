# Sim Runner Config (`sim-runner.mjs`)

One parameterized simulation runner the dashboard calls. Exports `runSim(config)`
and a thin CLI. Reuses the engine's heuristic bot + abilities pipeline. Fully
deterministic: the same `config` + `seedBase` produce byte-identical results,
including a stable `runHash`.

```js
import { runSim } from './sim-runner.mjs';
const result = runSim({ matchups: 'all-pairs', gamesPerPairing: 60, seedBase: 12345 });
```

## Config fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `matchups` | see below | `"all-pairs"` | Which faction pairings to simulate. |
| `gamesPerPairing` | number | `60` | Games simulated per pairing. |
| `turnCap` | number | `80` | Hard turn limit; games past it are force-ended. |
| `abilitiesOn` | boolean | `true` | Hydrate card/hero abilities (incl. transform sides) onto instances. |
| `botPolicy` | `"random"` \| `"heuristic"` \| `"rollout"` | `"heuristic"` | Policy driving BOTH seats. |
| `firstPlayerCompensation` | see below | `"none"` | How the second player is compensated for going second. |
| `termination` | `"none"` \| `"tiebreak"` | `"none"` | How `turnCap`-reached games resolve. |
| `seedBase` | number | `12345` | Root seed. Every game seed = pure fn of (seedBase, pairingIndex, gameIndex). |
| `decks` | see below | _(auto)_ | EXPLICIT decks: per-faction overrides. Omit for the auto quota-builder. |
| `apnapAnyOrderFix` | boolean | `false` | RULES FIX — side:`'any'` target resolution returns `[activePlayer, nonActivePlayer]` (APNAP) instead of seat order `[0,1]`. Fixes ~5pp matchup drift from which deck sits in seat 0. |
| `firstPlayerSkipsFirstResource` | boolean | `false` | CANDIDATE VARIANT (§13r) — alternative to the locked `firstPlayerCompensation: "card"` rule. The first player draws no Resource Card on their first Upkeep only. |
| `firstPlayerDrawsNormally` | boolean | `false` | CANDIDATE VARIANT (§13r) — disables ONLY the first-player-first-turn Main Deck draw skip; the turn-1 attack restriction is unaffected. |
| `seatAlternation` | boolean | `false` | MEASUREMENT KNOB — swaps which deck sits in seat 0 on a 4-phase cycle (uncorrelated with `firstPlayer: "alternating"`'s `g%2`), so a matchup's two seat orderings both get measured within one run. `gamesPerPairing` should be a multiple of 4 for exact neutrality. Results stay deck-oriented (not seat-oriented). |

### `decks` / explicit decks

By default `runSim` auto-builds a deck per faction (the quota builder). To use
REAL decks instead, pass explicit deck **specs**. A spec is any of:

- a **DeckSelection** object `{ heroDefId, mainDeckDefIds, resourceDeckDefIds }` (optional `deckId`, `faction`),
- a **deckId** (int/string) — loaded from the DB via `deck-loader.mjs`,
- a **faction name** (`"Onyx"`) — that faction's REAL official deck (deck-loader),
- `"auto:<Faction>"` — the quota-builder auto deck (current fallback).

Two ways to supply them:

1. **Per-faction overrides** — `config.decks = { Onyx: <spec>, Sapphire: <spec> }`.
   Applies the spec to that faction across all-pairs pairings; unspecified
   factions keep auto decks.
2. **Matchup list** — `config.matchups = [{ p0Deck: <spec>, p1Deck: <spec> }, ...]`.
   Each entry is one pairing; bypasses faction-pairing entirely.

The decks used are folded into `runHash` (same config + different decks ⇒
different hash). CLI shortcut: `--realDecks` sets every faction to its real
official deck. Determinism is preserved. `deck-loader.mjs` exports
`loadDecksFromDB()` / `getDeck(idOrFaction)`; it shells out to the live Postgres
(no pg driver) and falls back to an on-disk cache then `starter-decks.json`.

### `botPolicy: "rollout"` — outcome-driven pilot (methodology-validation)

An archetype-NEUTRAL pilot with no hand-coded board score. At each active-player
decision it enumerates the legal candidate actions, forks the live actor, plays both
seats out (random or heuristic playout) to game end or a turn-depth horizon, and
picks the action with the best game OUTCOME (win-rate, LP-diff tiebreak). Used to
test whether a faction's dominance under the target-aware `heuristic` is real card
strength or a pilot artifact. Extra knobs (hashed only when `botPolicy === "rollout"`,
so heuristic/random runs stay byte-identical to the v10 baseline):

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `rollouts` | number | `1` | Playouts simulated per candidate (averaged). |
| `rolloutPlayout` | `"random"` \| `"heuristic"` | `"random"` | Default policy INSIDE a playout. `random` = no archetype prior (primary). |
| `rolloutDepth` | number | `0` | Turns to simulate forward before scoring the leaf by LP-diff. `0` = roll to game end (truest win/loss signal). |
| `maxCandidates` | number | `12` | Branching cap (candidates evaluated per decision). |

Implemented in `pilot-rollout.mjs` (engine untouched). Determinism preserved: rollout
seeds derive purely from `(seed, decisionIndex, candidateIndex, rolloutIndex)`.

### `matchups`

- `"all-pairs"` — every unordered faction pair **including** mirrors.
- `"all-pairs-no-mirror"` — every unordered pair **excluding** mirrors.
- `string[]` (faction names, e.g. `["Onyx","Radiant"]`) — all-pairs over that subset (incl. mirrors).
- `{ factions?: string[], includeMirrors?: boolean }` — explicit subset + mirror toggle.

Factions: `Onyx`, `Radiant`, `Sapphire`, `Verdant`.

### `firstPlayerCompensation`

Applied at game start to the **second** player (not active on turn 1):

- `"none"` — engine default, no compensation.
- `"card"` — second player draws +1 card.
- `"resource"` — second player starts with +1 ready resource in the bank.
- `"both"` — card + resource.
- `"play_or_draw"` — second player chooses to draw (modeled as `"card"`).
- `"reserveT1"` — label-only variant; behaves as engine default (`firstPlayerFirstTurn`
  edge kept) so the dashboard can distinguish this scenario without altering rules.

### `termination`

- `"none"` — a `turnCap`-reached game with no engine winner is a **timeout** (counted, undecided).
- `"tiebreak"` — `turnCap`-reached games are decided by higher hero LP (draw if equal).

## Return shape

```ts
{
  factionWinPct: { [faction]: number },   // non-mirror decided games only
  paritySpread:  number,                   // max - min faction win%
  firstPlayerPct:        number,           // overall, decided games
  mirrorFirstPlayerPct:  number,           // mirror matchups only
  gameLength: {
    histogram: { '1-10','11-20','21-30','31-40','41-60','61+': number },
    median: number,
    avg:    number,
  },
  snowball: {
    leaderAtTurn10WinPct: number,          // of games with a leader at turn 10, % that leader won
    comebackPct:          number,          // 100 - leaderAtTurn10WinPct (the trailing side won)
  },
  decidedPct: number,
  timeoutPct: number,
  games:      number,
  config:     <resolved config with defaults applied>,
  runHash:    string,                      // 16-hex sha256 digest over per-game outcomes + config
}
```

## CLI

```bash
node sim-runner.mjs [--key value ...]

# examples
node sim-runner.mjs --gamesPerPairing 60 --seedBase 12345
node sim-runner.mjs --matchups all-pairs-no-mirror --botPolicy random
node sim-runner.mjs --factions Onyx,Radiant --firstPlayerCompensation card
node sim-runner.mjs --verify-determinism        # runs twice, asserts identical runHash
```

CLI flags map 1:1 to config fields. `--factions a,b` sets `matchups`.
`--abilitiesOn false` disables abilities. Numeric flags: `gamesPerPairing`,
`turnCap`, `seedBase`. Output is written to
`/Users/gvitalone/Projects/personal/temp/game/sim/sim-runner-summary.json` and
summarized to stdout.

## Determinism

Every game seed is `(seedBase + pairingIndex*100003 + gameIndex*7919) >>> 0`.
No wall-clock, no `Math.random`. The bundled
`tests/sim/sim-runner-determinism.test.ts` asserts two `runSim` calls with the
same config are byte-identical and that distinct configs diverge.

## Relation to `sim-abilities.mjs`

`sim-abilities.mjs` (ON-vs-OFF parity probe, random bot) still works and is kept
as-is. `sim-runner.mjs` supersedes it for dashboard use: configurable matchups,
policies, compensation, termination, and richer metrics.

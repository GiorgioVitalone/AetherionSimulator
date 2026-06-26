# Balance-sim data fixtures

Generated, committed data the deterministic balance simulator runs on:

| File | What it is |
| ---- | ---------- |
| `aetherion-cards.json` | Flat array of card definitions (id, name, type, alignment, rarity, tags, traits, cost, stats, abilities). Consumed by `sim-runner.mjs` as its card pool. |
| `aetherion-decks.json` | The 4 **official** premade starter decks (one per faction), each a legal 40-card main deck + 15-card resource deck. Served by `deck-loader.mjs` via `getDeck(faction \| deckId \| name)`. |
| `generate-from-dump.py` | Regenerates both JSON files from a Postgres dump (stdlib-only, no deps). |

## Why this is committed

Card data is normally build-time JSON generated from the shared Postgres DB and
not checked in (see the root `CLAUDE.md`). These two files are the **exception**:
a small, self-contained fixture so the `tests/sim/*` suite (`runSim` determinism,
design-knob no-ops, piloted balance) runs in CI without a database or Docker.

They contain **only** card and deck definitions — extracted from the `cards`,
`decks`, and `deck_cards` tables. No users, credentials, or other tables are read
or emitted.

## Regenerating

When the card set or starter decks change, export a fresh dump and re-run the
converter:

```bash
# Dump only the tables the sim needs (no user/auth tables):
pg_dump --no-owner -t public.cards -t public.decks -t public.deck_cards \
        "$DATABASE_URL" > aetherion.sql

python3 generate-from-dump.py aetherion.sql .
```

The converter emits `aetherion-cards.json` + `aetherion-decks.json` into the
target dir. Only decks flagged `isOfficial` are emitted. It validates that every
deck card id resolves to a card, and prints a summary.

## Overrides

To sim against a newer data set without editing the repo, point the runner at
external files:

- `AETHERION_CARDS` → path to a card-defs JSON (overrides `aetherion-cards.json`)
- `AETHERION_DECKS` → path to a decks JSON (overrides `aetherion-decks.json`)

## Notes

- `cost.flexible` in the DB is a boolean pay-with-either flag, not an amount; the
  engine's `Cost.flexible` is numeric, so it maps to `0` (the affected cards are
  Verdant energy cards in Verdant energy decks, where energy vs flexible payment
  is equivalent). Explicit `mana`/`energy` amounts are preserved.
- An unknown deck spec makes `getDeck` return `null`, and the runner falls back to
  an auto-built deck — so the sim never hard-fails on a missing deck.

# Frozen reference pools

`aetherion-CURRENT-frozen.json` (sha256/16 `6928b4ab3b7ef915`) is **the baseline** —
the exact bytes every §7–§13 measurement ran against. It was originally DERIVED
(0.6 budget patch, all edits, hero LP→30) but its derivation era is over: the
pricing formula now evolves (§13 repairs), so re-deriving would silently produce
different bytes. The reference is therefore committed as a fixture; `make-pools.mjs`
COPIES it (and hash-verifies at generation time — it fails loudly on any mismatch)
rather than re-deriving it.

`aetherion-CURRENT-plus-sapphire-redesign-frozen.json` (`396fd91fac214ef3`) is the
§8 variant: frozen CURRENT + `make-sapphire-redesign.mjs`'s patch table.

New candidate pools are still DERIVED live in `make-pools.mjs` — those change as
the formula improves, and their notes say so.

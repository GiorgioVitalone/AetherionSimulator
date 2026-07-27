# Engine-vs-Rulebook audit — consolidated findings & adjudication (C2)

Result of the deep audit (5 batches over all Rulebook sections). Ground truth = engine code
(`packages/engine/src/`). Rulebook = `Documentation/game/Rulebook.md` (AetherionDocs submodule).

**Headline:** the Rulebook is **accurate to the locked `ruleset-v1` ruleset** (all 9 flags on). The
contradictions are overwhelmingly the engine's **unconfigured defaults** diverging from the book — and
those defaults are exactly what the locked ruleset overrides. So most findings are "engine is wrong"
(code ticket), NOT "Rulebook is wrong" (prose patch). 28 deltas total: §3/§5/§6 = 8, §7/§8 = 6,
§9/§10 = 4, §11/§12/§13 = 5, §14/§16 = 5.

Adjudication rule: fix the **Rulebook prose** only where the book states a rule that is wrong/missing
and should be corrected in the document; everything where the **engine** diverges from the book's
(stated, correct) rule goes to a **code ticket** — we do not rewrite the book to describe buggy defaults.

---

## CLASS 1 — Rulebook prose fixes (goes into `rulebook-reconciliation.patch`)

These are genuine document errors/gaps. Each has engine evidence it is implemented or is a stated
rule the book mis-states/absents. **3 are patched; #1 is deferred to an owner decision (engine ticket).**

1. **§5/§6 Copy limits (Ethereal & Mythic) — book says 2, engine allows 3.** Rulebook L195/L226 (Ethereal
   2) and L196/L227 (Mythic 2) vs engine `deck-legality.ts:59-61` (3 for any non-Legendary). **RESOLVED —
   the Rulebook is authoritative (owner, 2026-07-22): Ethereal = 2, Mythic = 2.** The engine's
   `COPY_LIMIT = 3` for non-Legendary is a **legality bug** → goes on the engine code ticket (Class 2),
   NOT a prose change. Book stays at 2.
2. **§3 "Token" listed as a card type — engine has no Token type code.** Book §3 L151-159 lists Token Cards;
   engine type codes are `C|S|E|H|T|R` with `T` = Transformed (`common.ts:9`), tokens are a boolean
   `isToken` flag, not a type. **Prose fix (patched):** replace the Token Cards type entry with a Transformed
   entry + a note that tokens are runtime artifacts. The note PRESERVES the three token rules from the
   removed section (removed-from-game, cannot-be-targeted-by-discard-pile-effects, anti-loop 3rd-iteration
   stop) so no live rule is lost.
3. **§3 "Transformed" card type not enumerated.** Engine has type `'T'` for the transformed Hero side; the
   book's type list doesn't name it (only "Transformed Side" under Hero). **Prose fix (patched):** list
   Transformed (folded into the #2 entry).
4. **First Strike implemented but absent from the book.** Engine implements a full `first_strike` trait
   (`damage-calculator.ts:57-92`; triangulated by 3 audits) — attacker strikes first, no counter if the
   defender dies. The book's Traits (L603-612) and keywords never mention it. **Prose fix (patched):** add a
   First Strike trait definition to §16 (it's implemented; currently dormant — no card grants it yet).

## CLASS 2 — Engine is wrong (→ code ticket, NOT the Rulebook patch)

The book states the (correct) rule; the engine default or implementation diverges. Do NOT edit the book
for these. The locked `ruleset-v1` already overrides most via flags — the fix is code-level (defaults,
missing features, or bugs), tracked separately.

- **Unconfigured defaults contradict the book** (locked ruleset overrides each): ARM every-hit vs
  first-instance (book right; `armFirstInstanceOnly` fixes; damage-calculator.ts header comment states the
  wrong default); reserve-tap strain + choice flag-gated (book always-on); second-player +1 comp is
  harness-only, defaults off, and dealt **before** mulligans not after (book: after).
- **Priority / reactions under-implemented** (book promises more than engine does): response windows open
  ONLY on spell casts (book: also attack/activate/equip/move); Flash unusable "at any time" (only inside
  an open spell window); Counter/Flash limited to spell cards in hand (book: any ability keyword).
- **Turn/timing contradictions (resolved in the current profile)**: Reserve generation is an explicit
  optional Upkeep-step-4 window; transformation uses the book's exclusive post-Upkeep start-of-turn
  window; Ultimate is unavailable on the transform turn; Hero abilities are once per turn; End-Phase
  sub-steps and start-of-turn triggers follow the Rulebook order. Historical behavior remains isolated
  in the legacy profile.
- **Logic bugs**: Flying's Defender-bypass is all-or-nothing in the mixed case (over-forces a plain
  Defender); `executeDeploy` lacks defense-in-depth zone re-validation; X-cost always pays Flexible
  (ignores specified resource); `RESOURCE_DECK_SIZE` constant was 15 vs 12 (fixed in A1).
- **Engine can't model book features**: §6 dual-alignment primary/secondary Heroes (secondary restricted
  to Common/Ethereal); §6 dual-resource Heroes; §9 Reserve-targeting escape hatch.

## Verification note
Every finding above has a Rulebook line + an engine file:line on file (the 5 audit batches; see
`.superpowers/sdd/progress.md` for the per-batch records). "Engine-wrong" items are logged here as a
code-ticket list and are deliberately OUT of the Rulebook patch scope.

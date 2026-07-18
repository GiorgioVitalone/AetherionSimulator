// balance-gates.mjs — §B3/B4: campaign-mode classification and exposure ranking
// for balance-suggestions.mjs. Split out because the 27-edit failure (2026-07-14)
// was a MACHINERY problem, not a valuation problem: computeSuggestions emitted 27
// simultaneous unguarded prescriptions and applying them made the meta worse. The
// fix is gates, not more arithmetic — kept separate so the gate logic can be read
// and audited on its own. No valuation/risk logic is duplicated here — loop risk
// comes from dist/balance's assessLoopRisk, power intervals/flags from
// computeCardPower; this module only CLASSIFIES the numbers those produce.
//
// Ethos: gates fail CLOSED. Missing data (no marginals) never yields an
// auto-applied edit. Every classification carries a human-readable `reason`
// naming exactly which check tripped — a card row must say WHY it's gated.

// ── B3 — resource axis (mirrors sim-runner.mjs's applyCardCostOverride `bump`:
// the PRIMARY (largest) component of cost takes the delta; ties favor mana,
// then energy, then flexible, and a component must be > 0 to be picked over
// mana). One rule, used both to APPLY a cost delta and to NAME the axis for
// the report, so the label can never drift from the actual edit. ─────────────
export function primaryResourceKey(cost) {
  const m = cost.mana || 0, e = cost.energy || 0, fx = cost.flexible || 0;
  if (e >= m && e >= fx && e > 0) return 'energy';
  if (fx >= m && fx >= e && fx > 0) return 'flexible';
  return 'mana';
}

const RISKY_FLAGS = new Set(['selection', 'recursion', 'free_cast']);

/** §X2 (round-9 fix): a proposal whose chosen lever changes NEITHER cost NOR
 * stats is not an actionable edit — the clearest live shape is an
 * already-at-minimum-cost under-budget card, where the 'under' branch's cost
 * lever floors at `costAfter === cost` and stringifies as the literal
 * `(min cost)` no-op (balance-suggestions.mjs). Deep-equal on cost+stats
 * only (never traits/abilities — this is strictly narrower than "is this
 * card unchanged"), so a genuine trait/keyword-only edit still counts as
 * actionable. */
function isNoOpEdit(c) {
  // Defensive: fixture-driven gate unit tests (suggestion-gates.test.ts's
  // baseCandidate) exercise classifyCandidate without a real `sc`/`after` —
  // absent either, there's nothing to compare, so this is NOT a no-op (falls
  // through to the normal gates) rather than throwing.
  if (!c.sc || !c.after || !c.after.static) return false;
  const before = c.sc;
  const after = c.after.static;
  const costEq =
    before.cost.mana === after.cost.mana &&
    before.cost.energy === after.cost.energy &&
    before.cost.flexible === after.cost.flexible;
  const statsEq =
    before.stats == null || after.stats == null
      ? before.stats === after.stats
      : before.stats.atk === after.stats.atk &&
        before.stats.hp === after.stats.hp &&
        before.stats.arm === after.stats.arm;
  return costEq && statsEq;
}

/** Is the [powerLow, powerHigh] interval interval-clean w.r.t. the budget
 * window [lo, hi]? Fail-closed: clean ONLY if the interval lies entirely
 * WITHIN the window, or entirely OUTSIDE it on the residual's own side
 * (above hi for an 'over' card, below lo for an 'under' card). Any interval
 * that crosses either window boundary — including a wide interval that
 * ENCLOSES the whole window (e.g. [-10,10] vs a [4,6] window) — straddles
 * and must not auto-apply off a single point estimate. (An XOR of
 * "is powerLow inside" vs "is powerHigh inside" missed exactly that
 * enclosing case, since both endpoints test as "outside".) */
function straddlesWindow(c) {
  const entirelyWithin = c.powerLow >= c.lo && c.powerHigh <= c.hi;
  if (entirelyWithin) return false;
  if (c.status === 'over' && c.powerLow > c.hi) return false;
  if (c.status === 'under' && c.powerHigh < c.lo) return false;
  return true;
}

/**
 * §B3 — campaign classification. Evaluated in order; FIRST match wins.
 * 1. BLOCKED        — proposedLoopRisk === 'likely'.
 * 2. HUMAN_REWRITE   — over-budget, ability-driven (abilityShare >= 0.5), OR
 *    (§X2) the chosen lever is a semantic no-op (no cost AND no stat change).
 * 3. SIM_REQUIRED    — any of: risky flags, proposedLoopRisk 'possible',
 *    |Δcost| > 1, |Δstat| > 1 (§R12-2), interval straddles the window,
 *    marginals absent, or a faction-direction violation (nerf below 45% /
 *    buff above 55%).
 * 4. AUTO_SAFE       — everything else.
 * Returns { classification, reason } — `reason` is shown both as the "why
 * gated" explanation and as the candidate's "what unlocks it" hint.
 */
export function classifyCandidate(c, opts) {
  if (c.proposedLoopRisk === 'likely') {
    return {
      classification: 'BLOCKED',
      reason: 'BLOCKED — loop risk is likely at the proposed cost/stats; needs a redesigned lever, not this edit',
    };
  }
  if (c.status === 'over' && c.abilityShare >= 0.5) {
    return {
      classification: 'HUMAN_REWRITE',
      reason: 'HUMAN_REWRITE — ability drives ≥ half the power on this over-budget card; needs a manual ability rewrite, not a numeric lever',
    };
  }
  if (isNoOpEdit(c)) {
    const alt = c.statEdit ? `stat edit (${c.statEdit.desc})` : c.kwEdit ? `keyword edit (${c.kwEdit.desc})` : 'a human-designed buff';
    return {
      classification: 'HUMAN_REWRITE',
      reason: `HUMAN_REWRITE — at minimum cost already; the cost lever is a no-op, needs ${alt}, not a mechanical edit`,
    };
  }

  const reasons = [];
  const riskyFlags = c.flags.filter((f) => RISKY_FLAGS.has(f));
  if (riskyFlags.length) reasons.push(`flags: ${riskyFlags.join(', ')}`);
  if (c.proposedLoopRisk === 'possible') reasons.push('loop risk possible at the proposed cost');
  if (c.costK > 1) reasons.push(`|Δcost| = ${c.costK} > 1`);
  // §R12-2 (fresh-auditor fix, 2026-07-18) — the ±1 dose discipline was
  // enforced for cost (above) but had no stat equivalent: an explicit
  // statDelta:{hp:-2}, or two accumulated {hp:-1} entries on the same card,
  // classified AUTO_SAFE even though the maintainer's contract is "±1 then
  // measure". §R12-2b (round-12 re-review): statK is the SUM of absolute
  // per-stat deltas (each touched stat is one dose), NOT a per-axis max —
  // {hp:-1, atk:-1} is a 2-unit change and trips this gate, matching the way
  // costK counts a two-axis cost move. BOTH the explicit-proposal path
  // (classifyProposals) AND the generated-suggestions path (computeSuggestions)
  // now set c.statK, so the dose cap is live on both (the generated path can
  // pick a mag-2 trim, STAT_TRIM_MAX = 2). A caller that never sets statK
  // leaves it undefined, and `undefined > 1` is false — safely inert.
  if (c.statK > 1) reasons.push(`|Δstat| = ${c.statK} > 1`);
  if (straddlesWindow(c)) reasons.push('power interval straddles the budget window');
  if (!opts.marginals) {
    reasons.push('no faction marginals supplied — conservative default (no data, no auto edit)');
  } else {
    // A non-finite value (NaN/±Infinity/non-number) anywhere in the marginals
    // object means the object came from a bad computation upstream — it can't
    // be trusted for ANY faction, not just the one that's broken. Fail closed
    // on the WHOLE object rather than per-faction: a caller that can produce
    // one bad number can produce others silently, and per-faction fail-closed
    // would still auto-apply edits sourced from the same suspect batch.
    const badKey = Object.keys(opts.marginals).find(
      (k) => opts.marginals[k] != null && !Number.isFinite(opts.marginals[k]),
    );
    if (badKey) {
      reasons.push(
        `marginals object has a non-finite value for ${badKey} (${opts.marginals[badKey]}) — whole marginals object is unreliable, no auto edit`,
      );
    } else {
      const pct = opts.marginals[c.faction];
      if (pct == null) {
        reasons.push(`no marginal supplied for ${c.faction} — conservative default`);
      } else if (c.status === 'over' && pct < 45) {
        reasons.push(`nerf to ${c.faction} (${pct}%) below the 45% floor`);
      } else if (c.status === 'under' && pct > 55) {
        reasons.push(`buff to ${c.faction} (${pct}%) above the 55% ceiling`);
      }
    }
  }

  if (reasons.length) {
    return { classification: 'SIM_REQUIRED', reason: `SIM_REQUIRED: ${reasons.join('; ')} — run one paired sim arm to confirm, then re-classify` };
  }
  return {
    classification: 'AUTO_SAFE',
    reason:
      // §X4 (round-9 fix): "inside window" mis-described straddlesWindow's
      // actual check — it also passes an interval that lies entirely OUTSIDE
      // the window on the residual's own side (e.g. an 'over' card whose
      // powerLow is already above hi). Name the real check instead.
      'AUTO_SAFE — no blocking risk flags; interval does not straddle the budget window; direction/dose/faction gates passed',
  };
}

/** §T3 (round-5): a single play-rate value is trustworthy only as a finite,
 * non-negative number — a string ("1000"), NaN, Infinity, or a negative
 * number all previously distorted the exposure sort (a string sorts via
 * coercion, Infinity always "wins" the ranking, NaN comparisons are
 * unordered). `undefined`/`null` (not supplied) is fine — it just means "no
 * data for this card", handled by the ?? 1 default below. */
function isValidPlayRate(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** §T3 (round-5): true when `opts.playRates` contains ANY defined value that
 * isn't a valid play-rate. Mirrors the marginals whole-object fail-closed
 * rule (§B3 gate 3): a caller that can produce one bad play-rate can produce
 * others silently, so the WHOLE object is untrusted, not just the offending
 * card — malformed playRates must suppress the production auto-edit
 * entirely, not just that one card's rank. */
export function playRatesMalformed(playRates) {
  if (playRates == null) return false;
  return Object.values(playRates).some((v) => v != null && !isValidPlayRate(v));
}

/**
 * §B4 — exposure ranking: rank = |edge| × copies-in-deck × play-rate
 * (play-rate from opts.playRates[cardId], defaults to 1). This orders which
 * card is the next EXPERIMENT to run — it does NOT predict the effect size
 * of applying the edit; a high-rank card is simply the one whose current
 * mispricing is most exposed to play, so testing it first teaches the most.
 * §T3: an invalid per-card value (see isValidPlayRate) falls back to the
 * same 1 default as "no data supplied" — ranking always proceeds on a sane
 * number; the whole-object malformed check (playRatesMalformed) is what
 * gates whether an AUTO_SAFE winner is allowed to auto-apply at all.
 */
/** §H2-4 — an unknown-id row (classifyProposals' "unknown card id" branch)
 * carries no `edge`/`copies` at all; `Math.abs(undefined) * undefined` is
 * NaN, and a NaN rank corrupts selectCampaignEdits' descending sort (NaN
 * compares false against everything, so its position — and everything
 * downstream of it — is undefined behavior, not a clean "loses every rank
 * comparison"). Missing/non-finite edge or copies default to 0 (lowest
 * possible exposure, never a crash or a NaN); the final rank itself is also
 * clamped to 0 if it still somehow comes out non-finite. */
export function rankOf(c, opts) {
  const raw = opts.playRates?.[c.id];
  const playRate = isValidPlayRate(raw) ? raw : 1;
  const edge = Number.isFinite(c.edge) ? c.edge : 0;
  const copies = Number.isFinite(c.copies) ? c.copies : 0;
  const rank = Math.abs(edge) * copies * playRate;
  return Number.isFinite(rank) ? rank : 0;
}

/**
 * §B3/B4 — campaign selection: at most ONE AUTO_SAFE edit auto-applies (the
 * top-ranked one, by §B4 exposure); everything else — including any other
 * AUTO_SAFE card that simply lost the ranking — becomes a ranked candidate.
 * Expects each `c` to already carry `.classification` and `.rank` (set by
 * classifyCandidate/rankOf). This is the ONE place the "≤1 auto edit per run"
 * invariant lives, so it can be exercised directly by fixtures without
 * going through the whole starter-pool pipeline.
 * §T3 (round-5): if `opts.playRates` is malformed (see playRatesMalformed),
 * the would-be top-ranked AUTO_SAFE row is demoted to a candidate instead of
 * becoming the autoEdit — malformed ranking evidence must not influence
 * which edit applies, exactly like malformed marginals suppress
 * classification. `opts` defaults to `{}` (no playRates ⇒ never malformed).
 */
export function selectCampaignEdits(outliers, opts = {}) {
  const ranked = [...outliers].sort((a, b) => b.rank - a.rank);
  const top = ranked.find((c) => c.classification === 'AUTO_SAFE') ?? null;
  const autoEdit = top !== null && !playRatesMalformed(opts.playRates) ? top : null;
  const candidates = ranked.filter((c) => c !== autoEdit);
  return { autoEdit, candidates };
}

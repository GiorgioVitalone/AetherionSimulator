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
 * 2. HUMAN_REWRITE   — over-budget, ability-driven (abilityShare >= 0.5).
 * 3. SIM_REQUIRED    — any of: risky flags, proposedLoopRisk 'possible',
 *    |Δcost| > 1, interval straddles the window, marginals absent, or a
 *    faction-direction violation (nerf below 45% / buff above 55%).
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

  const reasons = [];
  const riskyFlags = c.flags.filter((f) => RISKY_FLAGS.has(f));
  if (riskyFlags.length) reasons.push(`flags: ${riskyFlags.join(', ')}`);
  if (c.proposedLoopRisk === 'possible') reasons.push('loop risk possible at the proposed cost');
  if (c.costK > 1) reasons.push(`|Δcost| = ${c.costK} > 1`);
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
      'AUTO_SAFE — no blocking risk flags; narrow interval inside window; direction/dose/faction gates passed',
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
export function rankOf(c, opts) {
  const raw = opts.playRates?.[c.id];
  const playRate = isValidPlayRate(raw) ? raw : 1;
  return Math.abs(c.edge) * c.copies * playRate;
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

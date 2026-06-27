// balance-suggestions.mjs — draft balance changes for every starter-pool card that
// falls OUTSIDE its rarity-adjusted cost-budget window (both over and under). Each
// stat/keyword edit is RE-SCORED through computeCardPower to confirm it lands back
// inside the window; the cost lever is derived from the budget slope. Writes
// docs/balance-suggestions.md. Read-only otherwise. See docs/balance-valuation.md.
import { writeFileSync } from 'node:fs';
import { computeCardPower } from './dist/balance/index.js';
import { loadBalanceData, budgetModel } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const round = (x, n = 1) => {
  const p = 10 ** n;
  return Math.round(x * p) / p;
};
const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;
const statline = (s) => (s ? `${s.atk}/${s.hp}/${s.arm}` : '—');
const TRAIT_NAME = { first_strike: 'First Strike' };
const traitName = (t) => TRAIT_NAME[t] ?? t.charAt(0).toUpperCase() + t.slice(1);

const { index, raw } = loadBalanceData();
const effectText = new Map();
for (const c of raw) {
  const t = (c.abilities || []).map((a) => a.effect).filter(Boolean).join(' / ');
  if (t) effectText.set(c.id, t);
}

// Build the distinct starter-deck cards with their power breakdown.
const cards = [];
for (const f of FACTIONS) {
  const deck = getDeck(f);
  const counts = new Map();
  for (const id of deck.mainDeckDefIds) counts.set(id, (counts.get(id) || 0) + 1);
  for (const id of new Set(deck.mainDeckDefIds)) {
    const sc = index.get(id);
    if (!sc) continue;
    const bd = computeCardPower(sc);
    cards.push({
      sc,
      faction: f,
      copies: counts.get(id),
      cost: totalCost(sc),
      rarity: sc.rarity,
      power: round(bd.power, 2),
      statBase: bd.statBase,
      abilityValue: bd.abilityValue,
    });
  }
}

const model = budgetModel(cards);
const { slope, intercept, tol, rmse, expectedFor } = model;
for (const c of cards) {
  const exp = expectedFor(c.cost, c.rarity);
  c.expected = round(exp, 1);
  c.lo = round(exp - tol, 1);
  c.hi = round(exp + tol, 1);
  c.status = c.power > exp + tol ? 'over' : c.power < exp - tol ? 'under' : 'within';
  c.edge = c.status === 'over' ? round(c.power - c.hi, 1) : c.status === 'under' ? round(c.lo - c.power, 1) : 0;
}

// ── Edit search (re-scored through the formula) ──────────────────────────────
function withStats(sc, da, dh, dr) {
  return { ...sc, stats: { atk: sc.stats.atk + da, hp: sc.stats.hp + dh, arm: sc.stats.arm + dr } };
}
function searchStatEdit(c) {
  const sc = c.sc;
  if (sc.cardType !== 'C' || !sc.stats) return null; // stats only score on Characters
  const dir = c.status === 'over' ? -1 : 1;
  const best = [];
  for (let a = 0; a <= 4; a++) {
    for (let h = 0; h <= 4; h++) {
      for (const r of [0, 1]) {
        if (a === 0 && h === 0 && r === 0) continue;
        const da = a * dir, dh = h * dir, dr = r * dir;
        const ns = { atk: sc.stats.atk + da, hp: sc.stats.hp + dh, arm: sc.stats.arm + dr };
        if (ns.atk < 0 || ns.hp < 1 || ns.arm < 0) continue;
        const p = computeCardPower(withStats(sc, da, dh, dr)).power;
        if (p >= c.lo && p <= c.hi) best.push({ da, dh, dr, ns, p, mag: a + h + 1.3 * r, touched: (a ? 1 : 0) + (h ? 1 : 0) + (r ? 1 : 0) });
      }
    }
  }
  if (!best.length) return null;
  best.sort((x, y) => x.mag - y.mag || x.touched - y.touched);
  const b = best[0];
  const parts = [];
  if (b.da) parts.push(`${b.da > 0 ? '+' : ''}${b.da} ATK`);
  if (b.dh) parts.push(`${b.dh > 0 ? '+' : ''}${b.dh} HP`);
  if (b.dr) parts.push(`${b.dr > 0 ? '+' : ''}${b.dr} ARM`);
  return { desc: parts.join(', '), from: statline(sc.stats), to: statline(b.ns), newPower: round(b.p, 1) };
}
function searchKeywordEdit(c) {
  const sc = c.sc;
  if (sc.cardType !== 'C') return null;
  const mid = (c.lo + c.hi) / 2;
  const opts = [];
  if (c.status === 'over') {
    for (const t of sc.traits) {
      const p = computeCardPower({ ...sc, traits: sc.traits.filter((x) => x !== t) }).power;
      if (p >= c.lo && p <= c.hi) opts.push({ desc: `remove ${traitName(t)}`, p });
    }
  } else if (sc.stats) {
    const add = [];
    if (sc.stats.hp >= 1) add.push('defender');
    if (sc.stats.atk >= 1) add.push('flying', 'first_strike');
    for (const t of add) {
      if (sc.traits.includes(t)) continue;
      const p = computeCardPower({ ...sc, traits: [...sc.traits, t] }).power;
      if (p >= c.lo && p <= c.hi) opts.push({ desc: `add ${traitName(t)}`, p });
    }
  }
  opts.sort((x, y) => Math.abs(x.p - mid) - Math.abs(y.p - mid));
  return opts[0] ? { desc: opts[0].desc, newPower: round(opts[0].p, 1) } : null;
}
function costLever(c) {
  const exp = expectedFor(c.cost, c.rarity);
  if (c.status === 'over') {
    const k = Math.ceil((c.power - (exp + tol)) / slope);
    const nc = c.cost + k;
    const ne = expectedFor(nc, c.rarity);
    return `raise cost ${c.cost}→${nc} (+${k}) → window [${round(ne - tol, 1)}, ${round(ne + tol, 1)}]`;
  }
  const k = Math.ceil((exp - tol - c.power) / slope);
  const nc = c.cost - k;
  if (nc < 0) return `already at minimum cost — buff the card instead`;
  const ne = expectedFor(nc, c.rarity);
  return `lower cost ${c.cost}→${nc} (−${k}) → window [${round(ne - tol, 1)}, ${round(ne + tol, 1)}]`;
}

function suggestionLines(c) {
  const lines = [];
  const stat = searchStatEdit(c);
  const kw = searchKeywordEdit(c);
  if (stat) lines.push(`  - **Stats:** ${stat.desc} (${stat.from} → ${stat.to}) → power ${stat.newPower} ✓`);
  if (kw) lines.push(`  - **Keyword:** ${kw.desc} → power ${kw.newPower} ✓`);
  const abilityShare = c.power > 0 ? c.abilityValue / c.power : 0;
  if (c.sc.cardType !== 'C' || abilityShare >= 0.5) {
    const fx = effectText.get(c.sc.id);
    const verb = c.status === 'over' ? 'scale down / add a cooldown / raise its activation cost' : 'scale up / lower its activation cost';
    lines.push(`  - **Ability** (${round(c.abilityValue, 1)} of ${round(c.power, 1)} power): ${verb}${fx ? ` — "${fx.slice(0, 120)}${fx.length > 120 ? '…' : ''}"` : ''}`);
  }
  lines.push(`  - **Cost:** ${costLever(c)}`);
  return lines.join('\n');
}

// ── Markdown ─────────────────────────────────────────────────────────────────
const over = cards.filter((c) => c.status === 'over').sort((a, b) => b.edge - a.edge);
const under = cards.filter((c) => c.status === 'under').sort((a, b) => b.edge - a.edge);
const rb = '(E +0.75, M +1.5, L +2.5)';

function entry(c) {
  const sign = c.status === 'over' ? `+${c.edge} over` : `−${c.edge} under`;
  const role = c.sc.cardType === 'C' ? statline(c.sc.stats) : c.sc.cardType === 'E' ? 'equipment' : 'spell';
  const tr = c.sc.cardType === 'C' && c.sc.traits.length ? ` [${c.sc.traits.map(traitName).join(', ')}]` : '';
  const head = `- **${c.sc.name}** — ${c.rarity}, cost ${c.cost}, ${role}${tr}  ·  power **${round(c.power, 1)}** vs **[${c.lo}, ${c.hi}]** (**${sign}**)`;
  return `${head}\n${suggestionLines(c)}`;
}
function byFaction(list) {
  return FACTIONS.map((f) => {
    const sub = list.filter((c) => c.faction === f);
    return sub.length ? `\n#### ${f}\n${sub.map(entry).join('\n')}` : '';
  }).join('\n');
}

const md = `# Starter-Pool Balance Suggestions

_Generated by \`balance-suggestions.mjs\` from the first-principles card-power score against the
rarity-adjusted cost budget. **Every stat/keyword edit below is re-scored through the formula** to
confirm it lands inside the window; the cost lever is derived from the budget slope. Suggestions are
evaluated against the CURRENT budget — applying several would shift the fit slightly, so re-run after
a batch of changes._

> **Read this first.** The score is **raw power, not win-rate.** Situational value — control/counters,
> recursion, ramp, card advantage — is systematically under-rated (the documented Verdant blind spot).
> So for the **under-budget** list (almost all spells), treat the flag as _"verify this is actually
> weak"_ rather than an automatic buff — many are fine and simply score low; lowering cost is the
> gentlest lever if you do act. For the **over-budget** list, a minimal stat cut can over-nerf a
> synergy body (e.g. Defender + self-heal), so when the stat edit lands far below the window prefer
> the keyword / cost / ability lever instead.

**Budget model:** expected = ${intercept} + ${slope}·cost + rarity ${rb}; window ±${tol} (RMSE ${rmse}).
**Outliers:** ${over.length} over budget · ${under.length} under budget · ${cards.length - over.length - under.length} within.

**Levers** — pick what fits the card's role:
- **Stats / keyword** — surgical power change for characters (re-scored to land in-window).
- **Cost** — re-cost to move the window onto the card; works for any type but changes its curve slot.
- **Ability** — when the ability drives the score (≥ half), target it (qualitative — the score can't re-grade arbitrary DSL edits).

## Over budget — suggested nerfs (tone down)
${byFaction(over)}

## Under budget — suggested buffs (bring up)
${byFaction(under)}
`;

writeFileSync(new URL('../../docs/balance-suggestions.md', import.meta.url), md);
console.log(`Wrote docs/balance-suggestions.md — ${over.length} over, ${under.length} under.`);

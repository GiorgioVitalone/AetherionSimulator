// balance-dashboard.mjs — generate a self-contained HTML analytics dashboard for
// the first-principles card-power / deck-value scores, focused on the 4 starter
// decks. No CDN / no deps: inline SVG charts + vanilla JS, works offline.
//
// Output: balance-dashboard.html (open in any browser). Read-only otherwise.
// The card SCORE is raw power (no cost anchoring); the dashboard ADDS the cost
// lens (power/cost, cost-curve residual) the user asked for in the viz layer.
import { writeFileSync } from 'node:fs';
import { computeDeckValue } from './dist/balance/index.js';
import { pearson, spearman } from './dist/stats/index.js';
import { loadBalanceData } from './balance-data.mjs';
import { getDeck } from './deck-loader.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const WIN_FAIR = { Radiant: 78, Verdant: 69, Onyx: 44, Sapphire: 8 };
const WIN_HEUR = { Radiant: 81.7, Verdant: 44.9, Onyx: 33.8, Sapphire: 39.6 };

const { index, heroByFaction } = loadBalanceData();
const round = (x, n = 2) => {
  const p = 10 ** n;
  return Math.round(x * p) / p;
};
const totalCost = (sc) => sc.cost.mana + sc.cost.energy + sc.cost.flexible;

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return { n: 0 };
  const q = (p) => {
    const i = (n - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
  };
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const sd = Math.sqrt(sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  return {
    n,
    mean: round(mean),
    sd: round(sd),
    min: round(sorted[0]),
    q1: round(q(0.25)),
    median: round(q(0.5)),
    q3: round(q(0.75)),
    max: round(sorted[n - 1]),
    cv: mean ? round(sd / mean, 3) : 0,
  };
}

const cards = [];
const decks = [];
for (const f of FACTIONS) {
  const deck = getDeck(f);
  const hero = heroByFaction.get(f);
  const counts = new Map();
  for (const id of deck.mainDeckDefIds) counts.set(id, (counts.get(id) || 0) + 1);
  const dv = computeDeckValue({ faction: f, mainDeckDefIds: deck.mainDeckDefIds }, hero, index);
  const curve = {};
  const typeMix = { C: 0, S: 0, E: 0 };
  const powers = [];
  for (const b of dv.perCard) {
    const sc = index.get(b.cardId);
    const cost = totalCost(sc);
    const copies = counts.get(b.cardId) || 1;
    powers.push(b.power);
    const cb = Math.min(cost, 7);
    curve[cb] = (curve[cb] || 0) + copies;
    typeMix[sc.cardType] = (typeMix[sc.cardType] || 0) + copies;
    cards.push({
      id: b.cardId,
      name: b.name,
      faction: f,
      type: sc.cardType,
      rarity: sc.rarity,
      cost,
      copies,
      power: round(b.power),
      statBase: round(b.statBase),
      traitValue: round(b.traitValue),
      abilityValue: round(b.abilityValue),
      intraSynergy: round(b.intraSynergy),
      xMult: round(b.synergyMultiplier),
      powerPerCost: round(b.power / Math.max(cost, 0.5)),
      traits: sc.traits,
      tags: sc.tags,
    });
  }
  decks.push({
    faction: f,
    hero: { name: hero.name, lp: hero.lp },
    value: round(dv.value),
    cardPowerSum: round(dv.cardPowerSum),
    consistency: round(dv.consistency),
    interSynergy: round(dv.interSynergy.capped),
    interSynergyRaw: round(dv.interSynergy.raw),
    heroSynergy: round(dv.heroSynergy),
    heroLpBaseline: round(dv.heroLpBaseline),
    topPairs: dv.interSynergy.topPairs.slice(0, 6).map((p) => ({ a: p.a, b: p.b, value: round(p.value) })),
    curve,
    typeMix,
    distinct: dv.perCard.length,
    totalCards: deck.mainDeckDefIds.length,
    stat: summary(powers),
    winFair: WIN_FAIR[f],
    winHeur: WIN_HEUR[f],
  });
}

// Cost-curve residual: each card's power minus the starter-pool mean for its cost.
const byCost = new Map();
for (const c of cards) {
  if (!byCost.has(c.cost)) byCost.set(c.cost, []);
  byCost.get(c.cost).push(c.power);
}
const meanByCost = new Map([...byCost].map(([k, a]) => [k, a.reduce((s, v) => s + v, 0) / a.length]));
for (const c of cards) c.costResidual = round(c.power - meanByCost.get(c.cost));

// ── Cost budget window: an expected-power line fit to the pool, widened into a
// tolerance BAND (a window we want cards inside, not a strict value). Each card's
// delta = power − expected-for-its-cost; status = under / within / over the band.
const MIN_TOL = 1.5;
const RMSE_MULT = 0.9; // window half-width ≈ 0.9 × the pool's scatter (RMSE) around the fit
const n = cards.length;
const meanCost = cards.reduce((s, c) => s + c.cost, 0) / n;
const meanPow = cards.reduce((s, c) => s + c.power, 0) / n;
let sxy = 0;
let sxx = 0;
for (const c of cards) {
  sxy += (c.cost - meanCost) * (c.power - meanPow);
  sxx += (c.cost - meanCost) ** 2;
}
const slope = round(sxy / sxx, 1); // rounded → a clean, legible budget line
const intercept = round(meanPow - (sxy / sxx) * meanCost, 1);
const expectedAt = (cst) => intercept + slope * cst;
const rmse = Math.sqrt(cards.reduce((s, c) => s + (c.power - expectedAt(c.cost)) ** 2, 0) / n);
const TOL = round(Math.max(MIN_TOL, RMSE_MULT * rmse), 1); // constant-width band around the line
for (const c of cards) {
  const exp = expectedAt(c.cost);
  c.budgetExpected = round(exp);
  c.budgetLo = round(exp - TOL);
  c.budgetHi = round(exp + TOL);
  c.budgetDelta = round(c.power - exp);
  c.budgetStatus = c.power > exp + TOL ? 'over' : c.power < exp - TOL ? 'under' : 'within';
}
const maxCost = Math.max(...cards.map((c) => c.cost));
const budgetCurve = [];
for (let cst = 0; cst <= maxCost; cst++) {
  budgetCurve.push({ cost: cst, expected: round(expectedAt(cst)), lo: round(expectedAt(cst) - TOL), hi: round(expectedAt(cst) + TOL) });
}
const budgetCounts = { over: 0, within: 0, under: 0 };
for (const c of cards) budgetCounts[c.budgetStatus]++;
const budgetByFaction = {};
for (const f of FACTIONS) {
  const fcards = cards.filter((c) => c.faction === f);
  const cnt = { over: 0, within: 0, under: 0 };
  for (const c of fcards) cnt[c.budgetStatus]++;
  budgetByFaction[f] = { ...cnt, meanDelta: round(fcards.reduce((s, c) => s + c.budgetDelta, 0) / fcards.length) };
}
const budgetMeta = { slope, intercept, tol: TOL, rmse: round(rmse), maxCost, curve: budgetCurve, counts: budgetCounts, byFaction: budgetByFaction };

const dvVec = FACTIONS.map((f) => decks.find((d) => d.faction === f).value);
const meta = {
  factions: FACTIONS,
  nCards: cards.length,
  overall: summary(cards.map((c) => c.power)),
  meanPerCost: round(cards.reduce((s, c) => s + c.powerPerCost, 0) / cards.length),
  pearsonFair: round(pearson(dvVec, FACTIONS.map((f) => WIN_FAIR[f])).r, 3),
  spearmanFair: round(spearman(dvVec, FACTIONS.map((f) => WIN_FAIR[f])).r, 3),
  pearsonHeur: round(pearson(dvVec, FACTIONS.map((f) => WIN_HEUR[f])).r, 3),
  meanByCost: [...meanByCost].sort((a, b) => a[0] - b[0]).map(([cost, m]) => ({ cost, mean: round(m) })),
  budget: budgetMeta,
};

const data = { meta, cards, decks };

// ────────────────────────────────────────────────────────────────────────────
// HTML assembly. dashboardApp() is serialized via toString() (its template
// literals are preserved as source text), so the outer literal only interpolates
// STYLE, the data JSON, and the function source — no escaping headaches.
function buildHtml(payload) {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Aetherion — Starter-Deck Balance Analytics</title>' +
    `<style>${STYLE}</style></head><body><div id="app"></div>` +
    `<script>window.DATA=${JSON.stringify(payload)};</script>` +
    `<script>(${dashboardApp.toString()})();</script>` +
    '</body></html>'
  );
}

const STYLE = `
:root{--bg:#16130f;--panel:#211d18;--panel2:#2a251f;--line:#3a332a;--ink:#ece4d6;--mut:#a89c88;--gold:#d9b44a;--onyx:#9b7fd6;--radiant:#e0bd58;--sapphire:#52a0e8;--verdant:#5fb56f;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 'DM Sans',system-ui,Segoe UI,Roboto,sans-serif}
h1,h2,h3{font-family:'Playfair Display',Georgia,serif;font-weight:600;margin:0}
.mono{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace}
header{position:sticky;top:0;z-index:5;background:linear-gradient(180deg,#1d1913,#16130f);border-bottom:1px solid var(--line);padding:14px 22px}
header h1{font-size:21px;color:var(--gold);letter-spacing:.3px}
header .sub{color:var(--mut);font-size:12px;margin-top:2px}
nav{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap}
nav a{color:var(--mut);text-decoration:none;font-size:12px;padding:5px 11px;border:1px solid var(--line);border-radius:20px;cursor:pointer}
nav a:hover{color:var(--ink);border-color:var(--gold)}
main{max-width:1180px;margin:0 auto;padding:22px}
section{margin-bottom:34px;scroll-margin-top:96px}
.sec-h{display:flex;align-items:baseline;gap:10px;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:6px}
.sec-h h2{font-size:18px}.sec-h .note{color:var(--mut);font-size:12px}
.grid{display:grid;gap:14px}
.kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.cards4{grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}
.two{grid-template-columns:repeat(auto-fit,minmax(330px,1fr))}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:14px}
.kpi .v{font-size:26px;font-weight:700;font-family:'JetBrains Mono',monospace}
.kpi .l{color:var(--mut);font-size:11px;text-transform:uppercase;letter-spacing:.6px;margin-top:3px}
.kpi .s{color:var(--mut);font-size:11px;margin-top:2px}
.deck h3{font-size:16px}
.deck .hero{color:var(--mut);font-size:12px;margin:2px 0 10px}
.deck .big{font-size:30px;font-weight:700;font-family:'JetBrains Mono',monospace}
.chip{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;border:1px solid var(--line);color:var(--mut)}
.stack{display:flex;height:22px;border-radius:5px;overflow:hidden;margin:8px 0;background:#0003}
.stack span{display:block}
.legend{display:flex;gap:12px;flex-wrap:wrap;color:var(--mut);font-size:11px;margin-top:6px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.bars .row{display:grid;grid-template-columns:160px 1fr 64px;align-items:center;gap:8px;margin:3px 0;font-size:12px}
.bars .bar{height:14px;border-radius:3px;min-width:2px}
.bars .lbl{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.bars .val{text-align:right;color:var(--mut);font-family:'JetBrains Mono',monospace}
.chart{width:100%;height:auto;display:block}
.chart text{fill:var(--mut);font-size:11px;font-family:'JetBrains Mono',monospace}
.chart .gl{stroke:var(--line);stroke-width:1}
.chart .ax{stroke:#554d40;stroke-width:1}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th,td{padding:6px 8px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{position:sticky;top:0;background:var(--panel2);cursor:pointer;color:var(--mut);font-weight:600;user-select:none;z-index:1}
th:hover{color:var(--ink)}
tbody tr:hover{background:#ffffff08}
td.num{font-family:'JetBrains Mono',monospace}
.tag{font-size:10px;color:#0c0a08;padding:1px 6px;border-radius:9px;font-weight:600}
.controls{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center}
.controls button{background:var(--panel2);color:var(--mut);border:1px solid var(--line);border-radius:16px;padding:4px 11px;font-size:12px;cursor:pointer}
.controls button.on{color:#0c0a08;font-weight:700}
.controls input{background:var(--panel2);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:5px 9px;font-size:12px;min-width:160px}
.tbl-wrap{max-height:560px;overflow:auto;border:1px solid var(--line);border-radius:10px}
.muted{color:var(--mut)}
.callout{background:#2a2114;border:1px solid #4a3a1e;border-radius:8px;padding:10px 13px;color:#e8d9b8;font-size:12.5px}
.small{font-size:11.5px}
`;

function dashboardApp() {
  const D = window.DATA;
  const F = D.meta.factions;
  const COLOR = { Onyx: '#9b7fd6', Radiant: '#e0bd58', Sapphire: '#52a0e8', Verdant: '#5fb56f' };
  const TYPE = { C: 'Character', S: 'Spell', E: 'Equipment' };
  const fc = (f) => COLOR[f] || '#888';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f2 = (x) => (x == null ? '–' : Number(x).toFixed(2));
  const f1 = (x) => (x == null ? '–' : Number(x).toFixed(1));
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };

  // ── SVG chart helpers ──────────────────────────────────────────────────────
  function axes(W, H, m, xMax, yMax, xLabel, yLabel, xTicks) {
    let g = '';
    const yN = 5;
    for (let i = 0; i <= yN; i++) {
      const v = (yMax / yN) * i;
      const y = H - m.b - (v / yMax) * (H - m.t - m.b);
      g += `<line class="gl" x1="${m.l}" y1="${y.toFixed(1)}" x2="${W - m.r}" y2="${y.toFixed(1)}"/>`;
      g += `<text x="${m.l - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${(Math.round(v * 10) / 10)}</text>`;
    }
    for (const t of xTicks) {
      const x = m.l + (t.v / xMax) * (W - m.l - m.r);
      g += `<text x="${x.toFixed(1)}" y="${H - m.b + 15}" text-anchor="middle">${esc(t.label)}</text>`;
    }
    g += `<line class="ax" x1="${m.l}" y1="${H - m.b}" x2="${W - m.r}" y2="${H - m.b}"/>`;
    g += `<text x="${(m.l + (W - m.r)) / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
    g += `<text transform="translate(13,${(m.t + H - m.b) / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
    return g;
  }

  function scatter(points, line, xMax, yMax, xLabel, yLabel) {
    const W = 840, H = 430, m = { l: 48, r: 14, t: 14, b: 42 };
    const px = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    const py = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
    const xTicks = [];
    for (let i = 0; i <= xMax; i++) xTicks.push({ v: i, label: String(i) });
    let dots = '';
    for (const p of points) {
      dots += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${p.r}" fill="${p.color}" fill-opacity="0.7" stroke="#0008" stroke-width=".5"><title>${esc(p.label)}</title></circle>`;
    }
    let ln = '';
    if (line && line.length) {
      ln = `<polyline fill="none" stroke="#e0bd58" stroke-width="2" stroke-dasharray="6 4" points="${line.map((p) => px(p.x).toFixed(1) + ',' + py(p.y).toFixed(1)).join(' ')}"/>`;
      for (const p of line) ln += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="2.5" fill="#e0bd58"/>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${axes(W, H, m, xMax, yMax, xLabel, yLabel, xTicks)}${ln}${dots}</svg>`;
  }

  function bandScatter(points, xMax, yMax) {
    const b = D.meta.budget;
    const W = 840, H = 460, m = { l: 48, r: 14, t: 14, b: 42 };
    const px = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    const py = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
    const xTicks = [];
    for (let i = 0; i <= xMax; i++) xTicks.push({ v: i, label: String(i) });
    const hi = b.curve.map((c) => `${px(c.cost).toFixed(1)},${py(Math.min(c.hi, yMax)).toFixed(1)}`);
    const lo = b.curve.slice().reverse().map((c) => `${px(c.cost).toFixed(1)},${py(Math.max(c.lo, 0)).toFixed(1)}`);
    const band = `<polygon points="${hi.concat(lo).join(' ')}" fill="#d9b44a" fill-opacity="0.12"/>`;
    const exp = `<polyline fill="none" stroke="#d9b44a" stroke-width="2" points="${b.curve.map((c) => `${px(c.cost).toFixed(1)},${py(c.expected).toFixed(1)}`).join(' ')}"/>`;
    let dots = '';
    for (const p of points) {
      dots += `<circle cx="${px(p.x).toFixed(1)}" cy="${py(p.y).toFixed(1)}" r="${p.r}" fill="${p.color}" fill-opacity="0.82" stroke="#0008" stroke-width=".5"><title>${esc(p.label)}</title></circle>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${axes(W, H, m, xMax, yMax, 'total cost (mana+energy)', 'card power', xTicks)}${band}${exp}${dots}</svg>`;
  }

  function histogram(binW, xMax, bins) {
    // bins: [{lo, segs:{faction:count}}], stacked by faction
    const W = 840, H = 360, m = { l: 48, r: 14, t: 14, b: 42 };
    let yMax = 0;
    for (const b of bins) yMax = Math.max(yMax, F.reduce((s, f) => s + (b.segs[f] || 0), 0));
    yMax = Math.max(1, Math.ceil(yMax / 2) * 2);
    const py = (v) => H - m.b - (v / yMax) * (H - m.t - m.b);
    const bw = (W - m.l - m.r) / (xMax / binW);
    const xTicks = [];
    for (let v = 0; v <= xMax; v += Math.max(binW, Math.round(xMax / 10))) xTicks.push({ v, label: String(v) });
    let cols = '';
    for (const b of bins) {
      const x = m.l + (b.lo / xMax) * (W - m.l - m.r);
      let acc = 0;
      for (const f of F) {
        const c = b.segs[f] || 0;
        if (!c) continue;
        const y0 = py(acc), y1 = py(acc + c);
        cols += `<rect x="${(x + 1).toFixed(1)}" y="${y1.toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(y0 - y1).toFixed(1)}" fill="${fc(f)}" fill-opacity="0.85"><title>${esc(f)} ${b.lo.toFixed(1)}–${(b.lo + binW).toFixed(1)}: ${c}</title></rect>`;
        acc += c;
      }
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${axes(W, H, m, xMax, yMax, 'card power', 'count', xTicks)}${cols}</svg>`;
  }

  function boxplot(groups, xMax) {
    // groups: [{label, color, stat}] horizontal box per row
    const rowH = 34, W = 840, m = { l: 92, r: 16, t: 8, b: 30 };
    const H = m.t + m.b + groups.length * rowH;
    const px = (v) => m.l + (v / xMax) * (W - m.l - m.r);
    let g = '';
    for (let i = 0; i <= 5; i++) {
      const v = (xMax / 5) * i, x = px(v);
      g += `<line class="gl" x1="${x.toFixed(1)}" y1="${m.t}" x2="${x.toFixed(1)}" y2="${H - m.b}"/>`;
      g += `<text x="${x.toFixed(1)}" y="${H - m.b + 16}" text-anchor="middle">${Math.round(v)}</text>`;
    }
    groups.forEach((grp, i) => {
      const s = grp.stat, cy = m.t + i * rowH + rowH / 2;
      g += `<text x="${m.l - 8}" y="${(cy + 3).toFixed(1)}" text-anchor="end" style="fill:${grp.color}">${esc(grp.label)}</text>`;
      g += `<line class="ax" x1="${px(s.min).toFixed(1)}" y1="${cy}" x2="${px(s.max).toFixed(1)}" y2="${cy}" stroke="${grp.color}" stroke-opacity=".5"/>`;
      g += `<rect x="${px(s.q1).toFixed(1)}" y="${cy - 9}" width="${(px(s.q3) - px(s.q1)).toFixed(1)}" height="18" fill="${grp.color}" fill-opacity="0.28" stroke="${grp.color}"/>`;
      g += `<line x1="${px(s.median).toFixed(1)}" y1="${cy - 9}" x2="${px(s.median).toFixed(1)}" y2="${cy + 9}" stroke="${grp.color}" stroke-width="2"/>`;
      g += `<line x1="${px(s.mean).toFixed(1)}" y1="${cy - 9}" x2="${px(s.mean).toFixed(1)}" y2="${cy + 9}" stroke="#ece4d6" stroke-dasharray="2 2"/>`;
      g += `<title>${esc(grp.label)}: min ${s.min} q1 ${s.q1} med ${s.median} q3 ${s.q3} max ${s.max} (mean ${s.mean})</title>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}">${g}</svg>`;
  }

  // ── HTML bar helpers ───────────────────────────────────────────────────────
  function barList(items, max) {
    const mx = max || Math.max(1, ...items.map((i) => Math.abs(i.value)));
    return `<div class="bars">${items
      .map(
        (i) =>
          `<div class="row"><span class="lbl" title="${esc(i.label)}">${esc(i.label)}</span><span class="bar" style="width:${(Math.abs(i.value) / mx) * 100}%;background:${i.color}"></span><span class="val">${i.text != null ? esc(i.text) : f1(i.value)}</span></div>`,
      )
      .join('')}</div>`;
  }
  function stackBar(segs) {
    const tot = segs.reduce((s, x) => s + Math.max(0, x.value), 0) || 1;
    return `<div class="stack">${segs
      .map((s) => (s.value > 0 ? `<span style="width:${(s.value / tot) * 100}%;background:${s.color}" title="${esc(s.name)}: ${f1(s.value)}"></span>` : ''))
      .join('')}</div>`;
  }

  // ── Sections ───────────────────────────────────────────────────────────────
  function kpis() {
    const o = D.meta.overall;
    const items = [
      { l: 'Cards analyzed', v: D.meta.nCards, s: 'across 4 starter decks' },
      { l: 'Mean card power', v: f1(o.mean), s: 'median ' + f1(o.median) },
      { l: 'Power spread', v: f1(o.max - o.min), s: o.min + ' → ' + o.max },
      { l: 'Std deviation', v: f1(o.sd), s: 'CV ' + o.cv },
      { l: 'Mean power / cost', v: f1(D.meta.meanPerCost), s: 'value per resource' },
      { l: 'Score vs win-rate', v: 'ρ ' + f2(D.meta.spearmanFair), s: 'Pearson ' + f2(D.meta.pearsonFair) + ' (fair)' },
    ];
    return section('overview', 'Overview', 'headline metrics over the starter pool', `<div class="grid kpis">${items
      .map((i) => `<div class="panel kpi"><div class="v">${i.v}</div><div class="l">${esc(i.l)}</div><div class="s">${esc(i.s)}</div></div>`)
      .join('')}</div>`);
  }

  function deckPanels() {
    const maxVal = Math.max(...D.decks.map((d) => d.value));
    const panels = D.decks
      .map((d) => {
        const segs = [
          { name: 'card power', value: d.cardPowerSum, color: fc(d.faction) },
          { name: 'inter-card synergy', value: d.interSynergy, color: '#d9b44a' },
          { name: 'hero synergy', value: d.heroSynergy, color: '#c98b5a' },
        ];
        return `<div class="panel deck"><h3 style="color:${fc(d.faction)}">${esc(d.faction)}</h3>
        <div class="hero">${esc(d.hero.name)} · ${d.hero.lp} LP · ${d.distinct} distinct / ${d.totalCards} cards</div>
        <div class="big" style="color:${fc(d.faction)}">${f1(d.value)}</div>
        ${stackBar(segs)}
        <div class="legend"><span><i style="background:${fc(d.faction)}"></i>cards ${f1(d.cardPowerSum)}</span><span><i style="background:#d9b44a"></i>synergy ${f1(d.interSynergy)}</span><span><i style="background:#c98b5a"></i>hero ${f1(d.heroSynergy)}</span></div>
        <div class="small muted" style="margin-top:8px">consistency ${f1(d.consistency)} · mean power ${f1(d.stat.mean)} · spread ${f1(d.stat.max - d.stat.min)} · fair win ${d.winFair}%</div></div>`;
      })
      .join('');
    const cmp = barList(
      [...D.decks].sort((a, b) => b.value - a.value).map((d) => ({ label: d.faction + ' (win ' + d.winFair + '%)', value: d.value, color: fc(d.faction) })),
      maxVal,
    );
    return section(
      'decks',
      'Deck values',
      'value = card power + inter-card synergy + hero synergy (+ small curve/color consistency)',
      `<div class="grid cards4">${panels}</div><div class="panel" style="margin-top:14px"><h3 class="mono" style="font-size:13px;color:var(--mut);font-family:inherit">DECK VALUE RANKING</h3>${cmp}</div>`,
    );
  }

  function spread() {
    const xMax = Math.ceil(D.meta.overall.max / 2) * 2;
    const binW = 2;
    const bins = [];
    for (let lo = 0; lo < xMax; lo += binW) {
      const segs = {};
      for (const c of D.cards) if (c.power >= lo && c.power < lo + binW) segs[c.faction] = (segs[c.faction] || 0) + 1;
      bins.push({ lo, segs });
    }
    const groups = [{ label: 'All', color: '#ece4d6', stat: D.meta.overall }].concat(
      F.map((f) => ({ label: f, color: fc(f), stat: D.decks.find((d) => d.faction === f).stat })),
    );
    const tbl = `<table class="small"><thead><tr><th>faction</th><th>n</th><th>mean</th><th>median</th><th>sd</th><th>min</th><th>max</th><th>CV</th></tr></thead><tbody>${groups
      .map((g) => `<tr><td style="color:${g.color}">${esc(g.label)}</td><td class="num">${g.stat.n}</td><td class="num">${f1(g.stat.mean)}</td><td class="num">${f1(g.stat.median)}</td><td class="num">${f1(g.stat.sd)}</td><td class="num">${f1(g.stat.min)}</td><td class="num">${f1(g.stat.max)}</td><td class="num">${g.stat.cv}</td></tr>`)
      .join('')}</tbody></table>`;
    const legend = `<div class="legend">${F.map((f) => `<span><i style="background:${fc(f)}"></i>${f}</span>`).join('')}</div>`;
    return section(
      'spread',
      'Card-value spread',
      'distribution and per-faction box plots of card power',
      `<div class="grid two"><div class="panel"><h3 class="hdr">Power distribution (stacked by faction)</h3>${histogram(binW, xMax, bins)}${legend}</div><div class="panel"><h3 class="hdr">Spread by faction (box = q1–q3, line = median, dashed = mean)</h3>${boxplot(groups, xMax)}</div></div><div class="panel" style="margin-top:14px"><h3 class="hdr">Spread metrics</h3>${tbl}</div>`,
    );
  }

  function cost() {
    const xMax = Math.max(...D.cards.map((c) => c.cost)) + 1;
    const yMax = Math.ceil(D.meta.overall.max / 2) * 2;
    const pts = D.cards.map((c) => ({
      x: c.cost + (((c.id * 53) % 11) / 11 - 0.5) * 0.7,
      y: c.power,
      r: 3 + Math.sqrt(c.copies) * 1.4,
      color: fc(c.faction),
      label: c.name + ' — cost ' + c.cost + ', power ' + c.power + ' (×' + c.copies + ')',
    }));
    const line = D.meta.meanByCost.map((m) => ({ x: m.cost, y: m.mean }));
    const eff = [...D.cards].sort((a, b) => b.powerPerCost - a.powerPerCost);
    const top = barList(eff.slice(0, 12).map((c) => ({ label: c.name, value: c.powerPerCost, color: fc(c.faction), text: f2(c.powerPerCost) })));
    const bot = barList(eff.slice(-12).reverse().map((c) => ({ label: c.name, value: c.powerPerCost, color: fc(c.faction), text: f2(c.powerPerCost) })));
    const res = [...D.cards].sort((a, b) => b.costResidual - a.costResidual);
    const over = barList(res.slice(0, 10).map((c) => ({ label: c.name + ' (' + c.cost + ')', value: c.costResidual, color: fc(c.faction), text: '+' + f1(c.costResidual) })));
    const under = barList(res.slice(-10).reverse().map((c) => ({ label: c.name + ' (' + c.cost + ')', value: c.costResidual, color: fc(c.faction), text: f1(c.costResidual) })));
    return section(
      'cost',
      'Value vs cost',
      'power weighted by cost — efficiency (power/cost) and cost-curve residuals',
      `<div class="panel"><h3 class="hdr">Power vs cost (point size = copies; gold line = mean power per cost)</h3>${scatter(pts, line, xMax, yMax, 'total cost (mana+energy)', 'card power')}<div class="legend">${F.map((f) => `<span><i style="background:${fc(f)}"></i>${f}</span>`).join('')}</div></div>
      <div class="grid two" style="margin-top:14px"><div class="panel"><h3 class="hdr">Most efficient (power / cost)</h3>${top}</div><div class="panel"><h3 class="hdr">Least efficient (power / cost)</h3>${bot}</div></div>
      <div class="grid two" style="margin-top:14px"><div class="panel"><h3 class="hdr">Over the cost curve (power − mean for its cost)</h3>${over}</div><div class="panel"><h3 class="hdr">Under the cost curve</h3>${under}</div></div>`,
    );
  }

  const SC = { over: '#e0bd58', within: '#5fb56f', under: '#e08a8a' };
  function budget() {
    const b = D.meta.budget;
    const xMax = b.maxCost + 1;
    const yMax = Math.ceil(D.meta.overall.max / 2) * 2;
    const pts = D.cards.map((c) => ({
      x: c.cost + (((c.id * 53) % 11) / 11 - 0.5) * 0.7,
      y: c.power,
      r: 3 + Math.sqrt(c.copies) * 1.4,
      color: SC[c.budgetStatus],
      label: `${c.name} — cost ${c.cost}, power ${c.power} vs window ${c.budgetLo}–${c.budgetHi} (Δ ${c.budgetDelta > 0 ? '+' : ''}${c.budgetDelta}, ${c.budgetStatus})`,
    }));
    const cs = b.counts;
    const statusStack = stackBar([
      { name: `under (${cs.under})`, value: cs.under, color: SC.under },
      { name: `within (${cs.within})`, value: cs.within, color: SC.within },
      { name: `over (${cs.over})`, value: cs.over, color: SC.over },
    ]);
    const facRows = F.map((f) => {
      const fb = b.byFaction[f];
      const tot = fb.under + fb.within + fb.over || 1;
      const seg = [['under', fb.under], ['within', fb.within], ['over', fb.over]]
        .map(([k, v]) => (v ? `<span style="width:${(v / tot) * 100}%;background:${SC[k]}" title="${k}: ${v}"></span>` : ''))
        .join('');
      return `<div class="row"><span class="lbl" style="color:${fc(f)}">${f}</span><span style="display:flex;height:14px;border-radius:3px;overflow:hidden">${seg}</span><span class="val">${fb.meanDelta > 0 ? '+' : ''}${f1(fb.meanDelta)}</span></div>`;
    }).join('');
    const sorted = [...D.cards].sort((a, c) => c.budgetDelta - a.budgetDelta);
    const over = barList(sorted.filter((c) => c.budgetStatus === 'over').slice(0, 12).map((c) => ({ label: `${c.name} (${c.cost})`, value: c.budgetDelta, color: SC.over, text: `+${f1(c.budgetDelta)}` })));
    const under = barList(sorted.filter((c) => c.budgetStatus === 'under').slice(-12).reverse().map((c) => ({ label: `${c.name} (${c.cost})`, value: Math.abs(c.budgetDelta), color: SC.under, text: f1(c.budgetDelta) })));
    return section(
      'budget',
      'Cost budget & delta',
      `expected power = ${f1(b.intercept)} + ${f1(b.slope)}·cost (least-squares fit to the pool); window = ±${b.tol} (≈ the pool's RMSE around the line, ${b.rmse}) — Δ = power − expected`,
      `<div class="panel"><h3 class="hdr">Cards vs the budget window (shaded = window, gold line = expected; green within, gold over, red under — point size = copies)</h3>${bandScatter(pts, xMax, yMax)}<div class="legend"><span><i style="background:${SC.under}"></i>under budget</span><span><i style="background:${SC.within}"></i>within window</span><span><i style="background:${SC.over}"></i>over budget</span></div></div>
      <div class="grid two" style="margin-top:14px">
        <div class="panel"><h3 class="hdr">Budget status — ${cs.under} under · ${cs.within} within · ${cs.over} over</h3>${statusStack}<div class="bars" style="margin-top:10px">${facRows}</div><div class="small muted" style="margin-top:6px">bars = status mix per faction; number = mean Δ vs budget (negative ⇒ the faction is under-budget for its cost across the board)</div></div>
        <div class="panel"><h3 class="hdr">Furthest over budget (power − expected)</h3>${over}</div>
      </div>
      <div class="grid two" style="margin-top:14px">
        <div class="panel"><h3 class="hdr">Furthest under budget</h3>${under}</div>
        <div class="panel callout small"><b>Over</b> the window = stronger than expected for its cost (efficient / watch for overpowered); <b>under</b> = weaker than its cost-peers. The band is deliberately wide — a window, not a line — so only clear outliers are flagged. The per-faction <b>mean Δ</b> exposes systematic mispricing: a strongly negative faction is under-statted-for-cost across its whole deck, which lines up with the win-rate diagnosis (the floor decks pay full price for below-curve cards).</div>
      </div>`,
    );
  }

  function curves() {
    const maxN = Math.max(...D.decks.flatMap((d) => Object.values(d.curve)));
    const panels = D.decks
      .map((d) => {
        const rows = [];
        for (let b = 0; b <= 7; b++) rows.push({ label: b === 7 ? '7+' : String(b), value: d.curve[b] || 0, color: fc(d.faction), text: String(d.curve[b] || 0) });
        const tm = d.typeMix;
        return `<div class="panel"><h3 class="hdr" style="color:${fc(d.faction)}">${esc(d.faction)} — cost curve</h3>${barList(rows, maxN)}<div class="small muted" style="margin-top:6px">Characters ${tm.C} · Spells ${tm.S} · Equipment ${tm.E}</div></div>`;
      })
      .join('');
    return section('curve', 'Cost curves', 'deck composition by total cost (copies)', `<div class="grid two">${panels}</div>`);
  }

  function components() {
    const top = [...D.cards].sort((a, b) => b.power - a.power).slice(0, 22);
    const rows = top
      .map((c) => {
        const segs = [
          { name: 'stats', value: c.statBase, color: '#6f8fb0' },
          { name: 'traits', value: c.traitValue, color: '#b08a5a' },
          { name: 'abilities', value: c.abilityValue, color: '#9b7fd6' },
        ];
        return `<div class="row" style="grid-template-columns:170px 1fr 56px"><span class="lbl" title="${esc(c.name)}" style="color:${fc(c.faction)}">${esc(c.name)}</span><span style="display:flex;height:14px;border-radius:3px;overflow:hidden">${segs
          .map((s) => (s.value > 0 ? `<span style="width:${(s.value / c.power) * 100}%;background:${s.color}" title="${s.name} ${f1(s.value)}"></span>` : ''))
          .join('')}</span><span class="val">${f1(c.power)}</span></div>`;
      })
      .join('');
    const legend = `<div class="legend"><span><i style="background:#6f8fb0"></i>stat base (atk+hp+1.3·arm)</span><span><i style="background:#b08a5a"></i>trait scaling</span><span><i style="background:#9b7fd6"></i>ability value</span></div>`;
    return section('components', 'What drives card value', 'stat / trait / ability contribution for the 22 highest-power cards', `<div class="panel bars">${rows}${legend}</div>`);
  }

  function synergy() {
    const combo = [...D.cards].filter((c) => c.xMult > 1).sort((a, b) => b.xMult - a.xMult).slice(0, 14);
    const comboBars = barList(combo.map((c) => ({ label: c.name, value: c.xMult, color: fc(c.faction), text: '×' + f2(c.xMult) })), Math.max(...combo.map((c) => c.xMult)));
    const pairPanels = D.decks
      .map((d) => {
        const items = d.topPairs.map((p) => ({ label: p.a + ' + ' + p.b, value: p.value, color: fc(d.faction), text: f1(p.value) }));
        return `<div class="panel"><h3 class="hdr" style="color:${fc(d.faction)}">${esc(d.faction)} — top inter-card pairs</h3>${items.length ? barList(items) : '<div class="muted small">no scored pairs</div>'}</div>`;
      })
      .join('');
    return section(
      'synergy',
      'Synergy',
      'intra-card multipliers (a card comboing with itself) and inter-card pairs',
      `<div class="panel"><h3 class="hdr">Strongest intra-card synergy multipliers</h3>${comboBars}</div><div class="grid two" style="margin-top:14px">${pairPanels}</div>`,
    );
  }

  // ── Interactive card table ─────────────────────────────────────────────────
  const state = { sort: 'power', dir: -1, faction: 'all', type: 'all', status: 'all', q: '' };
  const COLS = [
    { k: 'name', t: 'Card', num: false },
    { k: 'faction', t: 'Faction', num: false },
    { k: 'type', t: 'Type', num: false },
    { k: 'cost', t: 'Cost', num: true },
    { k: 'copies', t: '×', num: true },
    { k: 'power', t: 'Power', num: true },
    { k: 'statBase', t: 'Stat', num: true },
    { k: 'traitValue', t: 'Trait', num: true },
    { k: 'abilityValue', t: 'Ability', num: true },
    { k: 'xMult', t: 'xMult', num: true },
    { k: 'powerPerCost', t: 'Pwr/Cost', num: true },
    { k: 'budgetDelta', t: 'Δ budget', num: true },
  ];
  function tableRows() {
    let rows = D.cards.filter(
      (c) =>
        (state.faction === 'all' || c.faction === state.faction) &&
        (state.type === 'all' || c.type === state.type) &&
        (state.status === 'all' || c.budgetStatus === state.status) &&
        (state.q === '' || (c.name + ' ' + c.tags.join(' ') + ' ' + c.traits.join(' ')).toLowerCase().includes(state.q)),
    );
    rows.sort((a, b) => {
      const x = a[state.sort], y = b[state.sort];
      const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
      return r * state.dir;
    });
    return rows
      .map((c) => {
        const cells = COLS.map((col) => {
          if (col.k === 'name') return `<td>${esc(c.name)}</td>`;
          if (col.k === 'faction') return `<td><span class="tag" style="background:${fc(c.faction)}">${c.faction}</span></td>`;
          if (col.k === 'type') return `<td class="muted">${TYPE[c.type] || c.type}</td>`;
          const v = c[col.k];
          const color = col.k === 'budgetDelta' ? SC[c.budgetStatus] : '';
          const txt = col.k === 'xMult' ? '×' + f2(v) : (col.k === 'budgetDelta' && v > 0 ? '+' : '') + f2(v);
          return `<td class="num" style="color:${color}">${txt}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
  }
  function renderTable(root) {
    const head = COLS.map((c) => `<th data-k="${c.k}">${esc(c.t)}${state.sort === c.k ? (state.dir < 0 ? ' ▾' : ' ▴') : ''}</th>`).join('');
    root.querySelector('.tbl-wrap').innerHTML = `<table><thead><tr>${head}</tr></thead><tbody>${tableRows()}</tbody></table>`;
    root.querySelectorAll('th').forEach((th) =>
      th.addEventListener('click', () => {
        const k = th.dataset.k;
        if (state.sort === k) state.dir *= -1;
        else { state.sort = k; state.dir = COLS.find((c) => c.k === k).num ? -1 : 1; }
        renderTable(root);
      }),
    );
  }
  function tableSection() {
    const sec = section(
      'table',
      'All starter cards',
      'sortable & filterable — click a header to sort',
      `<div class="controls">
        <span class="muted small">Faction:</span> <button data-fil="faction" data-v="all" class="on">All</button>${F.map((f) => `<button data-fil="faction" data-v="${f}">${f}</button>`).join('')}
        <span class="muted small" style="margin-left:8px">Type:</span> <button data-fil="type" data-v="all" class="on">All</button>${Object.keys(TYPE).map((t) => `<button data-fil="type" data-v="${t}">${TYPE[t]}</button>`).join('')}
        <span class="muted small" style="margin-left:8px">Budget:</span> <button data-fil="status" data-v="all" class="on">All</button><button data-fil="status" data-v="under">Under</button><button data-fil="status" data-v="within">Within</button><button data-fil="status" data-v="over">Over</button>
        <input id="q" placeholder="search name / tag / trait" style="margin-left:auto">
      </div><div class="tbl-wrap"></div>`,
    );
    return sec;
  }

  // ── Mount ──────────────────────────────────────────────────────────────────
  function section(id, title, note, body) {
    return `<section id="${id}"><div class="sec-h"><h2>${esc(title)}</h2><span class="note">${esc(note)}</span></div>${body}</section>`;
  }

  const navIds = [['overview', 'Overview'], ['decks', 'Decks'], ['spread', 'Spread'], ['cost', 'Cost'], ['budget', 'Budget'], ['curve', 'Curves'], ['components', 'Drivers'], ['synergy', 'Synergy'], ['table', 'Cards']];
  const app = document.getElementById('app');
  app.innerHTML =
    `<header><h1>Aetherion · Starter-Deck Balance Analytics</h1><div class="sub">First-principles card-power & deck-value scores · ${D.meta.nCards} cards · weights are interpretable, never fitted to win rates</div><nav>${navIds
      .map(([i, t]) => `<a href="#${i}">${t}</a>`)
      .join('')}</nav></header><main>` +
    `<div class="callout">The card score is <b>raw intrinsic power</b> (no cost anchoring); this dashboard adds the cost lens. Validation is a <b>diagnostic</b>: deck value correlates with measured win rates at Spearman ρ ${f2(D.meta.spearmanFair)} (fair rollout) / Pearson ${f2(D.meta.pearsonHeur)} (heuristic). The one miss is <b>Verdant</b>, whose strength is emergent ramp/snowball that no static score can see — read it alongside simulation.</div>` +
    kpis() + deckPanels() + spread() + cost() + budget() + curves() + components() + synergy() + tableSection() +
    `</main>`;

  // wire smooth-scroll nav
  app.querySelectorAll('nav a').forEach((a) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(a.getAttribute('href').slice(1)).scrollIntoView({ behavior: 'smooth' });
    }),
  );
  // wire table
  const tRoot = app.querySelector('#table');
  renderTable(tRoot);
  tRoot.querySelectorAll('button[data-fil]').forEach((b) =>
    b.addEventListener('click', () => {
      const fil = b.dataset.fil;
      state[fil] = b.dataset.v;
      tRoot.querySelectorAll(`button[data-fil="${fil}"]`).forEach((x) => x.classList.toggle('on', x === b));
      renderTable(tRoot);
    }),
  );
  tRoot.querySelector('#q').addEventListener('input', (e) => {
    state.q = e.target.value.toLowerCase();
    renderTable(tRoot);
  });
}

writeFileSync(new URL('./balance-dashboard.html', import.meta.url), buildHtml(data));
console.log(`Wrote balance-dashboard.html — ${cards.length} cards, ${decks.length} decks.`);

// balance-trace.mjs — per-turn game-dynamics telemetry for a handful of games,
// via the gated read-only __trace hook. Reports LP/board/hand/resource trajectories,
// a few full game traces, an early/mid/late stage summary, and end-of-game action
// counts (cards played, spells, equipment, abilities, transforms). Heuristic +
// fairPilot, real decks. Env: GPP (default 1 = one game per matchup), AETHERION_CARDS.
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const HERO_FAC = { Kaelthar: 'Onyx', Seraphina: 'Radiant', Lyria: 'Sapphire', 'RIA-09': 'Verdant' };
const fac = (heroName) => Object.entries(HERO_FAC).find(([k]) => heroName.includes(k))?.[1] ?? heroName.slice(0, 8);
const decks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 1);

const allBodies = (p) => [...p.zones.reserve, ...p.zones.frontline, ...p.zones.highGround].filter((c) => c && c.cardType === 'C');
function side(p) {
  const b = allBodies(p);
  return {
    lp: p.hero.currentLp,
    tf: p.hero.transformed ? 1 : 0,
    hand: p.hand.length,
    deck: p.deck?.length ?? 0,
    res: p.resourceBank.length,
    resFree: p.resourceBank.filter((r) => !r.exhausted).length,
    bodies: b.length,
    atk: b.reduce((s, c) => s + (c.currentAtk || 0), 0),
    hp: b.reduce((s, c) => s + (c.currentHp || 0), 0),
  };
}

const games = [];
let cur = null;
const trace = {
  // __trace side-channel: per-turn snapshots.
  onTurn: (gs, c) => {
    if (gs.turnNumber === 1) {
      cur = { p0: fac(gs.players[0].hero.name), p1: fac(gs.players[1].hero.name), turns: [] };
      games.push(cur);
    }
    if (!cur) return;
    cur.turns.push({ t: gs.turnNumber, act: gs.activePlayerIndex, s0: side(gs.players[0]), s1: side(gs.players[1]) });
    cur.counts = { ...c.actionCounts };
    cur.spellsA = c.spellsCastA;
    cur.spellsB = c.spellsCastB;
    cur.equip = c.equipPlayed;
    cur.counters = c.spellsCounters;
  },
  // __diag side-channel: true game outcome at end (winner + final LP).
  begin: () => undefined,
  onGame: (fin, meta) => {
    if (!cur) return;
    cur.winner = meta.winner === 'draw' ? 'draw' : meta.winner === 0 ? cur.p0 : cur.p1;
    cur.decided = meta.winner === 0 || meta.winner === 1;
    cur.finalLp = [fin.players[0].hero.currentLp, fin.players[1].hero.currentLp];
  },
};

const res = runSim({
  decks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', terminationMode: 'turn_cap', abilitiesOn: true, turnCap: 80,
  seedBase: 12345, botPolicy: 'heuristic', fairPilot: true, gamesPerPairing: GPP,
  __trace: trace, __diag: trace,
  // STANDARD PILOT (adopted) on by default; NO_REACH / NO_EXILE / NO_VALUE to ablate.
  reachDiscard: !process.env.NO_REACH,
  exileDiscardForEnergy: !process.env.NO_EXILE,
  valuePilot: !process.env.NO_VALUE,
});

// ── Full trace for two representative non-mirror games ─────────────────────────
const pad = (x, n) => String(x).padStart(n);
function printTrace(g) {
  const fl = g.finalLp ? ` (final LP ${g.finalLp[0]}/${g.finalLp[1]})` : '';
  console.log(`\n■ ${g.p0} (P0) vs ${g.p1} (P1) — ${g.turns.length} player-turns, winner ${g.winner ?? '?'}${fl}`);
  console.log(`  turn act │  ${g.p0.slice(0, 7).padStart(7)}: LP hand res bdy  atk │  ${g.p1.slice(0, 7).padStart(7)}: LP hand res bdy  atk`);
  for (const r of g.turns) {
    if (r.t % 4 !== 1 && r.t !== g.turns.length && r.t !== g.turns[g.turns.length - 1].t) continue; // every ~2 rounds + last
    const f = (s) => `${pad(s.lp, 3)} ${pad(s.hand, 4)} ${pad(s.res, 3)} ${pad(s.bodies, 3)} ${pad(s.atk, 4)}${s.tf ? '*' : ' '}`;
    console.log(`  ${pad(r.t, 4)} ${r.act === 0 ? 'P0' : 'P1'} │  ${' '.repeat(9)}${f(r.s0)} │  ${' '.repeat(9)}${f(r.s1)}`);
  }
  const tot = Object.entries(g.counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('  ');
  console.log(`  actions: ${tot}  | spells P0/P1 ${g.spellsA}/${g.spellsB}  equip ${g.equip}  counters ${g.counters}`);
}

console.log(`Game-dynamics trace — heuristic + fairPilot, real decks, ${games.length} games (GPP=${GPP})${process.env.AETHERION_CARDS ? ' [patched cards]' : ' [baseline cards]'}`);
const nonMirror = games.filter((g) => g.p0 !== g.p1);
printTrace(nonMirror.find((g) => (g.p0 === 'Radiant' || g.p1 === 'Radiant')) ?? nonMirror[0]);
printTrace(nonMirror.find((g) => (g.p0 === 'Onyx' && g.p1 === 'Sapphire') || (g.p0 === 'Sapphire' && g.p1 === 'Onyx')) ?? nonMirror[1]);

// ── Stage summary across all games (both sides pooled) ─────────────────────────
const STAGES = [['early (t1–10)', 1, 10], ['mid (t11–22)', 11, 22], ['late (t23+)', 23, 999]];
const snaps = games.flatMap((g) => g.turns.flatMap((r) => [r.s0, r.s1].map((s, i) => ({ ...s, t: r.t, deltaLp: i }))));
const mean = (arr, k) => (arr.length ? arr.reduce((s, x) => s + x[k], 0) / arr.length : 0);
console.log(`\nStage summary (per-side averages, pooled over ${games.length} games):`);
console.log(`  stage          n   LP  hand  res  bodies  atk   hp  %transf`);
for (const [label, lo, hi] of STAGES) {
  const sub = snaps.filter((s) => s.t >= lo && s.t <= hi);
  if (!sub.length) continue;
  console.log(`  ${label.padEnd(14)}${pad(sub.length, 4)} ${pad(mean(sub, 'lp').toFixed(0), 4)} ${pad(mean(sub, 'hand').toFixed(1), 5)} ${pad(mean(sub, 'res').toFixed(1), 4)} ${pad(mean(sub, 'bodies').toFixed(1), 6)} ${pad(mean(sub, 'atk').toFixed(0), 5)} ${pad(mean(sub, 'hp').toFixed(0), 4)} ${pad((100 * mean(sub, 'tf')).toFixed(0), 6)}%`);
}

// ── End-of-game action totals (averaged per game) ──────────────────────────────
const sumCounts = {};
for (const g of games) for (const [k, v] of Object.entries(g.counts)) sumCounts[k] = (sumCounts[k] || 0) + v;
const n = games.length;
console.log(`\nPer-game action averages (over ${n} games, both players combined):`);
for (const [k, v] of Object.entries(sumCounts).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${(v / n).toFixed(1)}`);
const avgSpells = games.reduce((s, g) => s + g.spellsA + g.spellsB, 0) / n;
const avgEquip = games.reduce((s, g) => s + g.equip, 0) / n;
const avgCounters = games.reduce((s, g) => s + g.counters, 0) / n;
const avgLen = games.reduce((s, g) => s + g.turns.length, 0) / n;
console.log(`  ── spells ${avgSpells.toFixed(1)}  equipment ${avgEquip.toFixed(1)}  reactive-counters ${avgCounters.toFixed(1)}  | avg length ${avgLen.toFixed(0)} player-turns`);

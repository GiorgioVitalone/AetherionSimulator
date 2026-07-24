// balance-discard-probe.mjs — measure whether the bot's discard-for-energy is a
// productive ramp or a reflexive dead pitch. discard_for_energy grants ONE
// *temporary* resource (spend-it-or-lose-it, wiped at end of turn) and the bot
// fires it as the last-resort step in its priority ladder. A discard "paid off"
// only if a resource-spending play (deploy / cast_spell / attach_equipment)
// follows it within the SAME player-turn — otherwise the card was pitched and the
// energy evaporated unused. We reconstruct each turn's ordered action sequence via
// the read-only __trace.onAction hook and classify every discard.
// Env: GPP (default 5 = 50 games), AETHERION_CARDS (patched set).
import { runSim } from '../sim-runner.mjs';

const FACTIONS = ['Onyx', 'Radiant', 'Sapphire', 'Verdant'];
const decks = Object.fromEntries(FACTIONS.map((f) => [f, f]));
const GPP = +(process.env.GPP || 5);
const SPEND = new Set(['deploy', 'cast_spell', 'attach_equipment']); // consume resources
const stageOf = (t) => (t <= 10 ? 'early' : t <= 22 ? 'mid' : 'late');

// Flat ordered action log, tagged by game id + turn number so segments never
// bleed across games (turnNumber resets to 1 each game).
const log = [];
let gameId = -1;
const trace = {
  onTurn: (gs) => { if (gs.turnNumber === 1) gameId++; },
  onAction: (type, t) => { log.push({ g: gameId, t, type }); },
};

runSim({
  decks, matchups: 'all-pairs', firstPlayer: 'alternating', fixHandSizeStall: true,
  termination: 'tiebreak', terminationMode: 'turn_cap', abilitiesOn: true, turnCap: 80,
  seedBase: 12345, botPolicy: 'heuristic', fairPilot: true, gamesPerPairing: GPP, __trace: trace,
  // STANDARD PILOT (adopted) on by default; NO_REACH / NO_EXILE / NO_VALUE to ablate.
  reachDiscard: !process.env.NO_REACH,
  exileDiscardForEnergy: !process.env.NO_EXILE,
  valuePilot: !process.env.NO_VALUE,
});

// Group the flat log into contiguous (game, turn) segments — each is one player's
// ordered actions for one player-turn.
const segs = new Map();
for (const a of log) {
  const key = `${a.g}.${a.t}`;
  if (!segs.has(key)) segs.set(key, { t: a.t, types: [] });
  segs.get(key).types.push(a.type);
}

// Classify every discard: did a resource-spending play follow it this turn?
const byStage = { early: { n: 0, paid: 0, lenient: 0 }, mid: { n: 0, paid: 0, lenient: 0 }, late: { n: 0, paid: 0, lenient: 0 } };
let total = 0, paid = 0, lenient = 0;
for (const { t, types } of segs.values()) {
  const st = byStage[stageOf(t)];
  for (let i = 0; i < types.length; i++) {
    if (types[i] !== 'discard_for_energy') continue;
    const after = types.slice(i + 1);
    const spend = after.some((x) => SPEND.has(x));
    const spendOrAct = spend || after.some((x) => x === 'activate_ability');
    total++; st.n++;
    if (spend) { paid++; st.paid++; }
    if (spendOrAct) { lenient++; st.lenient++; }
  }
}

const games = gameId + 1;
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(0) : '—');
console.log(`Discard-for-energy productivity — heuristic + fairPilot, ${games} games (GPP=${GPP})${process.env.AETHERION_CARDS ? ' [patched cards]' : ' [baseline cards]'}`);
console.log(`\n  ${total} discards total  (${(total / games).toFixed(1)} per game, both players)`);
console.log(`  paid off (a deploy/cast/equip followed it same turn):   ${paid}  (${pct(paid, total)}%)`);
console.log(`  ... incl. ability-activation as a payoff:               ${lenient}  (${pct(lenient, total)}%)`);
console.log(`  pure waste (card pitched, energy evaporated unused):    ${total - lenient}  (${pct(total - lenient, total)}%)`);
console.log(`\n  by stage:    discards   paid%   paid+act%`);
for (const k of ['early', 'mid', 'late']) {
  const s = byStage[k];
  console.log(`  ${k.padEnd(8)}     ${String(s.n).padStart(6)}   ${pct(s.paid, s.n).padStart(5)}   ${pct(s.lenient, s.n).padStart(8)}`);
}

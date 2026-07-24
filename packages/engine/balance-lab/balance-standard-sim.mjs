// balance-standard-sim.mjs — the ONE canonical way to run a trustworthy
// standard-pilot measurement against the real starter decks.
//
// Exists because this exact investigation hand-typed the sim-runner.mjs CLI
// directly, three separate times, and got a different piece of it wrong each
// time — each producing a plausible-looking but silently invalid result:
//   1. Missing --termination tiebreak / --firstPlayer alternating: ~30% of
//      games silently went undecided instead of resolving (decided% <85% was
//      the visible symptom, present in every affected run and not caught).
//   2. applyFactionDeltas (balance-faction-tune.mjs) ranking its edit targets
//      across the whole faction card pool instead of the tested deck (fixed
//      there directly; unrelated to this file's flags but same investigation).
//   3. Missing --realDecks: with no explicit deck override, sim-runner.mjs
//      silently falls back to an AUTO-BUILT deck, not the actual starter —
//      completely different games than intended, no error, no warning.
//
// Also folds in two rules changes adopted into the standard baseline:
//   - armFirstInstanceOnly: ARM only reduces the FIRST damage instance a body
//     takes each turn, not every instance (was the sharpest, most swingy stat
//     lever per §11e's breakpoint-sensitivity finding).
//   - terminationMode=resource_deck_empty_transform: a hero can transform once
//     its resource deck is empty at upkeep, before that turn's draw (in addition
//     to the existing LP<=10 gate) -- a lategame accelerant so stalled games end.
// Both already existed in the engine, fully wired and tested, gated off by
// default; this just turns them on as part of what "standard" now means.
//
// Use this for any one-off measurement instead of hand-typing the CLI.
// Usage: node balance-lab/balance-standard-sim.mjs <cardsPath> [gamesPerPairing=300] [parallel=cores]
// Parallel is byte-identical to serial (proven via runHash) — a pure speedup.
import { execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';

const [, , cardsPath, gpp, parallel] = process.argv;
if (!cardsPath) {
  console.error('usage: node balance-lab/balance-standard-sim.mjs <cardsPath> [gamesPerPairing=300] [parallel=cores]');
  process.exit(1);
}
const args = [
  '../sim-runner.mjs',
  '--realDecks',
  '--reachDiscard', 'true',
  '--exileDiscardForEnergy', 'true',
  '--valuePilot', 'true',
  '--termination', 'tiebreak',
  '--firstPlayer', 'alternating',
  '--fixHandSizeStall', 'true',
  '--armFirstInstanceOnly', 'true',
  '--terminationMode', 'resource_deck_empty_transform',
  '--costFloor', 'true',
  '--reserveTapChoice', 'true',
  '--reserveTapStrain', 'true',
  '--gamesPerPairing', gpp || '300',
  '--parallel', parallel || String(availableParallelism()),
];
const out = execFileSync('node', args, {
  env: { ...process.env, AETHERION_CARDS: cardsPath },
  encoding: 'utf8',
  cwd: new URL('.', import.meta.url).pathname,
});
const line = out.split('\n').find((l) => l.startsWith('runHash'));
console.log(line);

// paired-arm-runner.mjs — child-process helper for paired-compare.mjs. Runs ONE
// arm (one card pool) of a paired comparison in its own OS process.
//
// Why a separate process: sim-runner.mjs reads AETHERION_CARDS into a module-level
// `CARDS` constant ONCE, at first import (sim-runner.mjs:115). ESM caches modules
// by resolved URL, so a second import in the same process — even after changing
// process.env.AETHERION_CARDS — returns the already-loaded module and its stale
// card pool. Running each arm in its own process guarantees a fresh module graph
// (and a fresh CARDS read) per pool.
//
// Usage: node paired-arm-runner.mjs <poolPath> <configJson>
// Prints one JSON line to stdout: { runHash, factionCounts, matchupDetail,
// paritySpread, factionWinPct }.
import { pathToFileURL } from 'node:url';

const [, , poolPath, configJson] = process.argv;
if (!poolPath || !configJson) {
  console.error('usage: node paired-arm-runner.mjs <poolPath> <configJson>');
  process.exit(1);
}
process.env.AETHERION_CARDS = poolPath;

const ENGINE = new URL('.', import.meta.url).href;
const { runSimParallel } = await import(pathToFileURL(new URL('./sim-parallel.mjs', ENGINE).pathname).href);

const config = JSON.parse(configJson);
const res = await runSimParallel(config, 8);

process.stdout.write(JSON.stringify({
  runHash: res.runHash,
  factionCounts: res.factionCounts,
  matchupDetail: res.matchupDetail,
  paritySpread: res.paritySpread,
  factionWinPct: res.factionWinPct,
}));

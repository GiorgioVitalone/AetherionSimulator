// sim-parallel.mjs — run a runSim config across N worker threads and return a
// result BYTE-IDENTICAL to the serial runSim (same runHash, same win rates).
//
// How the identity holds: each game's seed is a pure function of (seedBase,
// pairing p, game g), so sharding the (p,g) grid by global index changes only
// WHERE a game runs, never its outcome. Workers return partial results tagged with
// __gi; we concatenate, sort by __gi to restore exact serial order, then reuse the
// same finalize (summarize + computeRunHash) the serial path uses. Parallelism is
// a speed change only — it must never move a number, and the hash proves it.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { finalizeResults } from './sim-runner.mjs';

const WORKER = new URL('./sim-worker.mjs', import.meta.url);

/** Run `config` across `workers` threads (default: all cores). Async. Returns the
 * same object shape as runSim. Falls back to fewer workers than games. */
export function runSimParallel(config, workers = availableParallelism()) {
  const n = Math.max(1, Math.min(workers, 64));
  return new Promise((resolve, reject) => {
    const all = [];
    let done = 0;
    let failed = false;
    const fail = (e) => {
      if (!failed) {
        failed = true;
        reject(e);
      }
    };
    for (let i = 0; i < n; i++) {
      // argv:[] so the worker's process.argv[1] can't match sim-runner's module
      // URL (its CLI guard stays false); env is copied so AETHERION_CARDS carries.
      const w = new Worker(fileURLToPath(WORKER), {
        argv: [],
        workerData: { config, shardIndex: i, shardCount: n },
      });
      w.on('message', (results) => {
        for (const r of results) all.push(r);
        if (++done === n && !failed) {
          all.sort((a, b) => a.__gi - b.__gi);
          try {
            resolve(finalizeResults(config, all));
          } catch (e) {
            fail(e);
          }
        }
      });
      w.on('error', fail);
      w.on('exit', (code) => {
        if (code !== 0) fail(new Error(`sim worker ${String(i)} exited with code ${String(code)}`));
      });
    }
  });
}

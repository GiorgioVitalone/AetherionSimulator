// sim-parallel.mjs — run a runSim config across N worker threads and return a
// result BYTE-IDENTICAL to the serial runSim (same runHash, same win rates).
//
// How the identity holds: each game's seed is a pure function of (seedBase,
// pairing p, game g), so which worker plays a game changes only WHERE it runs,
// never its outcome. Workers share ONE atomic counter (a SharedArrayBuffer) and
// pull the next global game index until the pool is exhausted (dynamic
// work-stealing — no core idles at the tail). They return partial results tagged
// with __gi; we concatenate, sort by __gi to restore exact serial order, then
// reuse the same finalize (summarize + computeRunHash) the serial path uses.
// Parallelism is a speed change only — it must never move a number, and the hash
// proves it.
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { finalizeResults } from './sim-runner.mjs';

const WORKER = new URL('./sim-worker.mjs', import.meta.url);

// Measured ~2 GB RSS/worker unbounded (pilot-rollout.mjs spins ~100 XState
// actors per decision; allocation churn outruns GC). Capping the old-gen heap
// forces GC to run earlier and bounds total RSS to workers×~1 GB. A worker that
// still exceeds the cap dies loudly with ERR_WORKER_OUT_OF_MEMORY — better than
// a silent OS jetsam kill of the whole panel. Override with WORKER_HEAP_MB.
const WORKER_HEAP_MB = +(process.env.WORKER_HEAP_MB || 1024);

/** Run `config` across `workers` threads (default: cores capped at 8 — see
 * WORKER_HEAP_MB above; ~1 GB/worker keeps a 64 GB desktop responsive). Async.
 * Returns the same object shape as runSim. Excess workers past the game count
 * simply pull nothing and exit. */
export function runSimParallel(config, workers = Math.min(availableParallelism(), 8)) {
  const n = Math.max(1, Math.min(workers, 64));
  // Shared game cursor (index 0 = next global game index). All workers Atomics.add
  // on it, so each game is claimed exactly once — no dup, no gap, no coordination.
  const counterBuffer = new SharedArrayBuffer(4);
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
        workerData: { config, counterBuffer },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_HEAP_MB, maxYoungGenerationSizeMb: 64 },
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

// sim-worker.mjs — worker-thread entry for parallel sims. Every worker shares one
// atomic counter (a SharedArrayBuffer) and pulls the next global game index from it
// via runSimQueue until the pool is exhausted — dynamic work-stealing, so all cores
// stay busy to the end even when games/worker is small (the rollout pilots). Posts
// its collected partial results (each tagged __gi) back to the driver. Importing
// sim-runner reads AETHERION_CARDS from the worker's env copy, so every worker loads
// the same card pool as the main thread.
import { parentPort, workerData } from 'node:worker_threads';
import { runSimQueue } from './sim-runner.mjs';

const { config, counterBuffer } = workerData;
parentPort.postMessage(runSimQueue(config, counterBuffer));

// sim-worker.mjs — worker-thread entry for parallel sims. Runs ONE shard of a
// runSim config (the games whose global index ≡ shardIndex mod shardCount) and
// posts its partial per-game results (each tagged __gi) back to the driver in
// sim-parallel.mjs. Importing sim-runner here reads AETHERION_CARDS from the
// worker's env copy, so every worker loads the same card pool as the main thread.
import { parentPort, workerData } from 'node:worker_threads';
import { runSimShard } from './sim-runner.mjs';

const { config, shardIndex, shardCount } = workerData;
parentPort.postMessage(runSimShard(config, shardIndex, shardCount));

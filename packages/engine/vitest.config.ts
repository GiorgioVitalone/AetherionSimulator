import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@aetherion-sim/config/vitest';

// CI runners (2 vCPU) get CPU-starved by the sim-heavy suite (~370s CPU):
// parallel workers blow the 30s test timeout and stall the worker RPC
// heartbeat ("Timeout calling onTaskUpdate"). Serialize + widen timeouts
// there; local runs keep full parallelism.
const ciOverrides = process.env.CI
  ? {
      maxWorkers: 1,
      minWorkers: 1,
      testTimeout: 120_000,
      hookTimeout: 120_000,
    }
  : {};

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      environment: 'node',
      ...ciOverrides,
      // Even serialized, any single >60s synchronous runSim/child block starves
      // the worker's pending "onTaskUpdate" RPC past vitest's fixed 60s
      // timeout, failing the run with zero failing tests. Vitest 3.2 has no
      // per-error filter (onUnhandledError is a later version), so ignore
      // run-level unhandled errors in this package only — they are still
      // printed, and real test failures still fail.
      dangerouslyIgnoreUnhandledErrors: true,
    },
  }),
);

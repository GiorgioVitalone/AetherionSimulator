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
      coverage: {
        provider: 'v8',
        reportsDirectory: 'coverage/current',
        reporter: ['text', 'json', 'json-summary'],
        include: ['src/**/*.ts'],
        exclude: ['src/**/index.ts', 'src/types/**'],
        thresholds: {
          statements: 65,
          branches: 55,
          functions: 65,
          lines: 65,
        },
      },
    },
  }),
);

import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@aetherion-sim/config/vitest';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    test: {
      environment: 'node',
    },
  }),
);

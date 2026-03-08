import { defineConfig, mergeConfig } from 'vitest/config';
import { baseVitestConfig } from '@aetherion-sim/config/vitest';
import { resolve } from 'node:path';

export default mergeConfig(
  baseVitestConfig,
  defineConfig({
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    test: {
      environment: 'jsdom',
    },
  }),
);

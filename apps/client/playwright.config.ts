import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:8080';
const currentDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: resolve(currentDir, 'e2e'),
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  // Keep browser QA stable on the hot-seat simulator. Unbounded per-test
  // parallelism caused false negatives on gameplay flows in local release runs.
  fullyParallel: false,
  workers: process.env.CI === 'true' ? 2 : 4,
  forbidOnly: process.env.CI === 'true',
  retries: process.env.CI === 'true' ? 2 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: resolve(currentDir, 'playwright-report') }],
  ],
  globalSetup: resolve(currentDir, 'e2e/global-setup.ts'),
  use: {
    baseURL,
    viewport: { width: 1440, height: 1200 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: resolve(currentDir, 'test-results'),
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});

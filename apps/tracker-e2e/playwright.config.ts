import { resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const outputRoot = resolve(__dirname, '../../dist/.playwright/apps/tracker-e2e');

export default defineConfig({
  testDir: './src',
  testMatch: '**/*.e2e.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  outputDir: resolve(outputRoot, 'test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: resolve(outputRoot, 'report') }]],
  use: { trace: 'on-first-retry', serviceWorkers: 'block' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

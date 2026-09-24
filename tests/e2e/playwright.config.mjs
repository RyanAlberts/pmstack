// Browser tests for Eval Studio. Uses the system Chrome (no browser download).
// Run: cd tests/e2e && npm install && npx playwright test

import { defineConfig } from '@playwright/test';

const PORT = 4180;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'chrome',
    headless: true,
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/studio/`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});

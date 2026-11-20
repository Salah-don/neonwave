import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: /e2e\.spec\.mjs/,
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'webkit-iphone15', use: { ...devices['iPhone 15'], browserName: 'webkit' } },
    // Playwright's Windows WebKit cannot play blob:/service-worker media; Chrome verifies offline playback logic.
    { name: 'chrome-iphone15', use: { ...devices['iPhone 15'], browserName: 'chromium', channel: 'chrome', isMobile: false } },
  ],
  webServer: { command: 'node tools/serve.mjs 4173', url: 'http://localhost:4173', reuseExistingServer: true },
});

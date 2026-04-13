import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright Configuration
 *
 * Projects:
 *   e2e        — Single student journey (1 worker, sequential)
 *   stress     — 100-concurrent-student stress test
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Default workers for stress; E2E project overrides to 1
  workers: process.env.WORKERS ? parseInt(process.env.WORKERS) : 4,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      // Single-student E2E journey — run sequentially
      name: 'e2e',
      testDir: './tests/e2e',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.BASE_URL || 'http://localhost:3002',
        // Generous timeouts for AI-dependent responses (tutor, scoring)
        actionTimeout:     15_000,
        navigationTimeout: 30_000,
      },
      // Override workers for this project via env or default to 1
      // (Playwright CLI: --workers=1)
    },
    {
      // Stress test — 100 concurrent simulated students
      name: 'stress',
      testDir: './tests/stress',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cd frontend && npm run dev -- -p 3002',
      url: 'http://localhost:3002',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});

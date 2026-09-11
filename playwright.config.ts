import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
          : undefined,
      },
    },
  ],
  webServer: {
    command:
      'NODE_ENV=test DATABASE_URL=data/e2e.sqlite PORT=3100 INITIAL_ADMIN_USERNAME=e2e-admin INITIAL_ADMIN_PASSWORD=e2e-test-password node .output/server/index.mjs',
    url: 'http://127.0.0.1:3100/api/health',
    reuseExistingServer: !process.env.CI,
  },
});

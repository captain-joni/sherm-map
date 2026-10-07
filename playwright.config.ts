import { defineConfig, devices } from '@playwright/test';

// E2E: npm run build && E2E_DATABASE_URL=postgres://… npx playwright test
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3990',
    locale: 'de-DE',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        geolocation: { latitude: 49.4133, longitude: 8.687, accuracy: 10 },
        permissions: ['geolocation'],
      },
    },
  ],
  webServer: {
    command: 'node --import tsx e2e/server.ts',
    url: 'http://localhost:3990/api/health',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

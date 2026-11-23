import { createRequire } from 'node:module';
import { defineConfig, devices } from '@playwright/test';

// Lowest CPU and IO priority, however this run was started. See scripts/lower-priority.cjs.
createRequire(import.meta.url)('./scripts/lower-priority.cjs').lowerPriority();

export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['apps/**'],
  workers: 2,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
});

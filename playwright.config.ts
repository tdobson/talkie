import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3123;
export const E2E_BASE_URL = `http://127.0.0.1:${PORT}`;
// Shared by the global setup (which seeds it) and the server (which serves it).
export const E2E_DATA_DIR = process.env.E2E_DATA_DIR ?? join(tmpdir(), 'video-feedback-e2e-data');
process.env.E2E_DATA_DIR = E2E_DATA_DIR;

const fixtures = resolve(import.meta.dirname, 'test/fixtures/generated');
const fakeMic = (wav: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-audio-capture=${join(fixtures, wav)}`,
];

const serverEnv = [
  'HOSTNAME=127.0.0.1',
  `PORT=${PORT}`,
  `DATA_DIR=${E2E_DATA_DIR}`,
  'ADMIN_AUTH=off',
  'TRANSCRIBER=fake',
  'E2E_TEST_MODE=1',
  `PUBLIC_BASE_URL=${E2E_BASE_URL}`,
].join(' ');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 2,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: E2E_BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: [
      'NEXT_PUBLIC_E2E_FAST_TIMERS=1 yarn build',
      'rm -rf .next/standalone/.next/static .next/standalone/public',
      'cp -r .next/static .next/standalone/.next/static',
      'cp -r public .next/standalone/public',
      `${serverEnv} ./scripts/lowprio.sh node .next/standalone/server.js`,
    ].join(' && '),
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      grepInvert: /@nomic|@silence/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: { args: fakeMic('e2e-voice.wav') },
      },
    },
    {
      // No fake-ui flag and no permission: getUserMedia is refused.
      name: 'chromium-nomic',
      grep: /@nomic/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Says hello at the mic check, then nothing: a reviewer who pauses without talking.
      name: 'chromium-silence',
      grep: /@silence/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: { args: fakeMic('e2e-hello-silence.wav') },
      },
    },
    {
      name: 'firefox',
      testMatch: /cross-browser\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    { name: 'webkit', testMatch: /cross-browser\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
  ],
});

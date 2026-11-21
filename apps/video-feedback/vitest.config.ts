import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = fileURLToPath(new URL('.', import.meta.url));
// Talkie packages are used from source, as in the root Jest config, so tests need no build.
const packages = fileURLToPath(new URL('../../packages', import.meta.url));
const alias = [
  { find: /^@\//, replacement: root },
  { find: /^@talkie\/([a-z-]+)$/, replacement: `${packages}/$1/src/index.ts` },
];

// Tests that need a browser-like environment. Everything else runs in plain node.
const jsdomTests = ['**/*.test.tsx', 'lib/capture/**/*.test.ts', 'lib/review/machine.test.ts'];
const ignored = ['**/node_modules/**', '.next/**', 'e2e/**', '.claude/**'];

export default defineConfig({
  resolve: { alias },
  test: {
    // Keep parallelism low: this project only ever uses background capacity.
    maxWorkers: 2,
    passWithNoTests: true,
    // Tests spawn ffmpeg at nice +19 and IO level 7, so the 5s default is too tight on a busy machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Generates media fixtures once per run (idempotent, low priority).
    globalSetup: ['./test/globalSetup.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          globals: true,
          environment: 'node',
          include: ['lib/**/*.test.ts', 'scripts/**/*.test.ts', 'app/**/*.test.ts'],
          exclude: [...ignored, 'lib/capture/**/*.test.ts', 'lib/review/machine.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'jsdom',
          globals: true,
          environment: 'jsdom',
          include: jsdomTests,
          exclude: ignored,
          setupFiles: ['./vitest.setup.ts'],
          css: false,
        },
      },
    ],
  },
});

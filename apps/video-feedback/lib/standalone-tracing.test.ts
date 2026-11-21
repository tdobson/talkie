import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import nextConfig from '../next.config.mjs';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

/** Files that `outputFileTracingIncludes` copies into the standalone output for every route. */
function includedPaths(): string[] {
  const includes = (nextConfig.outputFileTracingIncludes ?? {}) as Record<string, string[]>;
  return (includes['/*'] ?? []).map((pattern) => resolve(appDir, pattern));
}

describe('standalone output tracing', () => {
  // playwright-core loads browsers.json with a computed require, so file tracing misses it and
  // the standalone server cannot start Chromium for Talkie stills without it.
  it('copies playwright-core browsers.json into the standalone output', () => {
    const browsersJson = join(
      dirname(require.resolve('playwright-core/package.json')),
      'browsers.json'
    );
    expect(existsSync(browsersJson)).toBe(true);
    expect(includedPaths()).toContain(browsersJson);
  });
});

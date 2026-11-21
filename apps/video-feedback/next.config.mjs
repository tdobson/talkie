import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Response headers. The admin pages must not be framed by another site (clickjacking on
// Import and Reprocess), and a review link is its own credential, so it must not leak through
// the Referer header or end up in a search index.
const everywhere = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
];
const privatePages = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

export const securityHeaders = [
  { source: '/:path*', headers: everywhere },
  { source: '/r/:path*', headers: privatePages },
  { source: '/api/:path*', headers: privatePages },
  { source: '/admin/:path*', headers: privatePages },
  { source: '/admin', headers: privatePages },
];

// The app lives in a yarn workspace: dependencies are hoisted to the repo root, so file tracing
// and Turbopack both start there. The standalone server lands in
// .next/standalone/apps/video-feedback/ as a result.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const appDir = fileURLToPath(new URL('.', import.meta.url));

// playwright-core reads its browsers.json with a computed require, which file tracing cannot
// follow. Without it the standalone server cannot find Chromium for Talkie stills.
const playwrightBrowsersJson = relative(
  appDir,
  join(
    dirname(createRequire(import.meta.url).resolve('playwright-core/package.json')),
    'browsers.json'
  )
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return securityHeaders;
  },
  reactStrictMode: false,
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // playwright-core starts the headless browser for Talkie stills; it must not be bundled.
  serverExternalPackages: ['sharp', 'playwright-core'],
  // The Talkie render page (built by `yarn build:render-page`) is read from disk at run time, so
  // file tracing cannot see it. This copies it into the standalone output at the same path.
  outputFileTracingIncludes: {
    '/*': ['./lib/media/talkie-render-page/dist/**/*', playwrightBrowsersJson],
  },
  experimental: {
    // Build workers are capped so background builds cannot hog the machine.
    cpus: 2,
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
};

export default nextConfig;

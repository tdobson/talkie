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

/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return securityHeaders;
  },
  reactStrictMode: false,
  output: 'standalone',
  serverExternalPackages: ['sharp'],
  experimental: {
    // Build workers are capped so background builds cannot hog the machine.
    cpus: 2,
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
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

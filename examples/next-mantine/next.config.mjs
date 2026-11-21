import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withBundleAnalyzer({
  reactStrictMode: false,
  transpilePackages: ['@talkie/react', '@talkie/player'],
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks'],
  },
});

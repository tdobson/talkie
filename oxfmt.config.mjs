import { defineConfig } from 'oxfmt';
import { oxfmt } from 'oxc-config-mantine';

export default defineConfig({
  ...oxfmt,
  ignorePatterns: [...(oxfmt.ignorePatterns ?? []), 'dist', '.next', 'spike', 'storybook-static'],
});

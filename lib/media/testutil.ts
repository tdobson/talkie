import { fileURLToPath } from 'node:url';

export const fx = (name: string): string =>
  fileURLToPath(new URL(`../../test/fixtures/generated/${name}`, import.meta.url));

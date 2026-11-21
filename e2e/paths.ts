import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const FIXTURES = join(ROOT, 'test/fixtures/generated');
export const STATE_FILE = join(import.meta.dirname, '.state.json');

export interface E2EState {
  dataDir: string;
  baseUrl: string;
  videoId: string;
  version: number;
  reviewUrl: string;
  token: string;
}

import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..');
export const FIXTURES = join(ROOT, 'test/fixtures/generated');
/** The hand-made fixtures, such as talkie-mini.lottie (not generated). */
export const TALKIE_FIXTURES = join(ROOT, 'test/fixtures');
export const STATE_FILE = join(import.meta.dirname, '.state.json');

export interface E2EState {
  dataDir: string;
  baseUrl: string;
  videoId: string;
  version: number;
  reviewUrl: string;
  token: string;
  /** The Talkie fixture film (talkie-mini.lottie), imported next to the MP4. */
  talkie: { videoId: string; reviewUrl: string; token: string };
}

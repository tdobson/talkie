import { frameFor, mimeFor } from '@talkie/format';

// The app uses the Talkie packages from the same repo. This fails if the workspace link or
// the "@talkie/*" aliases (tsconfig.json and vitest.config.ts) break.
describe('Talkie workspace packages', () => {
  it('resolves @talkie/format from source', () => {
    expect(mimeFor('voice/one.webm')).toMatch(/webm/);
    expect(frameFor(0, 30, 0, 90)).toBe(0);
  });
});

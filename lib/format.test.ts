import { formatVideoTime, slugify } from './format';

describe('formatVideoTime', () => {
  it.each([
    [0, '0:00.0'],
    [12.44, '0:12.4'],
    [59.96, '1:00.0'],
    [754.25, '12:34.3'],
    [3725.0, '62:05.0'],
  ])('%s -> %s', (s, out) => expect(formatVideoTime(s)).toBe(out));
});

describe('slugify', () => {
  it('lowercases, strips punctuation and collapses dashes', () => {
    expect(slugify('Mavala Launch Film (v2) — FINAL!')).toBe('mavala-launch-film-v2-final');
  });
  it('falls back to "video" for empty results', () => expect(slugify('!!!')).toBe('video'));
  it('caps at 40 chars without a trailing dash', () => {
    const s = slugify(`${'a'.repeat(39)} bbbb`);
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
  });
});

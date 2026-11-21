import { describe, expect, it } from 'vitest';
import { mediaKindOf } from '@/lib/media-kind';

describe('mediaKindOf', () => {
  it("reads a version with no media kind as 'mp4'", () => {
    expect(mediaKindOf({})).toBe('mp4');
  });
  it('returns the stored kind', () => {
    expect(mediaKindOf({ mediaKind: 'talkie' })).toBe('talkie');
    expect(mediaKindOf({ mediaKind: 'mp4' })).toBe('mp4');
  });
});

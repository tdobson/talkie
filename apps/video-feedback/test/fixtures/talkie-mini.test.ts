import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFilm, validateFilm } from '@talkie/format';
import { describe, expect, it } from 'vitest';

// Task 2.2 contract: the checked-in fixture film, as a folder and as a packed .lottie.
// Regenerate both with `yarn fixtures:talkie` (scripts/make-talkie-fixture.ts).
const dir = join(import.meta.dirname, 'talkie-mini');
const packed = join(import.meta.dirname, 'talkie-mini.lottie');
const text = (p: string) => readFileSync(join(dir, p), 'utf8');
const json = (p: string) => JSON.parse(text(p));

describe('talkie-mini fixture film', () => {
  it('is a valid film in folder form', () => {
    const result = validateFilm(json('talkie.json'));
    expect(result).toMatchObject({ ok: true });
  });

  it('has the shape the review tests rely on', () => {
    const film = json('talkie.json');
    expect(film).toMatchObject({
      duration: 4,
      size: [320, 180],
      audio: [
        { src: 'u/narration.opus', type: 'audio/ogg' },
        { src: 'u/narration.m4a', type: 'audio/mp4' },
      ],
      scenes: [
        { id: 's01', src: 'a/s01.json', start: 0, end: 2 },
        { id: 's02', src: 'a/s02.json', start: 2, end: 4 },
      ],
      chapters: [
        { title: 'Red', start: 0 },
        { title: 'Blue', start: 2 },
      ],
      captions: [{ lang: 'en', label: 'English', src: 'captions/en.vtt' }],
      poster: { png: 'poster.png' },
    });
    for (const id of ['s01', 's02']) {
      expect(json(`a/${id}.json`)).toMatchObject({ fr: 30, ip: 0, op: 60, w: 320, h: 180 });
    }
    // Lottie colours are 0 to 1: scene s01 is solid red and scene s02 solid blue.
    expect(text('a/s01.json')).toContain('"k":[1,0,0,1]');
    expect(text('a/s02.json')).toContain('"k":[0,0,1,1]');
    expect(text('captions/en.vtt')).toBe(
      'WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nRed scene.\n\n00:00:02.000 --> 00:00:04.000\nBlue scene.\n'
    );
    for (const file of ['u/narration.opus', 'u/narration.m4a', 'poster.png', 'manifest.json']) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
  });

  it('opens from the packed .lottie with the same talkie.json and scenes', async () => {
    const { film, source } = await openFilm(new Uint8Array(readFileSync(packed)));
    try {
      expect(source.kind).toBe('packed');
      expect(film).toEqual(json('talkie.json'));
      for (const scene of film.scenes) {
        expect(await source.json(scene.src)).toEqual(json(scene.src));
      }
    } finally {
      source.dispose();
    }
  });

  it('stays small enough to check in', () => {
    expect(readFileSync(packed).byteLength).toBeLessThan(200_000);
  });
});

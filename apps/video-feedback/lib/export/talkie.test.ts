import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { TalkieFilm } from '@talkie/format';
import { parseCaptionCues, talkieInfoFor } from './talkie';

const fixture = (path: string) =>
  readFileSync(
    fileURLToPath(new URL(`../../test/fixtures/talkie-mini/${path}`, import.meta.url)),
    'utf8'
  );
const film = JSON.parse(fixture('talkie.json')) as TalkieFilm;
const cues = parseCaptionCues(fixture('captions/en.vtt'));

describe('parseCaptionCues', () => {
  it('reads the cues of the fixture', () => {
    expect(cues).toEqual([
      { start: 0, end: 2, text: 'Red scene.' },
      { start: 2, end: 4, text: 'Blue scene.' },
    ]);
  });

  it('skips headers and notes, drops tags and joins lines', () => {
    const vtt =
      'WEBVTT\r\n\r\nNOTE a note\r\n\r\nintro\r\n01:00:01.500 --> 01:00:03.000 align:start\r\n<v Ann>Tap <b>the</b> card\r\nto see &amp; go.\r\n\r\nnot a cue\r\n';
    expect(parseCaptionCues(vtt)).toEqual([
      { start: 3601.5, end: 3603, text: 'Tap the card to see & go.' },
    ]);
  });
});

describe('talkieInfoFor', () => {
  it('describes video time 1.0 in the fixture', () => {
    expect(talkieInfoFor(film, 30, 1.0, cues)).toEqual({
      sceneId: 's01',
      sceneIndex: 0,
      sceneSrc: 'a/s01.json',
      sceneTime: 1,
      sceneFrame: 30,
      chapter: 'Red',
      caption: 'Red scene.',
    });
  });

  it('describes video time 3.5 in the second scene', () => {
    expect(talkieInfoFor(film, 30, 3.5, cues)).toEqual({
      sceneId: 's02',
      sceneIndex: 1,
      sceneSrc: 'a/s02.json',
      sceneTime: 1.5,
      sceneFrame: 45,
      chapter: 'Blue',
      caption: 'Blue scene.',
    });
  });

  it('gives the boundary at 2.0 to the later scene', () => {
    expect(talkieInfoFor(film, 30, 2.0, cues)).toMatchObject({
      sceneId: 's02',
      sceneIndex: 1,
      sceneTime: 0,
      sceneFrame: 0,
      chapter: 'Blue',
      caption: 'Blue scene.',
    });
  });

  it('has no caption past the last cue or without cues', () => {
    expect(talkieInfoFor(film, 30, 4.0, cues).caption).toBeNull();
    expect(talkieInfoFor(film, 30, 3.5, cues.slice(0, 1)).caption).toBeNull();
    expect(talkieInfoFor(film, 30, 1.0, []).caption).toBeNull();
  });

  it('has no chapter before the first one', () => {
    const late = { ...film, chapters: [{ title: 'Blue', start: 2 }] };
    expect(talkieInfoFor(late, 30, 1.0, cues).chapter).toBeNull();
  });

  it('rounds the scene time to 3 decimals and the frame to a whole number', () => {
    const info = talkieInfoFor(film, 30, 2.84449, cues);
    expect(info.sceneTime).toBe(0.844);
    expect(info.sceneFrame).toBe(25);
  });

  it('uses the timing of each scene when given, clamped to its last frame', () => {
    const timings = [
      { fr: 30, ip: 0, op: 60 },
      { fr: 24, ip: 10, op: 40 },
    ];
    expect(talkieInfoFor(film, timings, 1.0, cues).sceneFrame).toBe(30);
    expect(talkieInfoFor(film, timings, 2.5, cues).sceneFrame).toBe(22);
    expect(talkieInfoFor(film, timings, 3.9, cues).sceneFrame).toBe(39);
    // A plain number in the list is a frame rate for a scene whose file could not be read.
    expect(talkieInfoFor(film, [30, 25], 3.0, cues).sceneFrame).toBe(25);
  });
});

import { chapterAt, frameFor, sceneAt } from '../src/timeline';
import type { TalkieFilm } from '../src/types';
import valid from './fixtures/valid.json';

const film = valid as unknown as TalkieFilm;

describe('sceneAt', () => {
  it('clamps a negative time to the start of the first scene', () =>
    expect(sceneAt(film, -5)).toEqual({ index: 0, scene: film.scenes[0], localTime: 0 }));

  it('gives a boundary time to the later scene', () =>
    expect(sceneAt(film, 18.4)).toEqual({ index: 1, scene: film.scenes[1], localTime: 0 }));

  it('keeps a time just before a boundary in the earlier scene', () => {
    const pos = sceneAt(film, 18.399);
    expect(pos.index).toBe(0);
    expect(pos.localTime).toBeCloseTo(18.399, 9);
  });

  it('finds a time inside the middle scene', () => {
    const pos = sceneAt(film, 30);
    expect(pos.index).toBe(1);
    expect(pos.localTime).toBeCloseTo(11.6, 9);
  });

  it.each([60, 999])('gives the last scene at its full length for t = %d', (t) =>
    expect(sceneAt(film, t)).toEqual({ index: 2, scene: film.scenes[2], localTime: 19 })
  );
});

describe('frameFor', () => {
  it('clamps to the last frame', () => expect(frameFor(10, 60, 0, 600)).toBe(599));
  it('maps local time to a frame', () => expect(frameFor(1.5, 60, 0, 600)).toBe(90));
  it('keeps fractional frames', () => expect(frameFor(0.0125, 60, 0, 600)).toBeCloseTo(0.75, 9));
  it('clamps to the in point', () => expect(frameFor(-1, 60, 30, 600)).toBe(30));
  it('offsets by the in point', () => expect(frameFor(1, 60, 30, 600)).toBe(90));
});

describe('chapterAt', () => {
  const late: TalkieFilm = {
    ...film,
    chapters: [
      { title: 'a', start: 5 },
      { title: 'b', start: 20 },
    ],
  };
  it('is -1 before the first chapter', () => expect(chapterAt(late, 4.9)).toBe(-1));
  it('starts a chapter on its start time', () => expect(chapterAt(late, 5)).toBe(0));
  it('stays in a chapter between starts', () => expect(chapterAt(late, 12)).toBe(0));
  it('moves to the next chapter on its start', () => expect(chapterAt(late, 20)).toBe(1));
  it('stays in the last chapter to the end', () => expect(chapterAt(late, 60)).toBe(1));
  it('is -1 when there are no chapters', () =>
    expect(chapterAt({ ...film, chapters: [] }, 10)).toBe(-1));
});

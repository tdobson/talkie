import { isSafeRelativePath, validateFilm } from '../src/validate';
import badGap from './fixtures/bad-gap.json';
import badNoAac from './fixtures/bad-no-aac.json';
import badNoAudio from './fixtures/bad-no-audio.json';
import badPath from './fixtures/bad-path.json';
import badPoster from './fixtures/bad-poster.json';
import badSceneShape from './fixtures/bad-scene-shape.json';
import badSize from './fixtures/bad-size.json';
import badVersionType from './fixtures/bad-version-type.json';
import valid from './fixtures/valid.json';

const bad = (patch: object) => validateFilm({ ...structuredClone(valid), ...patch });

it('accepts the spec example', () => {
  const result = validateFilm(valid);
  expect(result.ok).toBe(true);
  expect(result.ok && result.film.scenes).toHaveLength(3);
});

it('rejects a newer major version', () =>
  expect(bad({ talkie: 2 })).toMatchObject({ ok: false, errors: [{ rule: 'version' }] }));

it('requires an AAC track', () =>
  expect(bad({ audio: [{ src: 'u/n.opus', type: 'audio/webm; codecs=opus' }] })).toMatchObject({
    ok: false,
    errors: [{ rule: 'aac-required' }],
  }));

it('rejects a gap between scenes', () => {
  const f = structuredClone(valid);
  f.scenes[1].start = 19;
  expect(validateFilm(f)).toMatchObject({ ok: false, errors: [{ rule: 'contiguous' }] });
});

it('rejects a last scene that does not end at duration', () =>
  expect(bad({ duration: 61 })).toMatchObject({ ok: false, errors: [{ rule: 'duration-match' }] }));

it.each([
  '../x.json',
  '/abs.json',
  'https://evil/x.json',
  'a//b.json',
  'a\\b.json',
  './a.json',
  '',
])('rejects unsafe path %s', (p) => {
  const f = structuredClone(valid);
  f.scenes[0].src = p;
  expect(validateFilm(f)).toMatchObject({ ok: false, errors: [{ rule: 'path' }] });
  expect(isSafeRelativePath(p)).toBe(false);
});

it('rejects duplicate scene ids', () => {
  const f = structuredClone(valid);
  f.scenes[1].id = f.scenes[0].id;
  expect(validateFilm(f)).toMatchObject({ ok: false, errors: [{ rule: 'unique-id' }] });
});

it('rejects unsorted chapters', () =>
  expect(
    bad({
      chapters: [
        { title: 'b', start: 30 },
        { title: 'a', start: 10 },
      ],
    })
  ).toMatchObject({ ok: false, errors: [{ rule: 'chapter-order' }] }));

it('ignores unknown keys', () => expect(bad({ futureThing: 1 }).ok).toBe(true));

it.each([null, [], 'film', 3])('rejects a non-object root %p', (input) =>
  expect(validateFilm(input)).toMatchObject({ ok: false, errors: [{ path: '', rule: 'type' }] })
);

it('reports every problem with its path', () => {
  const result = bad({ title: '', size: [0, 1080], poster: {} });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.errors.map((e) => e.path)).toEqual(['title', 'size', 'poster.png']);
});

it.each([
  ['bad-gap', badGap, 'contiguous'],
  ['bad-no-aac', badNoAac, 'aac-required'],
  ['bad-no-audio', badNoAudio, 'required'],
  ['bad-path', badPath, 'path'],
  ['bad-poster', badPoster, 'required'],
  ['bad-scene-shape', badSceneShape, 'path'],
  ['bad-size', badSize, 'required'],
  ['bad-version-type', badVersionType, 'required'],
])('rejects fixture %s', (_name, film, rule) =>
  expect(validateFilm(film)).toMatchObject({ ok: false, errors: [{ rule }] })
);

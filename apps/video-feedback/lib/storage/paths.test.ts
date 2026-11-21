import { join } from 'node:path';
import { withTmpData } from '@/test/helpers/tmpData';
import {
  assertSafeId,
  commentDir,
  ID_RE,
  inboxDir,
  sessionDir,
  sourcePath,
  versionDir,
  videoDir,
} from './paths';

const SID = '3f2b8c1e-7a4d-4e9b-8c1f-0a1b2c3d4e5f';
const CID = '9d8c7b6a-5e4f-4a3b-9c2d-1e0f9a8b7c6d';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
});
afterEach(() => cleanup());

it('rejects path traversal and odd ids', () => {
  for (const bad of ['../x', 'a/b', '', '..', 'A B', 'x'.repeat(80)]) {
    expect(() => assertSafeId(bad, 'video')).toThrow();
  }
  expect(() => assertSafeId('not-a-uuid', 'session')).toThrow();
});

it('rejects more hostile ids', () => {
  for (const bad of ['-abc', 'ab', 'abc\n', 'abc\0def', 'abc.def', 'abc\\def', '%2e%2e', ' abc']) {
    expect(() => assertSafeId(bad, 'video')).toThrow();
  }
  for (const bad of [`${SID}/..`, `${SID}\n`, SID.toUpperCase(), `../${SID}`, '']) {
    expect(() => assertSafeId(bad, 'session')).toThrow();
    expect(() => assertSafeId(bad, 'comment')).toThrow();
  }
  expect(() => assertSafeId(undefined as unknown as string, 'video')).toThrow();
});

it('accepts good ids', () => {
  expect(() => assertSafeId('mavala-launch-k3f9', 'video')).not.toThrow();
  expect(() => assertSafeId(SID, 'session')).not.toThrow();
  expect(() => assertSafeId(CID, 'comment')).not.toThrow();
  expect(ID_RE.test('abc')).toBe(true);
});

it('builds the storage layout under DATA_DIR', () => {
  expect(inboxDir()).toBe(join(dir, 'inbox'));
  expect(videoDir('film-ab12')).toBe(join(dir, 'videos/film-ab12'));
  expect(versionDir('film-ab12', 2)).toBe(join(dir, 'videos/film-ab12/versions/2'));
  expect(sourcePath('film-ab12', 2)).toBe(join(dir, 'videos/film-ab12/versions/2/source.mp4'));
  expect(sessionDir('film-ab12', SID)).toBe(join(dir, `videos/film-ab12/sessions/${SID}`));
  expect(commentDir({ videoId: 'film-ab12', sessionId: SID, commentId: CID })).toBe(
    join(dir, `videos/film-ab12/sessions/${SID}/comments/${CID}`)
  );
});

it('path builders validate their ids and versions', () => {
  expect(() => videoDir('../etc')).toThrow();
  expect(() => sessionDir('film-ab12', '..')).toThrow();
  expect(() => commentDir({ videoId: 'film-ab12', sessionId: SID, commentId: '../x' })).toThrow();
  for (const bad of [0, -1, 1.5, Number.NaN, '1' as unknown as number]) {
    expect(() => versionDir('film-ab12', bad)).toThrow();
  }
});

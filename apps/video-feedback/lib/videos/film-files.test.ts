import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { acceptsGzip, locateFilmFile, readFilmFile, storedGzipped } from './film-files';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vf-film-files-'));
  await mkdir(join(dir, 'a'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

it('stores scene JSON gzipped, and nothing else', () => {
  expect(storedGzipped('a/s01.json')).toBe(true);
  expect(storedGzipped('talkie.json')).toBe(false);
  for (const path of ['u/narration.m4a', 'captions/en.vtt', 'poster.png', 'poster.svg']) {
    expect(storedGzipped(path), path).toBe(false);
  }
});

it('finds a plain file first, then the gzipped one, and reads either as the original bytes', async () => {
  await writeFile(join(dir, 'a', 'plain.json'), '{"a":1}');
  await writeFile(join(dir, 'a', 'zipped.json.gz'), gzipSync('{"b":2}'));
  expect(await locateFilmFile(dir, 'a/plain.json')).toMatchObject({ gzipped: false, size: 7 });
  expect(await locateFilmFile(dir, 'a/zipped.json')).toMatchObject({
    file: join(dir, 'a', 'zipped.json.gz'),
    gzipped: true,
  });
  expect((await readFilmFile(dir, 'a/plain.json')).toString()).toBe('{"a":1}');
  expect((await readFilmFile(dir, 'a/zipped.json')).toString()).toBe('{"b":2}');
});

it('finds nothing for a missing file, a link, or a gzipped file that should be plain', async () => {
  await writeFile(join(dir, 'real.json'), '{}');
  await symlink(join(dir, 'real.json'), join(dir, 'a', 'link.json'));
  await writeFile(join(dir, 'captions.vtt.gz'), gzipSync('WEBVTT'));
  expect(await locateFilmFile(dir, 'a/missing.json')).toBeNull();
  expect(await locateFilmFile(dir, 'a/link.json')).toBeNull();
  expect(await locateFilmFile(dir, 'captions.vtt')).toBeNull();
  await expect(readFilmFile(dir, 'a/missing.json')).rejects.toMatchObject({ code: 'ENOENT' });
});

it('reads Accept-Encoding', () => {
  expect(acceptsGzip('gzip, deflate, br')).toBe(true);
  expect(acceptsGzip('br;q=1.0, GZIP;q=0.5')).toBe(true);
  expect(acceptsGzip('*')).toBe(true);
  expect(acceptsGzip('gzip;q=0')).toBe(false);
  expect(acceptsGzip('identity')).toBe(false);
  expect(acceptsGzip('')).toBe(false);
  expect(acceptsGzip(null)).toBe(false);
});

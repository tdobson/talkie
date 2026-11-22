import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { gunzipSync } from 'node:zlib';
import { FILM_MAX_ENTRIES } from '@/lib/constants';
import { limits } from '@/lib/limits';
import { fx } from '@/lib/media/testutil';
import { readJson } from '@/lib/storage/json';
import {
  filmDir,
  filmPackedPath,
  inboxDir,
  sourcePath,
  stagingDir,
  versionDir,
  videosDir,
} from '@/lib/storage/paths';
import { getVideo, listVideos } from '@/lib/storage/repo';
import {
  listFiles,
  TALKIE_MINI_DIR,
  TALKIE_MINI_LOTTIE,
  talkieJsonWith,
  talkieMiniFiles,
  zipOf,
} from '@/test/helpers/talkieFixture';
import { withTmpData } from '@/test/helpers/tmpData';
import { importFromInbox, listInbox } from './import';
import { GZIP_SUFFIX, readFilmFile, storedGzipped } from './film-files';
import { copyCapped, FilmRefused } from './import-film';

const PROBE = {
  width: 320,
  height: 180,
  fps: 30,
  frameDuration: 1 / 30,
  duration: 4,
  codec: 'talkie',
  pixFmt: 'vector',
  hasAudio: true,
};
/** The fixture folder without manifest.json, which belongs to the packed form only. */
const FILM_FILES = [
  'a/s01.json',
  'a/s02.json',
  'captions/en.vtt',
  'poster.png',
  'talkie.json',
  'u/narration.m4a',
  'u/narration.opus',
];

/** The same files as stored on disk: the scenes gzipped. */
const STORED_FILES = FILM_FILES.map((p) => (storedGzipped(p) ? p + GZIP_SUFFIX : p)).sort();
/** Bytes the fixture film unpacks to. */
async function unpackedSize(): Promise<number> {
  let total = 0;
  for (const path of FILM_FILES) total += (await stat(join(TALKIE_MINI_DIR, path))).size;
  return total;
}

const savedLimits = { ...limits };
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  await mkdir(inboxDir(), { recursive: true });
});
afterEach(async () => {
  Object.assign(limits, savedLimits);
  await cleanup();
});

const inInbox = (name: string) => join(inboxDir(), name);
const dropPacked = (name = 'mini.lottie') => cp(TALKIE_MINI_LOTTIE, inInbox(name));
const dropFolder = (name = 'mini') => cp(TALKIE_MINI_DIR, inInbox(name), { recursive: true });
const importNew = (filename: string) => importFromInbox({ filename, mode: 'new', title: 'Mini' });

/** A refusal must leave no video, no staging files, and the inbox entry where it was. */
async function expectNothingWritten(filename: string): Promise<void> {
  expect(await listVideos()).toEqual([]);
  expect(existsSync(videosDir())).toBe(false);
  expect(existsSync(stagingDir()) ? await readdir(stagingDir()) : []).toEqual([]);
  expect(existsSync(inInbox(filename))).toBe(true);
}

async function sameFilmAsFixture(dir: string): Promise<void> {
  expect(await listFiles(dir)).toEqual(STORED_FILES);
  for (const path of FILM_FILES) {
    const want = await readFile(join(TALKIE_MINI_DIR, path));
    expect((await readFilmFile(dir, path)).equals(want), path).toBe(true);
  }
}

describe('importing a packed film', () => {
  it('writes film.lottie, unpacks film/, writes probe.json and records the kind', async () => {
    await dropPacked();
    const r = await importNew('mini.lottie');
    if (!r.ok) throw new Error(r.reason);
    expect(r.version).toBe(1);

    const packed = await readFile(filmPackedPath(r.videoId, 1));
    expect(packed.equals(await readFile(TALKIE_MINI_LOTTIE))).toBe(true);
    await sameFilmAsFixture(filmDir(r.videoId, 1));
    expect(await readJson(join(versionDir(r.videoId, 1), 'probe.json'))).toEqual(PROBE);
    expect((await readdir(versionDir(r.videoId, 1))).sort()).toEqual([
      'film',
      'film.lottie',
      'probe.json',
    ]);
    expect((await getVideo(r.videoId))?.versions).toEqual([
      {
        version: 1,
        importedAt: expect.any(String),
        originalFilename: 'mini.lottie',
        mediaKind: 'talkie',
      },
    ]);
    expect(existsSync(inInbox('mini.lottie'))).toBe(false);
    expect(existsSync(stagingDir()) ? await readdir(stagingDir()) : []).toEqual([]);
  });

  it('adds a film as the next version of an mp4 video, leaving the mp4 version alone', async () => {
    await cp(fx('h264.mp4'), inInbox('one.mp4'));
    const first = await importFromInbox({ filename: 'one.mp4', mode: 'new', title: 'Mixed' });
    if (!first.ok) throw new Error(first.reason);
    await dropPacked('two.lottie');
    const second = await importFromInbox({
      filename: 'two.lottie',
      mode: 'version',
      videoId: first.videoId,
    });
    expect(second).toEqual({ ok: true, videoId: first.videoId, version: 2 });
    expect(existsSync(sourcePath(first.videoId, 1))).toBe(true);
    await sameFilmAsFixture(filmDir(first.videoId, 2));
    const video = await getVideo(first.videoId);
    expect(video?.latestVersion).toBe(2);
    expect(video?.versions.map((v) => v.mediaKind)).toEqual([undefined, 'talkie']);
  });
});

describe('importing a film folder', () => {
  it('gives the same result as the packed film, plus a packed film.lottie', async () => {
    await dropFolder();
    const r = await importNew('mini');
    if (!r.ok) throw new Error(r.reason);

    await sameFilmAsFixture(filmDir(r.videoId, 1));
    expect(await readJson(join(versionDir(r.videoId, 1), 'probe.json'))).toEqual(PROBE);
    expect((await getVideo(r.videoId))?.versions[0]).toMatchObject({
      originalFilename: 'mini',
      mediaKind: 'talkie',
    });
    // The packer is deterministic, so packing the folder gives the checked-in packed fixture.
    const packed = await readFile(filmPackedPath(r.videoId, 1));
    expect(packed.equals(await readFile(TALKIE_MINI_LOTTIE))).toBe(true);
    expect(existsSync(inInbox('mini'))).toBe(false);
  });

  it('copies only the files talkie.json lists', async () => {
    await dropFolder();
    await writeFile(inInbox('mini/notes.txt'), 'not part of the film');
    const r = await importNew('mini');
    if (!r.ok) throw new Error(r.reason);
    expect(await listFiles(filmDir(r.videoId, 1))).toEqual(STORED_FILES);
  });

  it('refuses a listed file that is a symlink out of the folder', async () => {
    await dropFolder();
    await writeFile(inInbox('secret.vtt'), 'WEBVTT\n');
    await rm(inInbox('mini/captions/en.vtt'));
    await symlink(inInbox('secret.vtt'), inInbox('mini/captions/en.vtt'));
    expect(await importNew('mini')).toEqual({
      ok: false,
      reason: expect.stringMatching(/captions\/en\.vtt/),
    });
    await expectNothingWritten('mini');
  });

  it('refuses a folder whose talkie.json is bad', async () => {
    await dropFolder();
    await writeFile(inInbox('mini/talkie.json'), await talkieJsonWith({ title: '' }));
    expect(await importNew('mini')).toEqual({
      ok: false,
      reason: 'This film did not pass validation: title: title must be a non-empty string',
    });
    await expectNothingWritten('mini');
  });

  it('refuses a folder with a listed file missing', async () => {
    await dropFolder();
    await rm(inInbox('mini/a/s02.json'));
    expect(await importNew('mini')).toEqual({
      ok: false,
      reason: expect.stringMatching(/a\/s02\.json/),
    });
    await expectNothingWritten('mini');
  });

  it('refuses a folder that is over the size limit', async () => {
    limits.filmUnpackedBytes = 10_000;
    await dropFolder();
    expect(await importNew('mini')).toEqual({
      ok: false,
      reason: expect.stringMatching(/too large/i),
    });
    await expectNothingWritten('mini');
  });
});

describe('refusals of a packed film', () => {
  async function dropZip(files: Record<string, Buffer>, edit?: (zip: Buffer) => Buffer) {
    const zip = await zipOf(files);
    await writeFile(inInbox('bad.lottie'), edit ? edit(zip) : zip);
  }

  it('refuses a bad talkie.json with the validation copy and the first three errors', async () => {
    const files = await talkieMiniFiles();
    await dropZip({
      ...files,
      'talkie.json': await talkieJsonWith({ title: '', duration: -1, size: [0], chapters: 1 }),
    });
    const r = await importNew('bad.lottie');
    expect(r).toEqual({
      ok: false,
      reason:
        'This film did not pass validation: title: title must be a non-empty string; ' +
        'duration: duration must be a positive number of seconds; ' +
        'size: size must be [width, height] in whole pixels',
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses a talkie.json that is not JSON', async () => {
    await dropZip({ ...(await talkieMiniFiles()), 'talkie.json': Buffer.from('{nope') });
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/^This film did not pass validation: /),
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses a film from a later major version', async () => {
    await dropZip({
      ...(await talkieMiniFiles()),
      'talkie.json': await talkieJsonWith({ talkie: 2 }),
    });
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: 'This film needs Talkie version 2, which this tool does not read yet.',
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses an entry path that climbs out with ..', async () => {
    // yazl will not write such a name, so a same-length name is patched in both zip headers.
    await dropZip({ ...(await talkieMiniFiles()), '__/x': Buffer.from('escaped') }, (zip) => {
      const patched = Buffer.from(zip.toString('latin1').replaceAll('__/x', '../x'), 'latin1');
      expect(patched.equals(zip)).toBe(false);
      return patched;
    });
    expect(await importNew('bad.lottie')).toMatchObject({ ok: false });
    await expectNothingWritten('bad.lottie');
    expect(existsSync(join(inboxDir(), '..', 'x'))).toBe(false);
  });

  it('refuses an entry that talkie.json does not list', async () => {
    await dropZip({ ...(await talkieMiniFiles()), 'a/extra.json': Buffer.from('{}') });
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/a\/extra\.json/),
    });
    await expectNothingWritten('bad.lottie');
  });

  it('accepts a film zipped with directory entries, as ordinary zip tools write them', async () => {
    const none = Buffer.alloc(0);
    await dropZip({ 'a/': none, 'u/': none, 'captions/': none, ...(await talkieMiniFiles()) });
    const r = await importNew('bad.lottie');
    if (!r.ok) throw new Error(r.reason);
    await sameFilmAsFixture(filmDir(r.videoId, 1));
  });

  it('counts directory entries toward the entry limit', async () => {
    limits.filmEntries = 8;
    const dirs = Object.fromEntries(['a/', 'u/', 'captions/'].map((d) => [d, Buffer.alloc(0)]));
    await dropZip({ ...dirs, ...(await talkieMiniFiles()) });
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/too many files/),
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses a film that lists one path as both a file and a folder', async () => {
    const { 'poster.png': poster, ...files } = await talkieMiniFiles();
    await dropZip({
      ...files,
      a: poster,
      'talkie.json': await talkieJsonWith({ poster: { png: 'a' } }),
    });
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: 'This film lists a both as a file and as a folder (a/s01.json).',
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses a film with a listed file missing', async () => {
    const { 'a/s02.json': _gone, ...files } = await talkieMiniFiles();
    await dropZip(files);
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/a\/s02\.json/),
    });
    await expectNothingWritten('bad.lottie');
  });

  it(`refuses more than ${FILM_MAX_ENTRIES} entries`, async () => {
    const files = await talkieMiniFiles();
    for (let i = 0; i <= FILM_MAX_ENTRIES; i++) files[`pad/${i}.json`] = Buffer.from('{}');
    await dropZip(files);
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/too many files/i),
    });
    await expectNothingWritten('bad.lottie');
  });

  it('takes a film that is over the stored limit unpacked but fits once its scenes are gzipped', async () => {
    // The real case: a long film of soft shadows is mostly scene JSON, which gzips to a fraction.
    limits.filmStoredBytes = (await unpackedSize()) - 1000;
    await dropPacked('big.lottie');
    const r = await importNew('big.lottie');
    if (!r.ok) throw new Error(r.reason);
    await sameFilmAsFixture(filmDir(r.videoId, 1));
  });

  it('refuses a film that is over the stored limit even with its scenes gzipped', async () => {
    limits.filmStoredBytes = 10_000;
    await dropPacked('bad.lottie');
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/even with its scenes compressed/),
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses a film that unpacks to more than the size limit', async () => {
    limits.filmUnpackedBytes = 10_000;
    await dropPacked('bad.lottie');
    expect(await importNew('bad.lottie')).toEqual({
      ok: false,
      reason: expect.stringMatching(/too large/i),
    });
    await expectNothingWritten('bad.lottie');
  });

  it('refuses a file that is not a zip', async () => {
    await writeFile(inInbox('bad.lottie'), 'this is not a zip');
    expect(await importNew('bad.lottie')).toMatchObject({ ok: false });
    await expectNothingWritten('bad.lottie');
  });

  it('does not leave a new version behind on an existing video', async () => {
    await dropPacked('one.lottie');
    const first = await importNew('one.lottie');
    if (!first.ok) throw new Error(first.reason);
    await dropZip({ ...(await talkieMiniFiles()), 'a/extra.json': Buffer.from('{}') });
    const r = await importFromInbox({
      filename: 'bad.lottie',
      mode: 'version',
      videoId: first.videoId,
    });
    expect(r.ok).toBe(false);
    expect((await getVideo(first.videoId))?.latestVersion).toBe(1);
    expect(await readdir(join(versionDir(first.videoId, 1), '..'))).toEqual(['1']);
  });
});

describe('copyCapped', () => {
  it('stops reading as soon as the budget is spent, not after the whole stream', async () => {
    let produced = 0;
    // An endless source: only a check made while streaming can ever finish.
    const endless = new Readable({
      read() {
        produced += 1024;
        this.push(Buffer.alloc(1024));
      },
    });
    const budgets = { unpacked: { left: 10_000 }, stored: { left: Infinity } };
    const dst = inInbox('out.bin');
    await expect(copyCapped(endless, dst, budgets)).rejects.toBeInstanceOf(FilmRefused);
    expect(produced).toBeLessThan(1024 * 1024);
    expect(endless.destroyed).toBe(true);
  });

  it('takes what it copies off both budgets', async () => {
    const budgets = { unpacked: { left: 100 }, stored: { left: 100 } };
    const dst = inInbox('out.bin');
    await copyCapped(Readable.from([Buffer.alloc(60)]), dst, budgets);
    expect(budgets.unpacked.left).toBe(40);
    expect(budgets.stored.left).toBe(40);
    expect((await readFile(dst)).byteLength).toBe(60);
  });

  it('gzips when asked: the unpacked budget counts the bytes in, the stored one the bytes out', async () => {
    const budgets = { unpacked: { left: 1_000_000 }, stored: { left: 1_000_000 } };
    const dst = inInbox('out.json.gz');
    const data = Buffer.from(JSON.stringify({ layers: Array(5000).fill({ ty: 4 }) }));
    await copyCapped(Readable.from([data]), dst, budgets, true);
    const written = await readFile(dst);
    expect(gunzipSync(written).equals(data)).toBe(true);
    expect(budgets.unpacked.left).toBe(1_000_000 - data.byteLength);
    expect(budgets.stored.left).toBe(1_000_000 - written.byteLength);
    expect(written.byteLength).toBeLessThan(data.byteLength / 10);
  });

  it('refuses once the gzipped bytes pass the stored budget', async () => {
    const budgets = { unpacked: { left: Infinity }, stored: { left: 50 } };
    const noise = Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 7919) % 251));
    await expect(
      copyCapped(Readable.from([noise]), inInbox('out.gz'), budgets, true)
    ).rejects.toThrow(/even with its scenes compressed/);
  });
});

describe('listInbox with films', () => {
  it('lists .lottie files and folders that contain talkie.json', async () => {
    await writeFile(inInbox('clip.mp4'), 'aa');
    await dropPacked('film.lottie');
    await dropFolder('folder-film');
    await mkdir(inInbox('empty-folder'));
    await mkdir(inInbox('.hidden-film'));
    await writeFile(inInbox('.hidden-film/talkie.json'), '{}');
    await utimes(inInbox('clip.mp4'), 1000, 1000);
    await utimes(inInbox('film.lottie'), 2000, 2000);
    await utimes(inInbox('folder-film'), 3000, 3000);

    const packedSize = (await readFile(TALKIE_MINI_LOTTIE)).byteLength;
    let folderSize = 0;
    for (const path of await listFiles(TALKIE_MINI_DIR)) {
      folderSize += (await readFile(join(TALKIE_MINI_DIR, path))).byteLength;
    }
    expect(await listInbox()).toEqual([
      {
        filename: 'folder-film',
        sizeBytes: folderSize,
        modifiedAt: new Date(3000_000).toISOString(),
      },
      {
        filename: 'film.lottie',
        sizeBytes: packedSize,
        modifiedAt: new Date(2000_000).toISOString(),
      },
      { filename: 'clip.mp4', sizeBytes: 2, modifiedAt: new Date(1000_000).toISOString() },
    ]);
  });
});

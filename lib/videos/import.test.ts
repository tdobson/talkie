import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { probe } from '@/lib/media/probe';
import { fx } from '@/lib/media/testutil';
import { readJson } from '@/lib/storage/json';
import { inboxDir, sourcePath, versionDir, videosDir } from '@/lib/storage/paths';
import { getVideo, listVideos } from '@/lib/storage/repo';
import type { ProbeInfo } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { importFromInbox, listInbox } from './import';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  await mkdir(inboxDir(), { recursive: true });
});
afterEach(() => cleanup());

const drop = (fixture: string, name: string) => copyFile(fx(fixture), join(inboxDir(), name));

describe('listInbox', () => {
  it('returns an empty list when the inbox folder does not exist', async () => {
    await cleanup();
    ({ cleanup } = await withTmpData());
    expect(await listInbox()).toEqual([]);
  });

  it('lists only video files, newest first', async () => {
    await writeFile(join(inboxDir(), 'old.mp4'), 'aa');
    await writeFile(join(inboxDir(), 'new.MOV'), 'bbbb');
    await writeFile(join(inboxDir(), 'mid.m4v'), 'c');
    await writeFile(join(inboxDir(), 'notes.txt'), 'x');
    await writeFile(join(inboxDir(), '.hidden.mp4'), 'x');
    await mkdir(join(inboxDir(), 'folder.mp4'));
    await utimes(join(inboxDir(), 'old.mp4'), 1000, 1000);
    await utimes(join(inboxDir(), 'mid.m4v'), 2000, 2000);
    await utimes(join(inboxDir(), 'new.MOV'), 3000, 3000);
    expect(await listInbox()).toEqual([
      { filename: 'new.MOV', sizeBytes: 4, modifiedAt: new Date(3000_000).toISOString() },
      { filename: 'mid.m4v', sizeBytes: 1, modifiedAt: new Date(2000_000).toISOString() },
      { filename: 'old.mp4', sizeBytes: 2, modifiedAt: new Date(1000_000).toISOString() },
    ]);
  });
});

describe('importFromInbox', () => {
  it('imports a new video and removes it from the inbox', async () => {
    await drop('h264-nofaststart.mp4', 'film.mp4');
    const r = await importFromInbox({ filename: 'film.mp4', mode: 'new', title: 'Launch film' });
    expect(r).toEqual({
      ok: true,
      videoId: expect.stringMatching(/^launch-film-[a-z0-9]{4}$/),
      version: 1,
    });
    expect(existsSync(join(inboxDir(), 'film.mp4'))).toBe(false);
    expect(existsSync(sourcePath(r.ok ? r.videoId : '', 1))).toBe(true);
  });

  it('writes probe.json, records the version and leaves no tmp files', async () => {
    await drop('h264-nofaststart.mp4', 'film.mp4');
    const r = await importFromInbox({ filename: 'film.mp4', mode: 'new', title: ' Launch film ' });
    if (!r.ok) throw new Error(r.reason);
    const video = await getVideo(r.videoId);
    expect(video).toMatchObject({ title: 'Launch film', latestVersion: 1 });
    expect(video?.versions).toEqual([
      { version: 1, importedAt: expect.any(String), originalFilename: 'film.mp4' },
    ]);
    const saved = await readJson<ProbeInfo>(join(versionDir(r.videoId, 1), 'probe.json'));
    expect(saved).toEqual(await probe(sourcePath(r.videoId, 1)));
    expect(saved).toMatchObject({ codec: 'h264', width: 640, height: 360, fps: 25 });
    expect((await readdir(versionDir(r.videoId, 1))).sort()).toEqual(['probe.json', 'source.mp4']);
  });

  it('adds version 2 to an existing video', async () => {
    await drop('h264-nofaststart.mp4', 'film.mp4');
    const first = await importFromInbox({ filename: 'film.mp4', mode: 'new', title: 'Launch' });
    if (!first.ok) throw new Error(first.reason);
    await drop('h264.mp4', 'film-v2.mp4');
    const second = await importFromInbox({
      filename: 'film-v2.mp4',
      mode: 'version',
      videoId: first.videoId,
    });
    expect(second).toEqual({ ok: true, videoId: first.videoId, version: 2 });
    const video = await getVideo(first.videoId);
    expect(video?.latestVersion).toBe(2);
    expect(video?.versions.map((v) => [v.version, v.originalFilename])).toEqual([
      [1, 'film.mp4'],
      [2, 'film-v2.mp4'],
    ]);
    expect(existsSync(sourcePath(first.videoId, 1))).toBe(true);
    expect(existsSync(sourcePath(first.videoId, 2))).toBe(true);
    expect(existsSync(join(inboxDir(), 'film-v2.mp4'))).toBe(false);
  });

  it('gives two versions imported at the same time different numbers', async () => {
    await drop('h264.mp4', 'a.mp4');
    const first = await importFromInbox({ filename: 'a.mp4', mode: 'new', title: 'Race' });
    if (!first.ok) throw new Error(first.reason);
    await drop('h264.mp4', 'b.mp4');
    await drop('h264.mp4', 'c.mp4');
    const results = await Promise.all(
      ['b.mp4', 'c.mp4'].map((filename) =>
        importFromInbox({ filename, mode: 'version', videoId: first.videoId })
      )
    );
    expect(results.map((r) => (r.ok ? r.version : r.reason)).sort()).toEqual([2, 3]);
    const video = await getVideo(first.videoId);
    expect(video?.latestVersion).toBe(3);
    expect(video?.versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it('rejects a non-H.264 file and leaves it in the inbox', async () => {
    await drop('mpeg4.mp4', 'bad.mp4');
    const r = await importFromInbox({ filename: 'bad.mp4', mode: 'new', title: 'x' });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/H\.264/) });
    expect(existsSync(join(inboxDir(), 'bad.mp4'))).toBe(true);
    expect(await listVideos()).toEqual([]);
    expect(existsSync(videosDir())).toBe(false);
  });

  it('rejects a file that is not a video at all and leaves it in the inbox', async () => {
    await writeFile(join(inboxDir(), 'junk.mp4'), 'this is not a video');
    const r = await importFromInbox({ filename: 'junk.mp4', mode: 'new', title: 'x' });
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/could not be read/i) });
    expect(existsSync(join(inboxDir(), 'junk.mp4'))).toBe(true);
    expect(await listVideos()).toEqual([]);
  });

  it('rejects traversal in filenames', async () =>
    expect(
      await importFromInbox({ filename: '../etc/passwd', mode: 'new', title: 'x' })
    ).toMatchObject({ ok: false }));

  it('rejects other unsafe or unsupported filenames', async () => {
    for (const filename of ['a/b.mp4', '..', 'a..b.mp4', 'a\\b.mp4', '', '.mp4', 'notes.txt']) {
      expect(await importFromInbox({ filename, mode: 'new', title: 'x' })).toMatchObject({
        ok: false,
      });
    }
  });

  it('reports a file that is not in the inbox', async () => {
    expect(await importFromInbox({ filename: 'gone.mp4', mode: 'new', title: 'x' })).toEqual({
      ok: false,
      reason: expect.stringMatching(/not in the inbox/),
    });
  });

  it('needs a title for a new video', async () => {
    await drop('h264.mp4', 'film.mp4');
    expect(await importFromInbox({ filename: 'film.mp4', mode: 'new', title: '  ' })).toEqual({
      ok: false,
      reason: expect.stringMatching(/title/i),
    });
    expect(existsSync(join(inboxDir(), 'film.mp4'))).toBe(true);
  });

  it('rejects a new version of an unknown or invalid video', async () => {
    await drop('h264.mp4', 'film.mp4');
    for (const videoId of ['no-such-video', '../x', '']) {
      expect(await importFromInbox({ filename: 'film.mp4', mode: 'version', videoId })).toEqual({
        ok: false,
        reason: expect.stringMatching(/not found/i),
      });
    }
    expect(existsSync(join(inboxDir(), 'film.mp4'))).toBe(true);
  });

  it('rejects a malformed request', async () => {
    for (const bad of [null, 'x', {}, { filename: 'a.mp4', mode: 'other' }, { filename: 1 }]) {
      expect(await importFromInbox(bad as never)).toMatchObject({ ok: false });
    }
  });
});

import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resetConfigForTests } from '@/lib/config';
import { fx } from '@/lib/media/testutil';
import { filmDir, filmPackedPath, inboxDir, sourcePath } from '@/lib/storage/paths';
import { listVideos } from '@/lib/storage/repo';
import { TALKIE_MINI_DIR, TALKIE_MINI_LOTTIE } from '@/test/helpers/talkieFixture';
import { withTmpData } from '@/test/helpers/tmpData';
import { runImport } from './import';

let cleanup: () => Promise<void>;
let savedBase: string | undefined;
beforeEach(async () => {
  savedBase = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = 'https://fb.example.com';
  ({ cleanup } = await withTmpData());
});
afterEach(async () => {
  if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = savedBase;
  resetConfigForTests();
  await cleanup();
});

async function run(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runImport(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

it('imports a file as a new video and prints the review URL', async () => {
  const r = await run([fx('h264.mp4'), '--title', 'Launch film']);
  expect(r.err).toBe('');
  expect(r.code).toBe(0);
  const [video] = await listVideos();
  expect(video.title).toBe('Launch film');
  expect(r.out).toContain(`https://fb.example.com/r/${video.token}`);
  expect(existsSync(sourcePath(video.videoId, 1))).toBe(true);
  expect(existsSync(fx('h264.mp4'))).toBe(true);
  expect(await readdir(inboxDir())).toEqual([]);
});

it('imports a new version with --video', async () => {
  await run([fx('h264.mp4'), '--title=Launch film']);
  const [video] = await listVideos();
  const r = await run(['--video', video.videoId, fx('h264-nofaststart.mp4')]);
  expect(r.code).toBe(0);
  expect(r.out).toContain('version 2');
  expect(r.out).toContain(`https://fb.example.com/r/${video.token}`);
  expect(existsSync(sourcePath(video.videoId, 2))).toBe(true);
});

it('fails with the reason and cleans its copy out of the inbox', async () => {
  const r = await run([fx('mpeg4.mp4'), '--title', 'x']);
  expect(r.code).toBe(1);
  expect(r.err).toMatch(/H\.264/);
  expect(await readdir(inboxDir())).toEqual([]);
  expect(await listVideos()).toEqual([]);
});

it('prints usage for bad arguments', async () => {
  for (const argv of [
    [],
    [fx('h264.mp4')],
    [fx('h264.mp4'), '--title', 'a', '--video', 'b'],
    ['--title', 'a'],
    [fx('h264.mp4'), '--nope'],
  ]) {
    const r = await run(argv);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Usage: yarn import/);
  }
});

it('fails for a file that does not exist', async () => {
  const r = await run(['/no/such/file.mp4', '--title', 'x']);
  expect(r.code).toBe(1);
  expect(r.err).toMatch(/not found/i);
});

describe('Talkie films', () => {
  it('imports a film folder with --film and prints the review URL', async () => {
    const r = await run(['--film', TALKIE_MINI_DIR, '--title', 'Mini']);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const [video] = await listVideos();
    expect(video.versions[0]).toMatchObject({
      mediaKind: 'talkie',
      originalFilename: 'talkie-mini',
    });
    expect(r.out).toContain(`Imported talkie-mini as ${video.videoId}, version 1.`);
    expect(r.out).toContain(`https://fb.example.com/r/${video.token}`);
    expect(existsSync(join(filmDir(video.videoId, 1), 'talkie.json'))).toBe(true);
    expect(existsSync(filmPackedPath(video.videoId, 1))).toBe(true);
    // The folder given is copied, never moved.
    expect(existsSync(join(TALKIE_MINI_DIR, 'talkie.json'))).toBe(true);
    expect(await readdir(inboxDir())).toEqual([]);
  });

  it('takes a trailing slash on the folder', async () => {
    const r = await run(['--film', `${TALKIE_MINI_DIR}/`, '--title', 'Mini']);
    expect(r.code).toBe(0);
    expect((await listVideos())[0].versions[0].originalFilename).toBe('talkie-mini');
  });

  it('imports a packed film, with --film or as a plain file', async () => {
    const first = await run(['--film', TALKIE_MINI_LOTTIE, '--title', 'Mini']);
    expect(first.code).toBe(0);
    const [video] = await listVideos();
    const second = await run([TALKIE_MINI_LOTTIE, '--video', video.videoId]);
    expect(second.code).toBe(0);
    expect(second.out).toContain('version 2');
    expect(existsSync(filmPackedPath(video.videoId, 2))).toBe(true);
    expect(existsSync(TALKIE_MINI_LOTTIE)).toBe(true);
  });

  it('fails for a folder that is not a film and cleans its copy out of the inbox', async () => {
    const r = await run(['--film', join(TALKIE_MINI_DIR, 'a'), '--title', 'x']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/talkie\.json/);
    expect(await readdir(inboxDir())).toEqual([]);
    expect(await listVideos()).toEqual([]);
  });

  it('prints usage for --film with a file as well, or with no value', async () => {
    for (const argv of [
      [fx('h264.mp4'), '--film', TALKIE_MINI_DIR, '--title', 'x'],
      ['--title', 'x', '--film'],
      ['--film', TALKIE_MINI_DIR],
    ]) {
      const r = await run(argv);
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/yarn import --film <folder or \.lottie>/);
    }
  });

  it('fails for a film folder that does not exist', async () => {
    const r = await run(['--film', '/no/such/film', '--title', 'x']);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/not found/i);
  });
});

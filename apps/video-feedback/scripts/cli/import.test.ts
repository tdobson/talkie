import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { resetConfigForTests } from '@/lib/config';
import { fx } from '@/lib/media/testutil';
import { inboxDir, sourcePath } from '@/lib/storage/paths';
import { listVideos } from '@/lib/storage/repo';
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

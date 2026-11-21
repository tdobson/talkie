import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { GET as getVideos } from '@/app/api/admin/videos/route';
import { resetConfigForTests } from '@/lib/config';
import { fx } from '@/lib/media/testutil';
import { inboxDir } from '@/lib/storage/paths';
import type { AdminVideoSummary, ImportResult, InboxFile } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { GET, POST } from './route';

const ENV_KEYS = ['ADMIN_AUTH', 'CF_ACCESS_TEAM_DOMAIN', 'CF_ACCESS_AUD', 'PUBLIC_BASE_URL'];
let saved: Record<string, string | undefined>;
let cleanup: () => Promise<void>;

function setAuth(mode: 'cloudflare' | 'off') {
  process.env.ADMIN_AUTH = mode;
  process.env.CF_ACCESS_TEAM_DOMAIN = 'team.cloudflareaccess.com';
  process.env.CF_ACCESS_AUD = 'aud';
  resetConfigForTests();
}

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  ({ cleanup } = await withTmpData());
  await mkdir(inboxDir(), { recursive: true });
});
afterEach(async () => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigForTests();
  await cleanup();
});

const post = (body: unknown) =>
  POST(
    new Request('http://x/api/admin/inbox', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    {}
  );

it('inbox route requires admin', async () => {
  setAuth('cloudflare');
  await copyFile(fx('h264.mp4'), join(inboxDir(), 'film.mp4'));
  expect((await GET(new Request('http://x/api/admin/inbox'), {})).status).toBe(401);
  expect((await post({ filename: 'film.mp4', mode: 'new', title: 'x' })).status).toBe(401);
  expect(existsSync(join(inboxDir(), 'film.mp4'))).toBe(true);
});

it('videos route requires admin', async () => {
  setAuth('cloudflare');
  expect((await getVideos(new Request('http://x/api/admin/videos'), {})).status).toBe(401);
});

it('lists the inbox, imports a file, and lists the video with its review URL', async () => {
  setAuth('off');
  process.env.PUBLIC_BASE_URL = 'https://fb.example.com/';
  resetConfigForTests();
  await copyFile(fx('h264.mp4'), join(inboxDir(), 'film.mp4'));

  const listed = await GET(new Request('http://x/api/admin/inbox'), {});
  expect(listed.status).toBe(200);
  expect(listed.headers.get('cache-control')).toBe('no-store');
  expect((await listed.json()) as InboxFile[]).toMatchObject([{ filename: 'film.mp4' }]);

  const imported = await post({ filename: 'film.mp4', mode: 'new', title: 'Launch film' });
  expect(imported.status).toBe(200);
  const result = (await imported.json()) as ImportResult;
  expect(result).toMatchObject({ ok: true, version: 1 });

  const videos = await getVideos(new Request('http://x/api/admin/videos'), {});
  expect(videos.status).toBe(200);
  const summaries = (await videos.json()) as AdminVideoSummary[];
  expect(summaries).toMatchObject([{ title: 'Launch film', latestVersion: 1 }]);
  expect(summaries[0].reviewUrl).toMatch(/^https:\/\/fb\.example\.com\/r\/[\w-]{43}$/);
});

it('answers 400 with the reason when the import is refused', async () => {
  setAuth('off');
  await copyFile(fx('mpeg4.mp4'), join(inboxDir(), 'bad.mp4'));
  const res = await post({ filename: 'bad.mp4', mode: 'new', title: 'x' });
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, reason: expect.stringMatching(/H\.264/) });
});

it('answers 400 for a body that is not JSON', async () => {
  setAuth('off');
  const res = await post('{not json');
  expect(res.status).toBe(400);
  expect(await res.json()).toMatchObject({ ok: false });
});

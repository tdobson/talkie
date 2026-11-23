import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET as GET_JSON } from '@/app/api/admin/videos/[videoId]/export.json/route';
import { GET as GET_MEDIA } from '@/app/api/admin/videos/[videoId]/media/[commentId]/[name]/route';
import { resetConfigForTests } from '@/lib/config';
import { getSession, saveSession } from '@/lib/storage/repo';
import { SEED, seedExport, seedRef, setSeedStatus, VIDEO_ID } from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { emptyState, poll, WatchError } from './watch-feedback.mjs';

// The watcher runs against the real admin routes: its fetch is routed straight to them.

let cleanup: () => Promise<void>;
let images: string;
const requests: string[] = [];

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  images = await mkdtemp(join(tmpdir(), 'watch-images-'));
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  await seedExport();
  requests.length = 0;
});

afterEach(async () => {
  delete process.env.ADMIN_AUTH;
  resetConfigForTests();
  await cleanup();
  await rm(images, { recursive: true, force: true });
});

const fetchFn = async (url: string, init: { headers: Record<string, string> }) => {
  requests.push(url);
  const req = new Request(url, { headers: init.headers });
  const path = new URL(url).pathname.split('/').map(decodeURIComponent);
  // ['', 'api', 'admin', 'videos', <videoId>, 'export.json' | 'media', ...]
  const videoId = path[4];
  if (path[5] === 'export.json') return GET_JSON(req, { params: Promise.resolve({ videoId }) });
  return GET_MEDIA(req, {
    params: Promise.resolve({ videoId, commentId: path[6], name: path[7] }),
  });
};

type Event = { type: string; commentId?: string; sessionId?: string; state?: string };

async function run(state = emptyState(), imagesDir: string | null = null, videoId = VIDEO_ID) {
  const events: Event[] = [];
  const next = await poll({
    base: 'http://vf.test/',
    videoId,
    version: 'latest',
    headers: {},
    state,
    imagesDir,
    emit: (e: Event) => events.push(e),
    fetchFn,
  });
  return { events, state: next };
}

const comments = (events: Event[]) =>
  events.filter((e) => e.type === 'comment').map((e) => `${e.commentId}:${e.state}`);

it('prints each finished comment once, in order, and only what is new after that', async () => {
  const dev = seedRef(SEED.dev, SEED.devScrolled);
  await setSeedStatus(dev, { state: 'processing' });

  const first = await run();
  expect(comments(first.events)).toEqual([
    `${SEED.sarahMoment}:done`,
    `${SEED.sarahEmpty}:empty`,
    `${SEED.sarahGeneral}:done`,
    `${SEED.devMoment}:done`,
    `${SEED.devFailed}:failed`,
  ]);

  // Nothing changed: a 304, nothing printed.
  const same = await run(first.state);
  expect(same.events).toEqual([]);

  // The comment still processing finishes: it, and only it, is printed.
  await setSeedStatus(dev, { state: 'done', updatedAt: '2026-11-20T12:00:00.000Z' });
  const later = await run(same.state);
  expect(comments(later.events)).toEqual([`${SEED.devScrolled}:done`]);

  // From the start again: the same lines in the same order, set by the server alone.
  const again = await run();
  expect(comments(again.events)).toEqual([
    ...comments(first.events).slice(0, 4),
    `${SEED.devScrolled}:done`,
    ...comments(first.events).slice(4),
  ]);
  expect((await run()).events).toEqual(again.events);
});

it('says a session is done only once all its comments are printed', async () => {
  const dev = seedRef(SEED.dev, SEED.devScrolled);
  await setSeedStatus(dev, { state: 'processing' });
  const session = await getSession(VIDEO_ID, SEED.dev);
  if (session === null) throw new Error('the seed has no Dev session');
  await saveSession({ ...session, doneAt: '2026-11-20T11:30:00.000Z' });

  const first = await run();
  expect(first.events.filter((e) => e.type === 'session-done')).toEqual([]);

  await setSeedStatus(dev, { state: 'done', updatedAt: '2026-11-20T12:00:00.000Z' });
  const later = await run(first.state);
  expect(later.events.map((e) => e.type)).toEqual(['comment', 'session-done']);
  expect(later.events[1]).toEqual({
    type: 'session-done',
    sessionId: SEED.dev,
    reviewerName: 'Dev',
    doneAt: '2026-11-20T11:30:00.000Z',
  });
  expect((await run(later.state)).events).toEqual([]);
});

it('saves the stills of a comment before printing it', async () => {
  const { events } = await run(emptyState(), images);
  const dev = events.find((e) => e.commentId === SEED.devMoment) as Event & {
    local: Record<string, string>;
  };
  const zoom = `media/${SEED.devMoment}/moment-03-zoom.jpg`;
  expect(Object.keys(dev.local)).toContain(zoom);
  expect(dev.local[zoom]).toBe(join(images, SEED.devMoment, 'moment-03-zoom.jpg'));
  expect(await readFile(dev.local[zoom], 'utf8')).toBe('jpg');
  expect(requests.some((u) => u.endsWith(`/media/${SEED.devMoment}/overview.jpg`))).toBe(true);
});

it('stops on refused credentials and on an unknown video', async () => {
  process.env.ADMIN_AUTH = 'cloudflare';
  resetConfigForTests();
  await expect(run()).rejects.toMatchObject({ code: 2 });
  process.env.ADMIN_AUTH = 'off';
  resetConfigForTests();
  await expect(run(emptyState(), null, 'no-such-video')).rejects.toBeInstanceOf(WatchError);
  await expect(run(emptyState(), null, 'no-such-video')).rejects.toMatchObject({ code: 3 });
});

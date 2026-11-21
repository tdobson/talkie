import { resetConfigForTests } from '@/lib/config';
import { getQueue } from '@/lib/pipeline/queue';
import { readStatus, updateStatus } from '@/lib/pipeline/status';
import { steps } from '@/lib/pipeline/steps';
import { seedComment } from '@/lib/pipeline/testutil';
import { withTmpData } from '@/test/helpers/tmpData';
import { POST } from './route';

const original = { ...steps };
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  process.env.ADMIN_AUTH = 'off';
  process.env.TRANSCRIBER = 'fake';
  resetConfigForTests();
});

afterEach(async () => {
  await getQueue().idle();
  Object.assign(steps, original);
  delete process.env.ADMIN_AUTH;
  delete process.env.TRANSCRIBER;
  resetConfigForTests();
  await cleanup();
});

const call = (videoId: string, body?: unknown) =>
  POST(
    new Request(`http://localhost/api/admin/videos/${videoId}/reprocess`, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ videoId }) }
  );

it('re-queues a failed comment and the queue works through it', async () => {
  const ran: string[] = [];
  for (const name of ['transcribe', 'moments', 'stills', 'clip'] as const) {
    steps[name] = async () => {
      ran.push(name);
    };
  }
  const { ref, video } = await seedComment();
  await updateStatus(ref, {
    state: 'failed',
    error: 'Groq transcription failed (503)',
    attempts: 1,
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'failed',
      moments: 'done',
      stills: 'done',
    },
  });

  const res = await call(video.videoId, {});
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, queued: 1, commentIds: [ref.commentId] });

  await getQueue().idle();
  expect(ran).toEqual(['transcribe', 'moments', 'stills', 'clip']);
  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    error: null,
    attempts: 2,
    steps: { transcribe: 'done', moments: 'done', stills: 'done', clip: 'done' },
  });
});

it('accepts an empty body', async () => {
  const { video } = await seedComment({ state: 'done' });
  const res = await call(video.videoId);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, queued: 0, commentIds: [] });
});

it('404s for an unknown or malformed video id', async () => {
  expect((await call('no-such-video', {})).status).toBe(404);
  expect((await call('..', {})).status).toBe(404);
});

it.each([
  [{ fromStep: 'everything' }],
  [{ version: 0 }],
  [{ version: '1' }],
  [{ commentId: '../../etc' }],
  [[]],
])('400s for a bad body %j', async (body) => {
  const { video } = await seedComment();
  expect((await call(video.videoId, body)).status).toBe(400);
});

it('refuses a caller who is not an admin', async () => {
  const { video } = await seedComment();
  process.env.ADMIN_AUTH = 'cloudflare';
  resetConfigForTests();
  expect((await call(video.videoId, {})).status).toBe(401);
});

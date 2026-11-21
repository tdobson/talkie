import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_CHUNK_BYTES, MAX_CHUNK_REQUESTS_PER_MIN } from '@/lib/constants';
import { setCommentCompleteHandler } from '@/lib/pipeline/enqueue';
import { resetRateLimits } from '@/lib/review/ratelimit';
import { MAX_EVENTS_BYTES } from '@/lib/review/service';
import { commentDir } from '@/lib/storage/paths';
import { createVideo, readCommentMeta, saveVideo } from '@/lib/storage/repo';
import type { CommentRef, VideoRecord } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { PUT as putChunk } from './[sid]/comments/[cid]/chunks/[seq]/route';
import { POST as postComplete } from './[sid]/comments/[cid]/complete/route';
import { POST as postDone } from './[sid]/done/route';
import { GET as getSession } from './[sid]/route';
import { POST as postSession } from './route';

// The whole upload protocol, driven through the route handlers the way a browser would.

const cid = '11111111-1111-4111-8111-111111111111';
const base = 'http://localhost/api/r/t';
const player = {
  containerWidth: 1440,
  containerHeight: 810,
  videoWidth: 1920,
  videoHeight: 1080,
  contentRect: { x: 0, y: 0, width: 1440, height: 810 },
  fullscreen: false,
  devicePixelRatio: 2,
};
const meta = {
  kind: 'moment',
  pausedAtVideoTime: 3.5,
  startedAt: '2026-11-21T10:00:00.000Z',
  audioMime: 'audio/webm;codecs=opus',
  player,
};
const complete = { totalChunks: 2, endedAt: '2026-11-21T10:00:04.000Z', durationMs: 4000, player };

let cleanup: () => Promise<void>;
let video: VideoRecord;
let token: string;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  resetRateLimits();
  setCommentCompleteHandler(null);
  const v = await createVideo('Launch film');
  video = {
    ...v,
    latestVersion: 1,
    versions: [{ version: 1, importedAt: 'now', originalFilename: 'a.mp4' }],
  };
  await saveVideo(video);
  token = video.token;
});
afterEach(async () => {
  setCommentCompleteHandler(null);
  await cleanup();
});

const params = <T>(p: T) => ({ params: Promise.resolve(p) });

function jsonReq(body: unknown): Request {
  return new Request(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function start(name = 'Sarah'): Promise<string> {
  const res = await postSession(
    jsonReq({ reviewerName: name, userAgent: 'ua' }),
    params({ token })
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { sessionId: string }).sessionId;
}

function chunk(
  sid: string,
  seq: string,
  fields: { audio?: string; events?: string; meta?: string }
): Promise<Response> {
  const form = new FormData();
  if (fields.audio !== undefined) form.set('audio', new Blob([fields.audio]), 'chunk.webm');
  if (fields.events !== undefined) form.set('events', fields.events);
  if (fields.meta !== undefined) form.set('meta', fields.meta);
  const req = new Request(base, { method: 'PUT', body: form });
  return putChunk(req, params({ token, sid, cid, seq }));
}

it('runs a comment from session start to queued', async () => {
  const sid = await start(' Sarah ');
  const ref: CommentRef = { videoId: video.videoId, sessionId: sid, commentId: cid };
  const notified: CommentRef[] = [];
  setCommentCompleteHandler((r) => notified.push(r));

  const session = await getSession(new Request(base), params({ token, sid }));
  expect(await session.json()).toEqual({
    sessionId: sid,
    version: 1,
    reviewerName: 'Sarah',
    done: false,
  });
  expect(session.headers.get('Cache-Control')).toBe('no-store');

  const ev = { t: 5, type: 'click', x: 0.1, y: 0.2, inside: true, vt: 3.5, button: 0 };
  const first = await chunk(sid, '0', {
    audio: 'aaa',
    events: JSON.stringify([ev]),
    meta: JSON.stringify(meta),
  });
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ received: 0 });

  const early = await postComplete(jsonReq(complete), params({ token, sid, cid }));
  expect(early.status).toBe(409);
  expect(await early.json()).toEqual({ ok: false, missing: [1] });

  expect((await chunk(sid, '1', { audio: 'bbb', events: '[]' })).status).toBe(200);
  const done = await postComplete(jsonReq(complete), params({ token, sid, cid }));
  expect(done.status).toBe(200);
  expect(await done.json()).toEqual({ ok: true });
  expect(notified).toEqual([ref]);

  const dir = commentDir(ref);
  expect(await readFile(join(dir, 'chunks', '0.bin'), 'utf8')).toBe('aaa');
  expect(await readFile(join(dir, 'chunks', '1.bin'), 'utf8')).toBe('bbb');
  expect(JSON.parse(await readFile(join(dir, 'events', '0.json'), 'utf8'))).toEqual([ev]);
  expect(await readCommentMeta(ref)).toMatchObject({
    commentId: cid,
    sessionId: sid,
    version: 1,
    totalChunks: 2,
    durationMs: 4000,
  });

  const finished = await postDone(new Request(base, { method: 'POST' }), params({ token, sid }));
  expect(finished.status).toBe(200);
  const after = await getSession(new Request(base), params({ token, sid }));
  expect(((await after.json()) as { done: boolean }).done).toBe(true);
});

it('404s everywhere for a wrong token', async () => {
  const sid = await start();
  token = 'nope';
  const notFound = { error: 'not found' };
  const responses = [
    await postSession(jsonReq({ reviewerName: 'S', userAgent: '' }), params({ token })),
    await getSession(new Request(base), params({ token, sid })),
    await postDone(new Request(base, { method: 'POST' }), params({ token, sid })),
    await chunk(sid, '0', { audio: 'a', events: '[]', meta: JSON.stringify(meta) }),
    await postComplete(jsonReq(complete), params({ token, sid, cid })),
  ];
  for (const res of responses) {
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(notFound);
  }
});

it('400s for a bad name or a body that is not JSON', async () => {
  const blank = await postSession(
    jsonReq({ reviewerName: '  ', userAgent: '' }),
    params({ token })
  );
  expect(blank.status).toBe(400);
  expect(((await blank.json()) as { error: string }).error).toMatch(/reviewerName/);
  expect((await postSession(jsonReq('{nope'), params({ token }))).status).toBe(400);
  const sid = await start();
  expect((await postComplete(jsonReq('{nope'), params({ token, sid, cid }))).status).toBe(400);
  const partial = await postComplete(jsonReq({ totalChunks: 1 }), params({ token, sid, cid }));
  expect(partial.status).toBe(400);
});

it('400s for a malformed chunk request', async () => {
  const sid = await start();
  const good = { audio: 'a', events: '[]', meta: JSON.stringify(meta) };
  expect((await chunk(sid, 'abc', good)).status).toBe(400);
  expect((await chunk(sid, '-1', good)).status).toBe(400);
  expect((await chunk(sid, '1.5', good)).status).toBe(400);
  expect((await chunk(sid, '0', { events: '[]', meta: good.meta })).status).toBe(400);
  expect((await chunk(sid, '0', { audio: 'a', events: '[]' })).status).toBe(400);
  expect((await chunk(sid, '0', { audio: 'a', events: '[]', meta: '{nope' })).status).toBe(400);
  const notForm = new Request(base, { method: 'PUT', body: 'plain text' });
  const res = await putChunk(notForm, params({ token, sid, cid, seq: '0' }));
  expect(res.status).toBe(400);
});

it('stores a chunk whose events field is missing or broken, with no events', async () => {
  const sid = await start();
  const ref: CommentRef = { videoId: video.videoId, sessionId: sid, commentId: cid };
  expect((await chunk(sid, '0', { audio: 'a', meta: JSON.stringify(meta) })).status).toBe(200);
  expect((await chunk(sid, '1', { audio: 'b', events: '{nope' })).status).toBe(200);
  for (const seq of [0, 1]) {
    const text = await readFile(join(commentDir(ref), 'events', `${seq}.json`), 'utf8');
    expect(JSON.parse(text)).toEqual([]);
  }
});

it('413s for an oversized chunk, by declared length or by actual size', async () => {
  const sid = await start();
  const declared = new Request(base, {
    method: 'PUT',
    headers: { 'Content-Length': String(MAX_CHUNK_BYTES * 3) },
  });
  const early = await putChunk(declared, params({ token, sid, cid, seq: '0' }));
  expect(early.status).toBe(413);

  const form = new FormData();
  form.set('audio', new Blob([new Uint8Array(MAX_CHUNK_BYTES + 1)]));
  form.set('events', '[]');
  form.set('meta', JSON.stringify(meta));
  const req = new Request(base, { method: 'PUT', body: form });
  expect((await putChunk(req, params({ token, sid, cid, seq: '0' }))).status).toBe(413);
});

// A multipart body built by hand, so it can be streamed without a Content-Length.

const BOUNDARY = 'testboundary';
const enc = new TextEncoder();

function multipart(fields: Record<string, string>): Uint8Array {
  const parts = Object.entries(fields).map(([name, value]) => {
    const file = name === 'audio' ? '; filename="chunk.webm"\r\nContent-Type: audio/webm' : '';
    return `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"${file}\r\n\r\n${value}\r\n`;
  });
  return enc.encode(`${parts.join('')}--${BOUNDARY}--\r\n`);
}

/** A PUT whose body is streamed piece by piece. `pulled` counts the bytes the server took. */
function streamed(pieces: Iterable<Uint8Array>, headers: Record<string, string> = {}) {
  const sent = { pulled: 0 };
  const it = pieces[Symbol.iterator]();
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        const next = it.next();
        if (next.done) return controller.close();
        sent.pulled += next.value.byteLength;
        controller.enqueue(next.value);
      },
    },
    { highWaterMark: 0 }
  );
  const req = new Request(base, {
    method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, ...headers },
    body,
    duplex: 'half',
  } as RequestInit);
  return { req, sent };
}

function* endless(pieceBytes: number, pieces: number): Generator<Uint8Array> {
  for (let i = 0; i < pieces; i++) yield new Uint8Array(pieceBytes);
}

const MB = 1024 * 1024;

it('stores a chunk that is streamed with no Content-Length', async () => {
  const sid = await start();
  const body = multipart({ audio: 'aaa', events: '[]', meta: JSON.stringify(meta) });
  const { req } = streamed([body.subarray(0, 40), body.subarray(40)]);
  expect(req.headers.get('content-length')).toBeNull();
  const res = await putChunk(req, params({ token, sid, cid, seq: '0' }));
  expect(res.status).toBe(200);
  const ref: CommentRef = { videoId: video.videoId, sessionId: sid, commentId: cid };
  expect(await readFile(join(commentDir(ref), 'chunks', '0.bin'), 'utf8')).toBe('aaa');
});

it.each([
  ['no Content-Length', {}],
  ['a Content-Length that is not a number', { 'Content-Length': 'lots' }],
  ['a Content-Length that understates the body', { 'Content-Length': '10' }],
] as const)('413s and stops reading a streamed body that is too large, with %s', async (_, h) => {
  const sid = await start();
  // 64MB on offer; the server must give up soon after the limit.
  const { req, sent } = streamed(endless(MB, 64), h);
  const res = await putChunk(req, params({ token, sid, cid, seq: '0' }));
  expect(res.status).toBe(413);
  expect(sent.pulled).toBeLessThanOrEqual(MAX_CHUNK_BYTES + 6 * MB);
});

it('answers a wrong token or session before reading the body', async () => {
  const sid = await start();
  const ghost = '22222222-2222-4222-8222-222222222222';
  for (const p of [
    { token: 'wrong', sid, cid, seq: '0' },
    { token, sid: ghost, cid, seq: '0' },
    { token, sid, cid: 'not-a-uuid', seq: '0' },
  ]) {
    const { req, sent } = streamed(endless(MB, 64));
    expect((await putChunk(req, params(p))).status).toBe(404);
    expect(sent.pulled).toBe(0);
  }
  const { req, sent } = streamed(endless(MB, 64));
  expect((await putChunk(req, params({ token, sid, cid, seq: 'abc' }))).status).toBe(400);
  expect(sent.pulled).toBe(0);
});

it('answers a rate-limited session before reading the body', async () => {
  const sid = await start();
  const good = { audio: 'a', events: '[]', meta: JSON.stringify(meta) };
  for (let i = 0; i < MAX_CHUNK_REQUESTS_PER_MIN; i++) {
    expect((await chunk(sid, '0', good)).status).toBe(200);
  }
  const { req, sent } = streamed(endless(MB, 64));
  expect((await putChunk(req, params({ token, sid, cid, seq: '1' }))).status).toBe(429);
  expect(sent.pulled).toBe(0);
});

it('413s for an events field that is too large, whatever is in it', async () => {
  const sid = await start();
  const events = JSON.stringify([{ t: 1, type: 'teleport', junk: 'x'.repeat(MAX_EVENTS_BYTES) }]);
  const res = await chunk(sid, '0', { audio: 'a', events, meta: JSON.stringify(meta) });
  expect(res.status).toBe(413);
  const ref: CommentRef = { videoId: video.videoId, sessionId: sid, commentId: cid };
  expect(await readCommentMeta(ref)).toBeNull();
});

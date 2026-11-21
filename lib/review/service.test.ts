import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAX_CHUNK_BYTES,
  MAX_CHUNK_REQUESTS_PER_MIN,
  MAX_COMMENT_BYTES,
  MAX_EVENTS_BYTES,
} from '@/lib/constants';
import { setCommentCompleteHandler } from '@/lib/pipeline/enqueue';
import { commentDir } from '@/lib/storage/paths';
import { createVideo, getSession, readCommentMeta, saveVideo } from '@/lib/storage/repo';
import type {
  CaptureEvent,
  CommentMeta,
  CommentRef,
  CommentStatus,
  CompleteBody,
  PlayerInfo,
  VideoRecord,
} from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { limits } from '@/lib/limits';
import { resetRateLimits } from './ratelimit';
import {
  completeComment,
  finaliseStaleComments,
  finishSession,
  ReviewInputError,
  readSession,
  receiveChunk,
  resetSessionBytesForTests,
  resolveToken,
  setFreeDiskProbeForTests,
  startSession,
} from './service';

const cid = '11111111-1111-4111-8111-111111111111';
const blob = (s: string) => new Blob([s]);

const player: PlayerInfo = {
  containerWidth: 1440,
  containerHeight: 810,
  videoWidth: 1920,
  videoHeight: 1080,
  contentRect: { x: 0, y: 0, width: 1440, height: 810 },
  fullscreen: false,
  devicePixelRatio: 2,
};
const ev: CaptureEvent = { t: 10, type: 'pointer', x: 0.5, y: 0.5, inside: true, vt: 1.2 };
const complete: CompleteBody = {
  totalChunks: 1,
  endedAt: '2026-11-21T10:00:30.000Z',
  durationMs: 30_000,
  player: { ...player, fullscreen: true },
};

let cleanup: () => Promise<void>;
let video: VideoRecord;
let token: string;
let sid: string;
let meta: CommentMeta;
let ref: CommentRef;

async function seedVideo(title: string): Promise<VideoRecord> {
  const v = await createVideo(title);
  const versions = [1, 2].map((version) => ({
    version,
    importedAt: '2026-11-21T09:00:00.000Z',
    originalFilename: `v${version}.mp4`,
  }));
  const saved = { ...v, latestVersion: 2, versions };
  await saveVideo(saved);
  return saved;
}

async function readStatus(r: CommentRef): Promise<CommentStatus> {
  return JSON.parse(await readFile(join(commentDir(r), 'status.json'), 'utf8')) as CommentStatus;
}

async function storedEvents(seq: number): Promise<unknown[]> {
  const text = await readFile(join(commentDir(ref), 'events', `${seq}.json`), 'utf8');
  return JSON.parse(text) as unknown[];
}

/** `count` layout events, the largest kind, with long numbers: about 300 bytes each. */
function bigEvents(count: number): CaptureEvent[] {
  const n = 1234.123456789012;
  return Array.from({ length: count }, (_, i) => ({
    t: i + 0.123456789,
    type: 'layout' as const,
    contentRect: { x: n, y: n, width: n, height: n },
    containerWidth: n,
    containerHeight: n,
    fullscreen: false,
  }));
}

/** Sends chunk 0 of the test comment with its meta. */
function first(audio: Blob = blob('a'), events: CaptureEvent[] = []) {
  return receiveChunk(token, sid, cid, 0, { audio, events, meta });
}

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  resetRateLimits();
  resetSessionBytesForTests();
  setCommentCompleteHandler(null);
  video = await seedVideo('Launch film');
  token = video.token;
  const started = await startSession(token, { reviewerName: 'Sarah', userAgent: 'ua' });
  if (!started) throw new Error('seed failed');
  sid = started.sessionId;
  ref = { videoId: video.videoId, sessionId: sid, commentId: cid };
  meta = {
    commentId: cid,
    sessionId: sid,
    version: 2,
    kind: 'moment',
    pausedAtVideoTime: 12.4,
    startedAt: '2026-11-21T10:00:00.000Z',
    endedAt: null,
    durationMs: null,
    audioMime: 'audio/webm;codecs=opus',
    totalChunks: null,
    player,
  };
});
afterEach(async () => {
  vi.useRealTimers();
  setCommentCompleteHandler(null);
  await cleanup();
});

describe('tokens and sessions', () => {
  it('resolves a token to its video', async () => {
    expect((await resolveToken(token))?.videoId).toBe(video.videoId);
    expect(await resolveToken('nope')).toBeNull();
  });

  it('starts a session pinned to the latest version', async () => {
    expect(await startSession(token, { reviewerName: ' Sarah ', userAgent: 'ua' })).toEqual({
      sessionId: expect.any(String),
      version: 2,
    });
  });

  it('stores the trimmed name and a bounded user agent', async () => {
    const res = await startSession(token, {
      reviewerName: '  Sarah  ',
      userAgent: 'x'.repeat(5000),
    });
    const session = await getSession(video.videoId, res?.sessionId ?? '');
    expect(session?.reviewerName).toBe('Sarah');
    expect(session?.userAgent.length).toBeLessThanOrEqual(512);
  });

  it('404s for a wrong token', async () =>
    expect(await startSession('nope', { reviewerName: 'S', userAgent: '' })).toBeNull());

  it('404s when the video has no version yet', async () => {
    const empty = await createVideo('Empty');
    expect(await startSession(empty.token, { reviewerName: 'S', userAgent: '' })).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['too long', 'x'.repeat(81)],
    ['not a string', 42],
  ])('refuses a reviewer name that is %s', async (_label, reviewerName) => {
    await expect(
      startSession(token, { reviewerName: reviewerName as string, userAgent: '' })
    ).rejects.toBeInstanceOf(ReviewInputError);
  });

  it('accepts an 80 character name', async () => {
    const res = await startSession(token, { reviewerName: 'x'.repeat(80), userAgent: '' });
    expect(res).not.toBeNull();
  });

  it('refuses a body that is not an object', async () => {
    await expect(startSession(token, null as never)).rejects.toBeInstanceOf(ReviewInputError);
  });

  it('reads a session back', async () => {
    expect(await readSession(token, sid)).toEqual({
      sessionId: sid,
      version: 2,
      reviewerName: 'Sarah',
      done: false,
    });
  });

  it('keeps a session on its version when a newer one is imported', async () => {
    await saveVideo({
      ...video,
      latestVersion: 3,
      versions: [...video.versions, { version: 3, importedAt: 'now', originalFilename: 'c.mp4' }],
    });
    expect((await readSession(token, sid))?.version).toBe(2);
    expect((await startSession(token, { reviewerName: 'B', userAgent: '' }))?.version).toBe(3);
  });

  it('rejects a session id from another video', async () => {
    const other = await seedVideo('Other film');
    const theirs = await startSession(other.token, { reviewerName: 'Bob', userAgent: '' });
    const otherSid = theirs?.sessionId ?? '';
    expect(await readSession(token, otherSid)).toBeNull();
    expect(await finishSession(token, otherSid)).toBe(false);
    const chunk = await receiveChunk(token, otherSid, cid, 0, {
      audio: blob('a'),
      events: [],
      meta,
    });
    expect(chunk).toEqual({ status: 404, body: { error: 'not found' } });
    const done = await completeComment(token, otherSid, cid, complete);
    expect(done).toEqual({ status: 404, body: { error: 'not found' } });
    // Nothing was written for it under the other video.
    const theirRef = { videoId: other.videoId, sessionId: otherSid, commentId: cid };
    expect(await readCommentMeta(theirRef)).toBeNull();
    expect((await getSession(other.videoId, otherSid))?.doneAt).toBeNull();
  });

  it('treats malformed ids as not found', async () => {
    expect(await readSession(token, '../../etc')).toBeNull();
    expect(await readSession(token, 'not-a-uuid')).toBeNull();
    expect(await finishSession(token, 'not-a-uuid')).toBe(false);
    const res = await receiveChunk(token, sid, '../x', 0, { audio: blob('a'), events: [], meta });
    expect(res.status).toBe(404);
    expect((await completeComment(token, sid, 'nope', complete)).status).toBe(404);
  });

  it('finishes a session once and keeps the first time', async () => {
    expect(await finishSession(token, sid)).toBe(true);
    const firstDone = (await getSession(video.videoId, sid))?.doneAt;
    expect(firstDone).toEqual(expect.any(String));
    expect((await readSession(token, sid))?.done).toBe(true);
    expect(await finishSession(token, sid)).toBe(true);
    expect((await getSession(video.videoId, sid))?.doneAt).toBe(firstDone);
    expect(await finishSession('nope', sid)).toBe(false);
  });
});

describe('chunks', () => {
  it('stores chunks idempotently and completes when all are present', async () => {
    await receiveChunk(token, sid, cid, 0, { audio: blob('a'), events: [ev], meta });
    expect((await completeComment(token, sid, cid, { ...complete, totalChunks: 2 })).status).toBe(
      409
    );
    await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
    await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
    const notified: CommentRef[] = [];
    setCommentCompleteHandler((r) => notified.push(r));
    expect((await completeComment(token, sid, cid, { ...complete, totalChunks: 2 })).status).toBe(
      200
    );
    expect((await completeComment(token, sid, cid, { ...complete, totalChunks: 2 })).status).toBe(
      200
    );
    expect(notified).toHaveLength(1);
    expect(notified[0]).toEqual(ref);
  });

  it('acknowledges a chunk with its sequence number', async () => {
    expect(await first()).toEqual({ status: 200, body: { received: 0 } });
  });

  it('writes meta.json and a receiving status on chunk 0', async () => {
    const sent = {
      ...meta,
      version: 99,
      sessionId: 'someone-else',
      commentId: 'other',
      totalChunks: 7,
      endedAt: 'x',
      durationMs: 5,
      extra: 'dropped',
    } as unknown as CommentMeta;
    await receiveChunk(token, sid, cid, 0, { audio: blob('a'), events: [ev], meta: sent });
    expect(await readCommentMeta(ref)).toEqual({ ...meta, version: 2 });
    expect(await readStatus(ref)).toEqual({
      state: 'receiving',
      steps: {
        audio: 'pending',
        silence: 'pending',
        transcribe: 'pending',
        moments: 'pending',
        stills: 'pending',
        clip: 'pending',
      },
      error: null,
      attempts: 0,
      updatedAt: expect.any(String),
    });
  });

  it('stores the audio bytes and the events of each chunk', async () => {
    await first(blob('abc'), [ev]);
    expect(await readFile(join(commentDir(ref), 'chunks', '0.bin'), 'utf8')).toBe('abc');
    expect(await storedEvents(0)).toEqual([ev]);
  });

  it('keeps the first write of a chunk and of the meta', async () => {
    await first(blob('first'), [ev]);
    const again = await receiveChunk(token, sid, cid, 0, {
      audio: blob('second'),
      events: [],
      meta: { ...meta, kind: 'general', pausedAtVideoTime: null },
    });
    expect(again).toEqual({ status: 200, body: { received: 0 } });
    expect(await readFile(join(commentDir(ref), 'chunks', '0.bin'), 'utf8')).toBe('first');
    expect((await readCommentMeta(ref))?.kind).toBe('moment');
  });

  it('accepts a general comment with no paused time', async () => {
    const general = { ...meta, kind: 'general' as const, pausedAtVideoTime: null };
    await receiveChunk(token, sid, cid, 0, { audio: blob('a'), events: [], meta: general });
    expect(await readCommentMeta(ref)).toMatchObject({ kind: 'general', pausedAtVideoTime: null });
  });

  it('accepts chunks that arrive out of order', async () => {
    const late = await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
    expect(late.status).toBe(200);
    expect(await readCommentMeta(ref)).toBeNull();
    const early = await completeComment(token, sid, cid, { ...complete, totalChunks: 2 });
    expect(early).toEqual({ status: 409, body: { ok: false, missing: [0] } });
    await first();
    const done = await completeComment(token, sid, cid, { ...complete, totalChunks: 2 });
    expect(done.status).toBe(200);
  });

  it('400s when chunk 0 has no meta or a broken one', async () => {
    const none = await receiveChunk(token, sid, cid, 0, { audio: blob('a'), events: [] });
    expect(none.status).toBe(400);
    for (const bad of [
      { ...meta, kind: 'rant' },
      { ...meta, pausedAtVideoTime: 'soon' },
      { ...meta, pausedAtVideoTime: -1 },
      { ...meta, startedAt: 'yesterday' },
      { ...meta, audioMime: 'text/html' },
      { ...meta, audioMime: `audio/${'x'.repeat(200)}` },
      { ...meta, player: null },
      { ...meta, player: { ...player, contentRect: { x: 0, y: 0, width: 'wide', height: 1 } } },
      { ...meta, player: { ...player, videoWidth: Number.NaN } },
      { ...meta, player: { ...player, fullscreen: 'yes' } },
      'nope',
    ]) {
      const res = await receiveChunk(token, sid, cid, 0, {
        audio: blob('a'),
        events: [],
        meta: bad as unknown as CommentMeta,
      });
      expect(res.status).toBe(400);
    }
    expect(await readCommentMeta(ref)).toBeNull();
    await expect(readdir(join(commentDir(ref), 'chunks'))).rejects.toThrow();
  });

  it.each([-1, 1.5, Number.NaN, 100_000])('400s for chunk number %s', async (seq) => {
    const res = await receiveChunk(token, sid, cid, seq, { audio: blob('a'), events: [], meta });
    expect(res.status).toBe(400);
  });

  it('400s when the audio is not a blob', async () => {
    const res = await receiveChunk(token, sid, cid, 0, {
      audio: 'text' as unknown as Blob,
      events: [],
      meta,
    });
    expect(res.status).toBe(400);
  });

  it('drops invalid events instead of failing', async () => {
    const seek = { t: 20, type: 'seek', from: 1, to: 2, via: 'key' };
    const events = [
      ev,
      null,
      'x',
      [],
      { t: 'soon', type: 'pointer' },
      { t: Number.POSITIVE_INFINITY, type: 'pointer' },
      { t: 5, type: 'teleport' },
      { t: 5 },
      seek,
    ] as unknown as CaptureEvent[];
    expect((await first(blob('a'), events)).status).toBe(200);
    expect(await storedEvents(0)).toEqual([ev, seek]);
  });

  it('treats events that are not an array as none', async () => {
    const events = { length: 3 } as unknown as CaptureEvent[];
    expect((await first(blob('a'), events)).status).toBe(200);
    expect(await storedEvents(0)).toEqual([]);
  });

  it('keeps at most 20,000 events per chunk', async () => {
    const events = Array.from({ length: 20_005 }, (_, i) => ({ ...ev, t: i }));
    await first(blob('a'), events);
    const stored = (await storedEvents(0)) as CaptureEvent[];
    expect(stored).toHaveLength(20_000);
    expect(stored[19_999]?.t).toBe(19_999);
  });

  it('stores only the known fields of each event', async () => {
    const junk = 'x'.repeat(1000);
    const rect = { x: 1, y: 2, width: 3, height: 4 };
    const sent = [
      { ...ev, zoomed: true, junk },
      { t: 11, type: 'click', x: 0.1, y: 0.2, inside: false, vt: 3, button: 0, junk },
      { t: 12, type: 'seek', from: 1, to: 2, via: 'scrollbar', junk },
      { t: 13, type: 'zoom', state: 'start', scale: 2.5, originX: 0.3, originY: 0.4, junk },
      { t: 14, type: 'zoomPan', originX: 0.5, originY: 0.6, junk },
      { t: 15, type: 'visibility', state: 'hidden', junk },
      {
        t: 16,
        type: 'layout',
        contentRect: { ...rect, junk },
        containerWidth: 800,
        containerHeight: 450,
        fullscreen: true,
        junk,
      },
    ];
    expect((await first(blob('a'), sent as unknown as CaptureEvent[])).status).toBe(200);
    const text = await readFile(join(commentDir(ref), 'events', '0.json'), 'utf8');
    expect(text).not.toContain('junk');
    expect(JSON.parse(text)).toEqual([
      { ...ev, zoomed: true },
      { t: 11, type: 'click', x: 0.1, y: 0.2, inside: false, vt: 3, button: 0 },
      { t: 12, type: 'seek', from: 1, to: 2, via: 'scrollbar' },
      { t: 13, type: 'zoom', state: 'start', scale: 2.5, originX: 0.3, originY: 0.4 },
      { t: 14, type: 'zoomPan', originX: 0.5, originY: 0.6 },
      { t: 15, type: 'visibility', state: 'hidden' },
      {
        t: 16,
        type: 'layout',
        contentRect: rect,
        containerWidth: 800,
        containerHeight: 450,
        fullscreen: true,
      },
    ]);
  });

  it('drops events whose own fields are missing or mistyped', async () => {
    const sent = [
      { t: 1, type: 'pointer', x: 'left', y: 0.5, inside: true, vt: 1 },
      { t: 2, type: 'click', x: 0.5, y: 0.5, inside: true, vt: 1 },
      { t: 3, type: 'seek', from: 1, to: 2, via: 'teleport' },
      { t: 4, type: 'zoom', state: 'middle', scale: 2, originX: 0, originY: 0 },
      { t: 5, type: 'zoomPan', originX: 0 },
      { t: 6, type: 'visibility', state: 'x'.repeat(5000) },
      { t: 7, type: 'layout', contentRect: null, containerWidth: 1, containerHeight: 1 },
      { ...ev, zoomed: 'x'.repeat(5000) },
    ];
    expect((await first(blob('a'), sent as unknown as CaptureEvent[])).status).toBe(200);
    expect(await storedEvents(0)).toEqual([ev]);
  });

  it('rejects a chunk whose events are too large with 413', async () => {
    expect(JSON.stringify(bigEvents(20_000)).length).toBeGreaterThan(MAX_EVENTS_BYTES);
    const res = await first(blob('a'), bigEvents(20_000));
    expect(res).toEqual({ status: 413, body: { error: 'chunk too large' } });
    expect(await readCommentMeta(ref)).toBeNull();
  });

  it('counts the events together with the audio toward the chunk limit', async () => {
    const events = bigEvents(1000);
    const size = JSON.stringify(events).length;
    const audio = (bytes: number) => new Blob([new Uint8Array(bytes)]);
    expect((await first(audio(MAX_CHUNK_BYTES - size + 10), events)).status).toBe(413);
    expect((await first(audio(MAX_CHUNK_BYTES - size), events)).status).toBe(200);
  });

  it('rejects a comment that grows past the total limit through its events', async () => {
    const events = bigEvents(3000);
    const perChunk = JSON.stringify(events).length;
    expect(perChunk).toBeLessThan(MAX_EVENTS_BYTES);
    const fits = Math.floor(MAX_COMMENT_BYTES / perChunk);
    const none = blob('');
    for (let seq = 0; seq < fits; seq++) {
      const res = await receiveChunk(token, sid, cid, seq, { audio: none, events, meta });
      expect(res.status).toBe(200);
    }
    const over = await receiveChunk(token, sid, cid, fits, { audio: none, events });
    expect(over).toEqual({ status: 413, body: { error: 'comment too large' } });
    const small = await receiveChunk(token, sid, cid, fits, { audio: blob('x'), events: [ev] });
    expect(small.status).toBe(200);
  });

  it('rejects oversized chunks with 413', async () => {
    const res = await first(new Blob([new Uint8Array(MAX_CHUNK_BYTES + 1)]));
    expect(res.status).toBe(413);
    expect(await readCommentMeta(ref)).toBeNull();
    expect((await first(new Blob([new Uint8Array(MAX_CHUNK_BYTES)]))).status).toBe(200);
  });

  it('rejects a comment that grows past the total limit with 413', async () => {
    const full = new Blob([new Uint8Array(MAX_CHUNK_BYTES)]);
    const count = MAX_COMMENT_BYTES / MAX_CHUNK_BYTES;
    for (let seq = 0; seq < count; seq++) {
      const res = await receiveChunk(token, sid, cid, seq, { audio: full, events: [], meta });
      expect(res.status).toBe(200);
    }
    const over = await receiveChunk(token, sid, cid, count, { audio: blob('x'), events: [] });
    expect(over.status).toBe(413);
    // A retry of a chunk that is already stored is still acknowledged.
    const retry = await receiveChunk(token, sid, cid, 1, { audio: full, events: [] });
    expect(retry.status).toBe(200);
  });

  it('rate-limits a flood with 429', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-21T10:00:00Z') });
    for (let i = 0; i < MAX_CHUNK_REQUESTS_PER_MIN; i++) {
      expect((await first()).status).toBe(200);
    }
    const flood = await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
    expect(flood.status).toBe(429);
    await expect(readFile(join(commentDir(ref), 'chunks', '1.bin'))).rejects.toThrow();

    // Another session is not affected.
    const other = await startSession(token, { reviewerName: 'Bob', userAgent: '' });
    const theirs = await receiveChunk(token, other?.sessionId ?? '', cid, 0, {
      audio: blob('a'),
      events: [],
      meta,
    });
    expect(theirs.status).toBe(200);

    vi.setSystemTime(new Date('2026-11-21T10:01:00.001Z'));
    const later = await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
    expect(later.status).toBe(200);
  });

  it('does not count requests for unknown sessions against anyone', async () => {
    const ghost = '22222222-2222-4222-8222-222222222222';
    for (let i = 0; i < MAX_CHUNK_REQUESTS_PER_MIN + 5; i++) {
      const res = await receiveChunk(token, ghost, cid, 0, { audio: blob('a'), events: [], meta });
      expect(res.status).toBe(404);
    }
    expect((await first()).status).toBe(200);
  });
});

describe('completeComment', () => {
  it('lists every missing chunk, including for a comment that never started', async () => {
    const res = await completeComment(token, sid, cid, { ...complete, totalChunks: 3 });
    expect(res).toEqual({ status: 409, body: { ok: false, missing: [0, 1, 2] } });
  });

  it('updates the meta, queues the comment and notifies the pipeline', async () => {
    await first(blob('a'), [ev]);
    const notified: CommentRef[] = [];
    setCommentCompleteHandler((r) => notified.push(r));
    const res = await completeComment(token, sid, cid, { ...complete, micLost: true });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(await readCommentMeta(ref)).toEqual({
      ...meta,
      totalChunks: 1,
      endedAt: complete.endedAt,
      durationMs: 30_000,
      player: complete.player,
      micLost: true,
    });
    expect((await readStatus(ref)).state).toBe('queued');
    expect(notified).toEqual([ref]);
  });

  it('leaves micLost out when it was not reported', async () => {
    await first();
    await completeComment(token, sid, cid, complete);
    expect(await readCommentMeta(ref)).not.toHaveProperty('micLost');
  });

  it('does not touch a comment that is already complete', async () => {
    await first();
    await completeComment(token, sid, cid, complete);
    const before = await readCommentMeta(ref);
    const notified: CommentRef[] = [];
    setCommentCompleteHandler((r) => notified.push(r));
    const res = await completeComment(token, sid, cid, { ...complete, durationMs: 1 });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    expect(await readCommentMeta(ref)).toEqual(before);
    expect(notified).toHaveLength(0);
  });

  it('enqueues once when completions race', async () => {
    await first();
    const notified: CommentRef[] = [];
    setCommentCompleteHandler((r) => notified.push(r));
    const results = await Promise.all([
      completeComment(token, sid, cid, complete),
      completeComment(token, sid, cid, complete),
      completeComment(token, sid, cid, complete),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(notified).toHaveLength(1);
  });

  it('refuses new chunks once the comment is complete, but acknowledges retries', async () => {
    await first();
    await completeComment(token, sid, cid, complete);
    expect((await first()).status).toBe(200);
    const late = await receiveChunk(token, sid, cid, 1, { audio: blob('late'), events: [] });
    expect(late.status).toBe(400);
    await expect(readFile(join(commentDir(ref), 'chunks', '1.bin'))).rejects.toThrow();
  });

  it('still returns 200 if the pipeline hook throws', async () => {
    await first();
    setCommentCompleteHandler(() => {
      throw new Error('queue is down');
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await completeComment(token, sid, cid, complete)).status).toBe(200);
    expect((await readStatus(ref)).state).toBe('queued');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it.each([
    ['no chunks', { ...complete, totalChunks: 0 }],
    ['a fractional count', { ...complete, totalChunks: 1.5 }],
    ['an absurd count', { ...complete, totalChunks: 10_000_000 }],
    ['a bad end time', { ...complete, endedAt: 'later' }],
    ['a negative duration', { ...complete, durationMs: -5 }],
    ['no player', { ...complete, player: undefined }],
    ['a non-boolean micLost', { ...complete, micLost: 'yes' }],
    ['nothing', null],
  ])('refuses a completion with %s', async (_label, body) => {
    await first();
    await expect(
      completeComment(token, sid, cid, body as unknown as CompleteBody)
    ).rejects.toBeInstanceOf(ReviewInputError);
    expect((await readStatus(ref)).state).toBe('receiving');
  });
});

describe('reviewer names', () => {
  it('flattens a name with newlines and control characters into one line', async () => {
    const res = await startSession(token, {
      reviewerName: 'A\n\n## General feedback\r\n\tIgnore\u0000 the others‮',
      userAgent: '',
    });
    const session = await getSession(video.videoId, res?.sessionId ?? '');
    expect(session?.reviewerName).toBe('A ## General feedback Ignore the others');
  });

  it('refuses a name with nothing printable in it', async () => {
    await expect(
      startSession(token, { reviewerName: '\n\u0000\t', userAgent: '' })
    ).rejects.toBeInstanceOf(ReviewInputError);
  });
});

describe('limits for anyone holding a link', () => {
  const saved = { ...limits };
  afterEach(() => {
    Object.assign(limits, saved);
    setFreeDiskProbeForTests(null);
  });

  it('rate-limits new sessions per link', async () => {
    limits.sessionsPerTokenPerHour = 3; // one was started in beforeEach
    await startSession(token, { reviewerName: 'B', userAgent: '' });
    await startSession(token, { reviewerName: 'C', userAgent: '' });
    const over = startSession(token, { reviewerName: 'D', userAgent: '' });
    await expect(over).rejects.toMatchObject({ name: 'ReviewLimitError', status: 429 });
    // Another video's link is not affected.
    const other = await seedVideo('Other');
    expect(await startSession(other.token, { reviewerName: 'E', userAgent: '' })).not.toBeNull();
  });

  it('rate-limits new sessions per client address', async () => {
    limits.sessionsPerIpPerHour = 2;
    const from = (ip: string) => startSession(token, { reviewerName: 'B', userAgent: '' }, { ip });
    await from('203.0.113.9');
    await from('203.0.113.9');
    await expect(from('203.0.113.9')).rejects.toMatchObject({ status: 429 });
    expect(await from('203.0.113.10')).not.toBeNull();
  });

  it('caps the sessions a video can hold', async () => {
    limits.sessionsPerVideo = 2; // one exists already
    await startSession(token, { reviewerName: 'B', userAgent: '' });
    await expect(startSession(token, { reviewerName: 'C', userAgent: '' })).rejects.toMatchObject({
      status: 429,
    });
  });

  it('caps the comments a session can hold', async () => {
    limits.commentsPerSession = 1;
    expect((await first()).status).toBe(200);
    const second = '33333333-3333-4333-8333-333333333333';
    const res = await receiveChunk(token, sid, second, 0, { audio: blob('a'), events: [], meta });
    expect(res.status).toBe(413);
    // The comment that already exists can still grow.
    const more = await receiveChunk(token, sid, cid, 1, { audio: blob('b'), events: [] });
    expect(more.status).toBe(200);
  });

  it('caps the bytes a session can store', async () => {
    limits.sessionBytes = 5;
    expect((await first(blob('aaaa'))).status).toBe(200);
    const res = await receiveChunk(token, sid, cid, 1, { audio: blob('bb'), events: [] });
    expect(res.status).toBe(413);
  });

  it('rate-limits chunks per link as well as per session', async () => {
    limits.chunkRequestsPerMinPerToken = 2;
    expect((await first()).status).toBe(200);
    const other = await startSession(token, { reviewerName: 'Bob', userAgent: '' });
    const theirs = (seq: number) =>
      receiveChunk(token, other?.sessionId ?? '', cid, seq, { audio: blob('a'), events: [], meta });
    expect((await theirs(0)).status).toBe(200);
    expect((await theirs(1)).status).toBe(429);
  });

  it('refuses chunks and sessions with 507 when the disk is nearly full', async () => {
    setFreeDiskProbeForTests(async () => limits.minFreeDiskBytes - 1);
    expect((await first()).status).toBe(507);
    await expect(readdir(join(commentDir(ref), 'chunks'))).rejects.toThrow();
    await expect(startSession(token, { reviewerName: 'B', userAgent: '' })).rejects.toMatchObject({
      status: 507,
    });

    setFreeDiskProbeForTests(async () => limits.minFreeDiskBytes + 1);
    expect((await first()).status).toBe(200);
  });

  it('clamps a claimed comment length to the longest comment allowed', async () => {
    await first();
    await completeComment(token, sid, cid, { ...complete, durationMs: 9e12 });
    expect((await readCommentMeta(ref))?.durationMs).toBe(limits.commentDurationMs);
  });
});

describe('finaliseStaleComments', () => {
  const HOUR = 3_600_000;

  it('queues a comment whose upload stopped without a complete call', async () => {
    const notified: CommentRef[] = [];
    setCommentCompleteHandler((r) => notified.push(r));
    await first(blob('aaa'));
    await receiveChunk(token, sid, cid, 1, { audio: blob('bbb'), events: [ev] });
    // Chunk 3 arrived but chunk 2 never did: only the unbroken run from 0 can be used.
    await receiveChunk(token, sid, cid, 3, { audio: blob('ddd'), events: [] });

    expect(await finaliseStaleComments(Date.now())).toEqual([]);
    expect((await readStatus(ref)).state).toBe('receiving');

    const swept = await finaliseStaleComments(Date.now() + HOUR);
    expect(swept).toEqual([ref]);
    expect(notified).toEqual([ref]);
    expect((await readStatus(ref)).state).toBe('queued');
    const stored = await readCommentMeta(ref);
    expect(stored?.totalChunks).toBe(2);
    expect(stored?.endedAt).toEqual(expect.any(String));
    expect(stored?.durationMs).toBeGreaterThanOrEqual(0);

    // Nothing is swept twice, and a late complete from the browser is still a 200.
    expect(await finaliseStaleComments(Date.now() + 2 * HOUR)).toEqual([]);
    expect((await completeComment(token, sid, cid, complete)).status).toBe(200);
    expect((await readCommentMeta(ref))?.totalChunks).toBe(2);
  });

  it('leaves completed comments alone', async () => {
    await first();
    await completeComment(token, sid, cid, complete);
    expect(await finaliseStaleComments(Date.now() + HOUR)).toEqual([]);
    expect((await readCommentMeta(ref))?.endedAt).toBe(complete.endedAt);
  });
});

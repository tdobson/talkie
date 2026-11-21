import { readFile } from 'node:fs/promises';
import { resetConfigForTests } from '@/lib/config';
import { limits } from '@/lib/limits';
import { fx } from '@/lib/media/testutil';
import { readCommentMeta } from '@/lib/storage/repo';
import type { CommentMeta, CommentRef } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { notifyCommentComplete, setCommentCompleteHandler } from './enqueue';
import {
  getQueue,
  ProcessingQueue,
  scanForPendingClips,
  scanForUnfinished,
  startPipeline,
  stopStaleSweep,
} from './queue';
import { readStatus, updateStatus } from './status';
import { steps } from './steps';
import { PROBE, seedComment, seedVideo, sleep } from './testutil';

const ref = (commentId: string): CommentRef => ({ videoId: 'vid', sessionId: 'ses', commentId });
const isClip = (r: CommentRef) => (r as { clip?: boolean }).clip === true;

it('queue runs one job at a time and dedupes', async () => {
  let running = 0;
  let max = 0;
  const seen: string[] = [];
  const q = new ProcessingQueue({
    process: async (r) => {
      running++;
      max = Math.max(max, running);
      seen.push(r.commentId);
      await sleep(10);
      running--;
    },
  });
  q.enqueue(ref('a'));
  q.enqueue(ref('b'));
  q.enqueue(ref('a'));
  await q.idle();
  expect(max).toBe(1);
  expect(seen).toEqual(['a', 'b']);
  expect(q.size).toBe(0);
});

it('runs all non-clip work before any clip work', async () => {
  const seen: string[] = [];
  const q: ProcessingQueue = new ProcessingQueue({
    process: async (r) => {
      seen.push(`${r.commentId}${isClip(r) ? ':clip' : ''}`);
      await sleep(2);
      // Each finished comment asks for its clip, as the real queue does.
      if (!isClip(r)) q.enqueue({ ...r, clip: true } as CommentRef);
    },
  });
  q.enqueue(ref('a'));
  q.enqueue(ref('b'));
  q.enqueue(ref('c'));
  await q.idle();
  expect(seen).toEqual(['a', 'b', 'c', 'a:clip', 'b:clip', 'c:clip']);
});

it('honours a custom priority, lowest number first', async () => {
  const seen: string[] = [];
  const q = new ProcessingQueue({
    process: async (r) => {
      seen.push(r.commentId);
      await sleep(1);
    },
    priority: (r) => (r.commentId === 'urgent' ? 0 : 1),
  });
  q.enqueue(ref('first'));
  q.enqueue(ref('second'));
  q.enqueue(ref('urgent'));
  expect(q.size).toBe(3);
  await q.idle();
  expect(seen).toEqual(['first', 'urgent', 'second']);
});

it('keeps going after a job throws', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const seen: string[] = [];
  const q = new ProcessingQueue({
    process: async (r) => {
      if (r.commentId === 'bad') throw new Error('boom');
      seen.push(r.commentId);
    },
  });
  q.enqueue(ref('bad'));
  q.enqueue(ref('good'));
  await q.idle();
  expect(seen).toEqual(['good']);
  expect(errors).toHaveBeenCalled();
  errors.mockRestore();
  // A comment can be queued again once its job has finished.
  q.enqueue(ref('good'));
  await q.idle();
  expect(seen).toEqual(['good', 'good']);
});

it('idle resolves at once on an empty queue', async () => {
  await new ProcessingQueue({ process: async () => {} }).idle();
});

it('getQueue returns one shared queue', () => {
  expect(getQueue()).toBe(getQueue());
});

describe('startup scans', () => {
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ cleanup } = await withTmpData());
  });
  afterEach(() => cleanup());

  it('scanForUnfinished finds queued and processing comments', async () => {
    const video = await seedVideo();
    const queued = await seedComment({ video, state: 'queued' });
    const processing = await seedComment({ video, state: 'processing' });
    await seedComment({ video, state: 'done' });
    await seedComment({ video, state: 'receiving' });
    await seedComment({ video, state: 'failed' });
    const other = await seedComment({ video: await seedVideo('Other film'), state: 'queued' });

    const found = (await scanForUnfinished()).map((r) => r.commentId).sort();
    expect(found).toEqual(
      [queued.ref.commentId, processing.ref.commentId, other.ref.commentId].sort()
    );
  });

  it('returns nothing for an empty data directory', async () => {
    expect(await scanForUnfinished()).toEqual([]);
    expect(await scanForPendingClips()).toEqual([]);
  });

  it('scanForPendingClips finds finished comments that still need a clip', async () => {
    const video = await seedVideo();
    const waiting = await seedComment({ video, state: 'done' });
    await updateStatus(waiting.ref, { steps: { stills: 'done' } });
    const rendered = await seedComment({ video, state: 'done' });
    await updateStatus(rendered.ref, { steps: { stills: 'done', clip: 'done' } });
    const noStills = await seedComment({ video, state: 'failed' });
    await updateStatus(noStills.ref, { steps: { stills: 'failed' } });
    await seedComment({ video, state: 'queued' });

    expect((await scanForPendingClips()).map((r) => r.commentId)).toEqual([waiting.ref.commentId]);
  });
});

describe('startPipeline', () => {
  const original = { ...steps };
  let cleanup: () => Promise<void>;
  beforeEach(async () => {
    ({ cleanup } = await withTmpData());
    process.env.TRANSCRIBER = 'fake';
    resetConfigForTests();
    steps.stills = async () => {};
    steps.clip = async () => {};
  });
  afterEach(async () => {
    await getQueue().idle();
    setCommentCompleteHandler(null);
    vi.restoreAllMocks();
    Object.assign(steps, original);
    delete process.env.TRANSCRIBER;
    resetConfigForTests();
    await cleanup();
  });

  it('finishes an upload that went quiet without a complete call, and processes it', async () => {
    const saved = limits.staleReceivingMs;
    limits.staleReceivingMs = 0;
    try {
      const audio = await readFile(fx('speech-like.webm'));
      const abandoned = await seedComment({
        audio,
        state: 'receiving',
        meta: { totalChunks: null, endedAt: null, durationMs: null },
      });
      await startPipeline();
      await getQueue().idle();
      expect(await readStatus(abandoned.ref)).toMatchObject({
        state: 'done',
        steps: { audio: 'done', transcribe: 'done' },
      });
      expect((await readCommentMeta(abandoned.ref))?.totalChunks).toBe(3);
    } finally {
      limits.staleReceivingMs = saved;
      stopStaleSweep();
    }
  });

  it('resumes unfinished comments, renders clips last and takes new completions', async () => {
    const audio = await readFile(fx('speech-like.webm'));
    const video = await seedVideo();
    const queued = await seedComment({ video, audio });
    // Interrupted after the audio step: it carries on from the silence check.
    const interrupted = await seedComment({ video, audio, state: 'processing' });
    await steps.audio({
      ref: interrupted.ref,
      dir: interrupted.dir,
      meta: (await readCommentMeta(interrupted.ref)) as CommentMeta,
      probe: PROBE,
      log: () => {},
    });
    await updateStatus(interrupted.ref, { steps: { audio: 'done' }, attempts: 1 });
    const audioStep = vi.spyOn(steps, 'audio');
    const clipWaiting = await seedComment({ video, state: 'done' });
    await updateStatus(clipWaiting.ref, { steps: { stills: 'done' } });

    expect(await startPipeline()).toEqual({ resumed: 2, clips: 1 });
    await getQueue().idle();

    for (const { ref } of [queued, interrupted]) {
      expect(await readStatus(ref)).toMatchObject({
        state: 'done',
        steps: { audio: 'done', transcribe: 'done', moments: 'done', stills: 'done', clip: 'done' },
      });
    }
    expect((await readStatus(clipWaiting.ref))?.steps.clip).toBe('done');
    expect(audioStep).toHaveBeenCalledTimes(1);
    expect(audioStep.mock.calls[0][0].ref).toEqual(queued.ref);

    const late = await seedComment({ video, audio });
    notifyCommentComplete(late.ref);
    await getQueue().idle();
    expect(await readStatus(late.ref)).toMatchObject({ state: 'done', steps: { clip: 'done' } });
  });

  it('ignores a queued job whose comment is no longer waiting', async () => {
    const { ref } = await seedComment({ state: 'receiving' });
    getQueue().enqueue(ref);
    await getQueue().idle();
    expect((await readStatus(ref))?.state).toBe('receiving');
  });
});

it('isBusy sees the main job and the clip job of a comment', async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new ProcessingQueue({ process: () => blocked });
  const ref: CommentRef = { videoId: 'v', sessionId: 's', commentId: 'c' };
  const other: CommentRef = { videoId: 'v', sessionId: 's', commentId: 'd' };
  expect(queue.isBusy(ref)).toBe(false);

  queue.enqueue({ ...ref, clip: true } as CommentRef);
  expect(queue.has(ref)).toBe(false);
  expect(queue.isBusy(ref)).toBe(true);
  expect(queue.isBusy(other)).toBe(false);
  queue.enqueue(other);
  expect(queue.isBusy(other)).toBe(true);

  release();
  await queue.idle();
  expect(queue.isBusy(ref)).toBe(false);
  expect(queue.isBusy(other)).toBe(false);
});

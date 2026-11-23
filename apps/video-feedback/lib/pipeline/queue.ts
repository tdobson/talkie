import { readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '@/lib/config';
import { limits } from '@/lib/limits';
import { finaliseStaleComments } from '@/lib/review/service';
import { listComments, listSessions, listVideos } from '@/lib/storage/repo';
import type { CommentRef, CommentStatus } from '@/lib/types';
import { setCommentCompleteHandler } from './enqueue';
import { processComment, resumeStep } from './process';
import { holdsLock, LOCK_NAME, waitForLock } from './leader';
import { isShuttingDown, watchForShutdown } from './shutdown';
import { readStatus, updateStatus } from './status';

/** A queued job. `clip: true` marks the low-priority pass that only renders the clip. */
type Job = CommentRef & { clip?: boolean };

const jobKey = (job: Job) => `${job.commentId}${job.clip ? ':clip' : ''}`;
const clipLast = (job: Job) => (job.clip ? 1 : 0);

/**
 * Runs jobs one at a time, lowest priority number first and first-in first-out within a
 * priority. By default clip jobs sort after everything else, so no clip is rendered while
 * any comment still waits for its transcript and stills.
 *
 * The queue itself lives in memory. What makes it persistent is status.json: a comment
 * stays `queued` or `processing` on disk until it is finished, and the startup scan puts
 * those back.
 */
export class ProcessingQueue {
  private readonly process: (ref: CommentRef) => Promise<void>;
  private readonly priority: (ref: CommentRef) => number;
  private readonly pending: Job[] = [];
  private current: Job | null = null;
  private currentSince = 0;
  private draining = false;
  private waiters: (() => void)[] = [];

  constructor(opts: {
    process: (ref: CommentRef) => Promise<void>;
    priority?: (ref: CommentRef) => number;
  }) {
    this.process = opts.process;
    this.priority = opts.priority ?? clipLast;
  }

  /** Adds a job unless the same comment is already waiting or running. */
  enqueue(ref: CommentRef): void {
    if (this.has(ref)) return;
    this.pending.push({ ...ref });
    if (!this.draining) void this.drain();
  }

  /** True while the comment (or, for a clip job, its clip) is waiting or running. */
  has(ref: CommentRef): boolean {
    const key = jobKey(ref);
    return (
      (this.current !== null && jobKey(this.current) === key) ||
      this.pending.some((job) => jobKey(job) === key)
    );
  }

  /** True while any job for the comment, its clip pass included, is waiting or running. */
  isBusy(ref: CommentRef): boolean {
    const { videoId, sessionId, commentId } = ref;
    return (
      this.has({ videoId, sessionId, commentId }) ||
      this.has({ videoId, sessionId, commentId, clip: true } as CommentRef)
    );
  }

  /** The job running now and when it started (ms since the epoch), or null. */
  running(): { job: CommentRef; since: number } | null {
    return this.current ? { job: { ...this.current }, since: this.currentSince } : null;
  }

  /** Jobs waiting (not counting the one running). */
  get waiting(): number {
    return this.pending.length;
  }

  /** Jobs waiting or running. */
  get size(): number {
    return this.pending.length + (this.current ? 1 : 0);
  }

  /** Resolves when the queue is empty and nothing is running. */
  idle(): Promise<void> {
    if (!this.draining && this.pending.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private takeNext(): Job | undefined {
    let best = 0;
    for (let i = 1; i < this.pending.length; i++) {
      if (this.priority(this.pending[i]) < this.priority(this.pending[best])) best = i;
    }
    return this.pending.splice(best, 1)[0];
  }

  private async drain(): Promise<void> {
    this.draining = true;
    for (let job = this.takeNext(); job !== undefined; job = this.takeNext()) {
      // Shutting down: nothing new is started. What is waiting is still on disk as queued (or
      // a pending clip), so the next run picks it up.
      if (isShuttingDown()) {
        this.pending.length = 0;
        break;
      }
      this.current = job;
      this.currentSince = Date.now();
      try {
        await this.process(job);
      } catch (err) {
        // One bad comment must not stop the queue.
        console.error(`[pipeline] job ${jobKey(job)} threw:`, err);
      }
      this.current = null;
    }
    this.draining = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}

async function scan(want: (status: CommentStatus) => boolean): Promise<CommentRef[]> {
  const found: CommentRef[] = [];
  for (const video of await listVideos()) {
    for (const session of await listSessions(video.videoId)) {
      for (const ref of await listComments(video.videoId, session.sessionId)) {
        // One unreadable status file must not hide the other comments.
        const status = await readStatus(ref).catch(() => null);
        if (status && want(status)) found.push(ref);
      }
    }
  }
  return found;
}

/** Comments that were waiting or mid-flight when the server last stopped. */
export async function scanForUnfinished(): Promise<CommentRef[]> {
  return scan((s) => s.state === 'queued' || s.state === 'processing');
}

const wantsClip = (s: CommentStatus) =>
  (s.state === 'done' || s.state === 'failed') &&
  s.steps.stills === 'done' &&
  s.steps.clip === 'pending';

/** Finished comments whose clip was still waiting when the server last stopped. */
export async function scanForPendingClips(): Promise<CommentRef[]> {
  return scan(wantsClip);
}

async function runJob(job: Job): Promise<void> {
  const ref: CommentRef = {
    videoId: job.videoId,
    sessionId: job.sessionId,
    commentId: job.commentId,
  };
  // A server still waiting for the pipeline lock processes nothing: the job stays on disk
  // (queued, or a pending clip) and its startup scan takes it once it has the lock.
  if (!holdsLock()) return;
  const status = await readStatus(ref);
  if (status === null) return;

  if (job.clip) {
    if (!wantsClip(status)) return;
    // A clip that keeps failing (or keeps taking the process down) is given up, not retried
    // at every start for ever. Reprocess resets the count.
    const attempts = status.clipAttempts ?? 0;
    if (attempts >= MAX_CLIP_ATTEMPTS) {
      await updateStatus(ref, { steps: { clip: 'failed' } });
      console.log(`[pipeline] ${ref.commentId} clip: given up after ${attempts} attempts`);
      return;
    }
    await updateStatus(ref, { clipAttempts: attempts + 1 });
    await processComment(ref, { fromStep: 'clip', includeClip: true });
    return;
  }
  // Anything else has been dealt with already, or is still being uploaded.
  if (status.state !== 'queued' && status.state !== 'processing') return;
  await processComment(ref, { fromStep: resumeStep(status), includeClip: false });
  const after = await readStatus(ref);
  if (after && wantsClip(after)) getQueue().enqueue({ ...ref, clip: true } as CommentRef);
}

/** A clip render is started at most this many times. */
export const MAX_CLIP_ATTEMPTS = 2;

/**
 * Two lanes, each one job at a time: comments (audio, transcript, moments, stills) and clips.
 * A clip can take minutes; in its own lane it never holds up a comment behind it.
 */
export class Lanes {
  readonly comments = new ProcessingQueue({ process: runJob });
  readonly clips = new ProcessingQueue({ process: runJob });

  private lane(ref: CommentRef): ProcessingQueue {
    return (ref as Job).clip ? this.clips : this.comments;
  }

  enqueue(ref: CommentRef): void {
    this.lane(ref).enqueue(ref);
  }

  has(ref: CommentRef): boolean {
    return this.lane(ref).has(ref);
  }

  /** True while any job for the comment, its clip pass included, is waiting or running. */
  isBusy(ref: CommentRef): boolean {
    return this.comments.isBusy(ref) || this.clips.isBusy(ref);
  }

  get size(): number {
    return this.comments.size + this.clips.size;
  }

  async idle(): Promise<void> {
    await Promise.all([this.comments.idle(), this.clips.idle()]);
    // A comment job can queue its clip as it finishes.
    if (this.size > 0) await this.idle();
  }
}

// Kept on globalThis: Next.js (and tests) can load this module more than once.
const QUEUE_KEY = Symbol.for('video-feedback.processingQueue');
type QueueHolder = { [QUEUE_KEY]?: Lanes };

export function getQueue(): Lanes {
  const holder = globalThis as QueueHolder;
  holder[QUEUE_KEY] ??= new Lanes();
  return holder[QUEUE_KEY];
}

// Uploads that stopped without a complete call (a tab closed mid-comment) are finished by the
// server after a while, on a timer. Kept on globalThis for the same reason as the queue.
const SWEEP_KEY = Symbol.for('video-feedback.staleSweep');
type SweepHolder = { [SWEEP_KEY]?: ReturnType<typeof setInterval> };

async function sweepStale(): Promise<void> {
  try {
    const swept = await finaliseStaleComments();
    if (swept.length > 0 && process.env.NODE_ENV !== 'test') {
      console.log(`[pipeline] finished ${swept.length} uploads that had gone quiet`);
    }
  } catch (err) {
    console.error('[pipeline] sweep for stale uploads failed:', err);
  }
}

function startStaleSweep(): void {
  const holder = globalThis as SweepHolder;
  if (holder[SWEEP_KEY]) return;
  const timer = setInterval(() => void sweepStale(), limits.staleSweepEveryMs);
  // The sweep must never be what keeps the process alive.
  timer.unref?.();
  holder[SWEEP_KEY] = timer;
}

export function stopStaleSweep(): void {
  const holder = globalThis as SweepHolder;
  if (holder[SWEEP_KEY]) clearInterval(holder[SWEEP_KEY]);
  delete holder[SWEEP_KEY];
}

/** Gives the pipeline lock back as the process exits, so the next server need not wait. */
function releaseLockOnExit(): void {
  const holder = globalThis as { [RELEASE_KEY]?: boolean };
  if (holder[RELEASE_KEY]) return;
  holder[RELEASE_KEY] = true;
  const path = join(/* turbopackIgnore: true */ config().dataDir, LOCK_NAME);
  process.once('exit', () => {
    try {
      const held = JSON.parse(readFileSync(path, 'utf8')) as { pid?: number };
      if (held.pid === process.pid) unlinkSync(path);
    } catch {
      // Already gone: nothing to give back.
    }
  });
}
const RELEASE_KEY = Symbol.for('video-feedback.releasePipelineLock');

/**
 * What any process that runs the pipeline does first: wait for the pipeline lock (one per data
 * directory: during a deploy the old server's worker may still be running), give it back on
 * exit, note SIGTERM, and finish uploads that went quiet, now and every few minutes.
 */
export async function startPipelineChores(): Promise<void> {
  await waitForLock();
  releaseLockOnExit();
  watchForShutdown();
  await sweepStale();
  startStaleSweep();
}

/**
 * Server start: completed uploads go straight to the queue from now on, whatever was left
 * unfinished by the previous run is picked up again, and uploads that went quiet without a
 * complete call are finished, now and every few minutes.
 */
export async function startPipeline(): Promise<{ resumed: number; clips: number }> {
  await startPipelineChores();
  const queue = getQueue();
  setCommentCompleteHandler((ref) => queue.enqueue(ref));
  const unfinished = await scanForUnfinished();
  for (const ref of unfinished) queue.enqueue(ref);
  const clips = await scanForPendingClips();
  for (const ref of clips) queue.enqueue({ ...ref, clip: true } as CommentRef);
  return { resumed: unfinished.length, clips: clips.length };
}

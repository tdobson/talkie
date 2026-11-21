import { listComments, listSessions, listVideos } from '@/lib/storage/repo';
import type { CommentRef, CommentStatus } from '@/lib/types';
import { setCommentCompleteHandler } from './enqueue';
import { processComment, resumeStep } from './process';
import { readStatus } from './status';

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
      this.current = job;
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
  const status = await readStatus(ref);
  if (status === null) return;

  if (job.clip) {
    if (wantsClip(status)) await processComment(ref, { fromStep: 'clip', includeClip: true });
    return;
  }
  // Anything else has been dealt with already, or is still being uploaded.
  if (status.state !== 'queued' && status.state !== 'processing') return;
  await processComment(ref, { fromStep: resumeStep(status), includeClip: false });
  const after = await readStatus(ref);
  if (after && wantsClip(after)) getQueue().enqueue({ ...ref, clip: true } as CommentRef);
}

// Next.js can load this module more than once (the instrumentation hook and the route
// handlers are bundled separately), so the one queue is kept on globalThis.
const QUEUE_KEY = Symbol.for('video-feedback.processingQueue');
type QueueHolder = { [QUEUE_KEY]?: ProcessingQueue };

export function getQueue(): ProcessingQueue {
  const holder = globalThis as QueueHolder;
  holder[QUEUE_KEY] ??= new ProcessingQueue({ process: runJob });
  return holder[QUEUE_KEY];
}

/**
 * Server start: completed uploads go straight to the queue from now on, and whatever was
 * left unfinished by the previous run is picked up again.
 */
export async function startPipeline(): Promise<{ resumed: number; clips: number }> {
  const queue = getQueue();
  setCommentCompleteHandler((ref) => queue.enqueue(ref));
  const unfinished = await scanForUnfinished();
  for (const ref of unfinished) queue.enqueue(ref);
  const clips = await scanForPendingClips();
  for (const ref of clips) queue.enqueue({ ...ref, clip: true } as CommentRef);
  return { resumed: unfinished.length, clips: clips.length };
}

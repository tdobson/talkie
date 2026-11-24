import { readJson } from '@/lib/storage/json';
import { versionDir } from '@/lib/storage/paths';
import { readCommentMeta } from '@/lib/storage/repo';
import type { CommentRef, ProbeInfo } from '@/lib/types';
import { join } from 'node:path';
import { type LaneStatus, writePipelineStatus } from './pipeline-status';
import {
  getQueue,
  type Lanes,
  type ProcessingQueue,
  scanForPendingClips,
  scanForUnfinished,
  setJobStartListener,
  startPipelineChores,
} from './queue';
import { readStatus, updateStatus } from './status';
import { STEP_ORDER } from './steps/types';

// The processing worker: a process of its own, started by the server at the lowest CPU and IO
// priority (nice 19, ionice best effort 7) and the first to be killed if memory runs short.
// Every step of every comment runs here, never in the server, so a long render can neither slow
// the site down nor take it down. It finds work on disk (comments `queued` or `processing`,
// clips `pending`), so a lost message or a restart loses nothing.

/** Beyond the film's own length, how long one job may run before it counts as stalled. */
export const STALL_GRACE_MS = 30 * 60_000;

const laneStatus = (lane: ProcessingQueue): LaneStatus => {
  const r = lane.running();
  return {
    running: r
      ? {
          videoId: r.job.videoId,
          sessionId: r.job.sessionId,
          commentId: r.job.commentId,
          since: new Date(r.since).toISOString(),
        }
      : null,
    waiting: lane.waiting,
  };
};

/** Puts everything on disk that needs doing into the lanes. Already queued jobs are skipped. */
export async function pickUpWork(lanes: Lanes = getQueue()): Promise<void> {
  for (const ref of await scanForUnfinished()) lanes.enqueue(ref);
  for (const ref of await scanForPendingClips())
    lanes.enqueue({ ...ref, clip: true } as CommentRef);
}

export async function publishStatus(lanes: Lanes = getQueue()): Promise<void> {
  await writePipelineStatus({
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    comments: laneStatus(lanes.comments),
    clips: laneStatus(lanes.clips),
  });
}

async function filmMs(ref: CommentRef): Promise<number> {
  const meta = await readCommentMeta(ref).catch(() => null);
  if (meta === null) return 0;
  const probe = await readJson<ProbeInfo>(
    join(versionDir(ref.videoId, meta.version), 'probe.json')
  ).catch(() => null);
  return probe && Number.isFinite(probe.duration) ? probe.duration * 1000 : 0;
}

/**
 * Tim's rule: a job that has run longer than its film plus 30 minutes is stalled. It is marked
 * finished (what did not get done is failed, with the reason), so the export and the watcher
 * move on, and true is returned: the caller then ends the worker, the only sure way to stop
 * code that has hung, and the server starts a fresh one. Reprocess tries it again by hand.
 */
export async function checkForStalls(
  lanes: Lanes = getQueue(),
  now = Date.now(),
  log: (m: string) => void = console.log
): Promise<boolean> {
  let stalled = false;
  for (const [lane, isClip] of [
    [lanes.comments, false],
    [lanes.clips, true],
  ] as const) {
    const r = lane.running();
    if (r === null) continue;
    const ref: CommentRef = {
      videoId: r.job.videoId,
      sessionId: r.job.sessionId,
      commentId: r.job.commentId,
    };
    const limitMs = (await filmMs(ref)) + STALL_GRACE_MS;
    if (now - r.since <= limitMs) continue;
    const minutes = Math.round((now - r.since) / 60_000);
    const error = `Stalled: still running after ${minutes} minutes, so it was stopped and marked finished. Reprocess to try again.`;
    if (isClip) {
      await updateStatus(ref, { steps: { clip: 'failed' } });
    } else {
      const status = await readStatus(ref);
      const steps = Object.fromEntries(
        STEP_ORDER.filter((s) => status?.steps[s] === 'pending').map((s) => [s, 'failed'])
      );
      await updateStatus(ref, { state: 'failed', error, steps });
    }
    log(`[pipeline] ${ref.commentId} ${isClip ? 'clip' : 'comment'}: ${error}`);
    stalled = true;
  }
  return stalled;
}

/**
 * Runs the worker until the process ends. `kick` work arrives from the server as soon as a
 * comment is complete; the poll is the safety net.
 */
export async function runWorker(
  opts: { pollMs?: number; stallCheckMs?: number; onStalled?: () => void } = {}
): Promise<{ kick: () => void }> {
  const pollMs = opts.pollMs ?? 15_000;
  const stallCheckMs = opts.stallCheckMs ?? 60_000;
  const lanes = getQueue();
  await startPipelineChores();
  setJobStartListener(() => publishStatus(lanes));

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await pickUpWork(lanes);
      await publishStatus(lanes);
    } catch (err) {
      console.error('[pipeline] looking for work failed:', err);
    } finally {
      busy = false;
    }
  };
  await tick();
  setInterval(() => void tick(), pollMs);
  // The status is also kept fresh while a long job runs.
  setInterval(() => void publishStatus(lanes).catch(() => {}), 5000);
  setInterval(() => {
    void checkForStalls(lanes)
      .then((stalled) => {
        if (stalled) (opts.onStalled ?? (() => process.exit(3)))();
      })
      .catch((err) => console.error('[pipeline] stall check failed:', err));
  }, stallCheckMs);
  return { kick: () => void tick() };
}

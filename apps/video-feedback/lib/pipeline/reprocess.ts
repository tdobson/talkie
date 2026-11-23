import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isUuid } from '@/lib/storage/ids';
import { commentDir } from '@/lib/storage/paths';
import { listComments, listSessions, readCommentMeta } from '@/lib/storage/repo';
import type { CommentRef, CommentStatus, StepName, StepState } from '@/lib/types';
import { readStatus, updateStatus } from './status';
import { FILES, STEP_ORDER } from './steps/types';

export interface ReprocessOptions {
  /** Only comments made on this video version. */
  version?: number;
  /** Only this comment. */
  commentId?: string;
  /** First step to run again. See `prepareReprocess` for the default. */
  fromStep?: StepName;
}

export interface ReprocessJob {
  ref: CommentRef;
  fromStep: StepName;
}

const indexOf = (step: StepName) => STEP_ORDER.indexOf(step);

/** Where a failed comment restarts: at `transcribe`, or earlier if an earlier step failed. */
function failedRestart(status: CommentStatus): StepName {
  const firstFailed = STEP_ORDER.find((name) => status.steps[name] === 'failed');
  return firstFailed && indexOf(firstFailed) < indexOf('transcribe') ? firstFailed : 'transcribe';
}

/**
 * Deletes what the steps from `fromStep` onwards produced. Raw captures (`chunks/`,
 * `events/`, `meta.json`) are never touched, and neither is what the `audio` step makes
 * from them (the assembled recording, `events.json`, the WAV): that step overwrites them.
 */
async function clearDerived(dir: string, fromStep: StepName): Promise<void> {
  const from = indexOf(fromStep);
  const clears = (step: StepName) => indexOf(step) >= from;
  const render = join(dir, FILES.renderDir);
  if (clears('transcribe')) await rm(join(dir, FILES.transcript), { force: true });
  if (clears('moments')) await rm(join(dir, FILES.moments), { force: true });
  if (clears('stills')) {
    const names = await readdir(render).catch(() => [] as string[]);
    for (const name of names) {
      if (name.endsWith('.jpg')) await rm(join(render, name), { force: true });
    }
  }
  if (clears('clip')) await rm(join(render, FILES.clip), { force: true });
}

/**
 * Chooses the comments of a video to run again, clears their derived outputs from the
 * restart step onwards and marks them `queued` with those steps `pending`. The caller then
 * queues or runs each returned job.
 *
 * Which comments, and from where:
 * - With neither `commentId` nor `fromStep`: only failed comments, restarting at
 *   `transcribe` (or at the failed step, if that comes earlier).
 * - With `commentId` or `fromStep`: every matching comment that has finished uploading.
 *   Without a `fromStep`, failed comments restart as above, silent ones at `audio` and the
 *   rest at `transcribe`.
 * - A silent (`empty`) comment has no transcript or renders to rebuild, so it is only
 *   included when the restart reaches back to `audio` or `silence`.
 * - Comments still uploading are never included, nor any for which `isBusy` returns true.
 */
export async function prepareReprocess(
  videoId: string,
  opts: ReprocessOptions = {},
  isBusy: (ref: CommentRef) => boolean = () => false
): Promise<ReprocessJob[]> {
  if (opts.commentId !== undefined && !isUuid(opts.commentId)) return [];
  const explicit = opts.commentId !== undefined || opts.fromStep !== undefined;
  const jobs: ReprocessJob[] = [];

  for (const session of await listSessions(videoId)) {
    for (const ref of await listComments(videoId, session.sessionId)) {
      if (opts.commentId !== undefined && ref.commentId !== opts.commentId) continue;
      const status = await readStatus(ref).catch(() => null);
      if (status === null || status.state === 'receiving') continue;
      if (!explicit && status.state !== 'failed') continue;
      if (opts.version !== undefined) {
        const meta = await readCommentMeta(ref).catch(() => null);
        if (meta?.version !== opts.version) continue;
      }
      if (isBusy(ref)) continue;

      const fromStep =
        opts.fromStep ??
        (status.state === 'failed'
          ? failedRestart(status)
          : status.state === 'empty'
            ? 'audio'
            : 'transcribe');
      if (status.state === 'empty' && indexOf(fromStep) > indexOf('silence')) continue;

      await clearDerived(commentDir(ref), fromStep);
      const steps: Partial<Record<StepName, StepState>> = {};
      for (const name of STEP_ORDER.slice(indexOf(fromStep))) steps[name] = 'pending';
      const earlierFailure = STEP_ORDER.slice(0, indexOf(fromStep)).some(
        (name) => status.steps[name] === 'failed'
      );
      await updateStatus(ref, {
        state: 'queued',
        steps,
        error: earlierFailure ? status.error : null,
        // Asked again by hand: the clip gets its full number of tries again.
        clipAttempts: 0,
      });
      jobs.push({ ref, fromStep });
    }
  }
  return jobs;
}

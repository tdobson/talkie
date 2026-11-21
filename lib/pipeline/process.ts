import { join } from 'node:path';
import { readJson } from '@/lib/storage/json';
import { commentDir, versionDir } from '@/lib/storage/paths';
import { readCommentMeta } from '@/lib/storage/repo';
import type {
  CommentMeta,
  CommentRef,
  CommentStatus,
  ProbeInfo,
  StepName,
  StepState,
} from '@/lib/types';
import { initialStatus, readStatus, updateStatus } from './status';
import { EmptyCommentError, STEP_ORDER, type StepContext, steps } from './steps';

export interface ProcessOptions {
  /** First step to run. Earlier steps keep the state they have. Default: `audio`. */
  fromStep?: StepName;
  /** False leaves the clip for a later, low-priority pass. Default: true. */
  includeClip?: boolean;
  /** Receives progress lines. Default: the server log. */
  log?: (message: string) => void;
}

function defaultLog(message: string): void {
  if (process.env.NODE_ENV !== 'test') console.log(`[pipeline] ${message}`);
}

/** The first step still waiting to run, so interrupted or re-queued work resumes there. */
export function resumeStep(status: CommentStatus): StepName {
  return STEP_ORDER.find((name) => status.steps[name] === 'pending') ?? 'clip';
}

async function loadProbe(ref: CommentRef, meta: CommentMeta): Promise<ProbeInfo | null> {
  try {
    return await readJson<ProbeInfo>(join(versionDir(ref.videoId, meta.version), 'probe.json'));
  } catch {
    return null;
  }
}

/**
 * Runs the pipeline steps for one comment, in order, recording each outcome in status.json.
 *
 * - No speech: state `empty`, the remaining steps `skipped`.
 * - The audio cannot be assembled: nothing later can work, so the rest is `skipped`.
 * - Any other failed step (a Groq outage, say) is recorded and the later steps still run.
 * - General comments have no picture, so their render steps are `skipped`.
 *
 * The final state is `done` if no step failed, else `failed`, and `error` holds the first
 * failure. A pending clip does not hold the comment back: it is `done` once the rest is.
 * This never throws for a step failure.
 */
export async function processComment(ref: CommentRef, opts: ProcessOptions = {}): Promise<void> {
  const includeClip = opts.includeClip ?? true;
  const fromIndex = Math.max(0, STEP_ORDER.indexOf(opts.fromStep ?? 'audio'));
  const say = opts.log ?? defaultLog;
  const dir = commentDir(ref);

  const meta = await readCommentMeta(ref).catch(() => null);
  if (meta === null) {
    await updateStatus(ref, { state: 'failed', error: 'meta.json is missing or unreadable.' });
    return;
  }

  const before = (await readStatus(ref)) ?? initialStatus();
  const todo = STEP_ORDER.slice(fromIndex);
  // A pass that only renders the clip (or only settles the state) is not a new attempt, and
  // the comment stays `done` for the export while its clip renders.
  const clipOnly = todo.length === 1;
  const earlierFailure = STEP_ORDER.slice(0, fromIndex).some((s) => before.steps[s] === 'failed');
  let firstError: string | null = earlierFailure ? before.error : null;

  const reset: Partial<Record<StepName, StepState>> = {};
  for (const name of todo) {
    if (name === 'clip' && !includeClip && clipOnly) continue;
    reset[name] = 'pending';
  }
  await updateStatus(ref, {
    steps: reset,
    ...(clipOnly ? {} : { state: 'processing', error: firstError, attempts: before.attempts + 1 }),
  });

  const probe = await loadProbe(ref, meta);
  const contextFor = (log: (message: string) => void): StepContext => ({
    ref,
    dir,
    meta,
    log,
    // Lazy, so a missing probe only fails the steps that need the picture.
    get probe(): ProbeInfo {
      if (probe === null) {
        throw new Error(`probe.json is missing for version ${meta.version} of this video.`);
      }
      return probe;
    },
  });

  let stopped: 'empty' | 'failed' | null = null;
  for (const name of todo) {
    const noPicture = meta.kind === 'general' && (name === 'stills' || name === 'clip');
    if (stopped !== null || noPicture) {
      await updateStatus(ref, { steps: { [name]: 'skipped' } });
      continue;
    }
    if (name === 'clip' && !includeClip) continue;

    const log = (message: string) => say(`${ref.commentId} ${name}: ${message}`);
    try {
      await steps[name](contextFor(log));
      await updateStatus(ref, { steps: { [name]: 'done' } });
    } catch (err) {
      if (err instanceof EmptyCommentError) {
        stopped = 'empty';
        await updateStatus(ref, { steps: { [name]: 'done' } });
        log('no speech, nothing more to do');
        continue;
      }
      const message = err instanceof Error ? err.message : String(err);
      firstError ??= message;
      if (name === 'audio') stopped = 'failed';
      await updateStatus(ref, { steps: { [name]: 'failed' }, error: firstError });
      log(`failed: ${message}`);
    }
  }

  const after = (await readStatus(ref)) ?? before;
  const failed = STEP_ORDER.some((name) => after.steps[name] === 'failed');
  const state = stopped === 'empty' ? 'empty' : failed ? 'failed' : 'done';
  await updateStatus(ref, { state, error: state === 'failed' ? firstError : null });
}

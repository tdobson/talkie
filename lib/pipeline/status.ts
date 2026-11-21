import { join } from 'node:path';
import { readJson, writeJsonAtomic } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import type { CommentRef, CommentStatus } from '@/lib/types';
import { FILES } from './steps/types';

export type { StepContext, StepFn } from './steps/types';

export type StatusPatch = Partial<Omit<CommentStatus, 'steps'>> & {
  steps?: Partial<CommentStatus['steps']>;
};

const statusPath = (ref: CommentRef) => join(commentDir(ref), FILES.status);

export function initialStatus(): CommentStatus {
  return {
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
    updatedAt: new Date().toISOString(),
  };
}

export async function readStatus(ref: CommentRef): Promise<CommentStatus | null> {
  const stored = await readJson<Partial<CommentStatus>>(statusPath(ref));
  if (stored === null) return null;
  // Older or hand-edited files may lack a step; fill the gaps so callers can rely on the shape.
  const base = initialStatus();
  return { ...base, ...stored, steps: { ...base.steps, ...stored.steps } };
}

// Updates to one comment are read-modify-write, so they run one after another within this
// process. The server is the only writer while a comment is being processed.
const tails = new Map<string, Promise<unknown>>();

/** Merges `patch` into the stored status (`steps` key by key) and stamps `updatedAt`. */
export async function updateStatus(ref: CommentRef, patch: StatusPatch): Promise<CommentStatus> {
  const path = statusPath(ref);
  const previous = tails.get(path) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const current = (await readStatus(ref)) ?? initialStatus();
      const merged: CommentStatus = {
        ...current,
        ...patch,
        steps: { ...current.steps, ...patch.steps },
        updatedAt: new Date().toISOString(),
      };
      await writeJsonAtomic(path, merged);
      return merged;
    });
  tails.set(path, next);
  try {
    return await next;
  } finally {
    if (tails.get(path) === next) tails.delete(path);
  }
}

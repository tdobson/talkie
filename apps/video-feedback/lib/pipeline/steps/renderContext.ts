import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureEvent, CommentMeta, CommentRef, ProbeInfo } from '@/lib/types';

/**
 * What the render steps need from the pipeline's StepContext ({ ref, dir, meta, probe, log }).
 * Declared structurally so the stills and clip steps are assignable to the pipeline's StepFn.
 * `dir` is the comment directory; `probe` describes the session's source video.
 */
export interface RenderStepContext {
  ref: CommentRef;
  dir: string;
  meta: CommentMeta;
  probe: ProbeInfo;
  log?: (message: string) => void;
}

export const renderDir = (dir: string): string => join(dir, 'render');

/** The merged event log written by the audio step. A comment with no events has none. */
export async function readEvents(dir: string): Promise<CaptureEvent[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(dir, 'events.json'), 'utf8'));
    return Array.isArray(parsed) ? (parsed as CaptureEvent[]) : [];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

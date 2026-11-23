import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/lib/config';

// What the processing worker is doing, written by the worker every few seconds and read by the
// server: for the admin page, and to leave alone a comment that is being worked on right now.

export interface LaneStatus {
  /** The job running now, and since when (ISO). */
  running: { videoId: string; sessionId: string; commentId: string; since: string } | null;
  /** Jobs waiting behind it. */
  waiting: number;
}

export interface PipelineStatus {
  pid: number;
  updatedAt: string;
  comments: LaneStatus;
  clips: LaneStatus;
}

export const STATUS_NAME = 'pipeline-status.json';
const path = () => join(/* turbopackIgnore: true */ config().dataDir, STATUS_NAME);

export async function writePipelineStatus(status: PipelineStatus): Promise<void> {
  const tmp = `${path()}.tmp`;
  await writeFile(tmp, JSON.stringify(status));
  await rename(tmp, path());
}

/** The last status the worker wrote, or null (no worker has run, or it is unreadable). */
export async function readPipelineStatus(): Promise<PipelineStatus | null> {
  try {
    return JSON.parse(await readFile(path(), 'utf8')) as PipelineStatus;
  } catch {
    return null;
  }
}

/** True when the worker's last status (if fresh) shows this comment being worked on. */
export function isWorkingOn(status: PipelineStatus | null, commentId: string, now = Date.now()) {
  if (status === null || now - Date.parse(status.updatedAt) > 60_000) return false;
  return [status.comments.running, status.clips.running].some((r) => r?.commentId === commentId);
}

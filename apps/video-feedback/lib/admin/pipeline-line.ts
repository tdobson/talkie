import type { PipelineStatus } from '@/lib/pipeline/pipeline-status';

/** Older than this, the worker's status means it is not running. */
const STALE_MS = 60_000;

function ago(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return minutes < 1 ? 'under a minute' : minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/**
 * One line for the admin page about comment processing: what it is working on, how much is
 * waiting, or that it is not running. So "no feedback yet" is never a stuck queue in disguise.
 */
export function pipelineLine(
  status: PipelineStatus | null,
  now = Date.now()
): {
  text: string;
  tone: 'ok' | 'busy' | 'down';
} {
  if (status === null) return { text: 'Comment processing has not started yet.', tone: 'down' };
  if (now - Date.parse(status.updatedAt) > STALE_MS) {
    return {
      text: `Comment processing is not running (last seen ${ago(status.updatedAt, now)} ago).`,
      tone: 'down',
    };
  }
  const { comments, clips } = status;
  const parts: string[] = [];
  if (comments.running) {
    parts.push(`processing a comment (for ${ago(comments.running.since, now)})`);
  }
  if (comments.waiting > 0) {
    parts.push(`${comments.waiting} comment${comments.waiting === 1 ? '' : 's'} waiting`);
  }
  if (clips.running) parts.push(`rendering a clip (for ${ago(clips.running.since, now)})`);
  if (clips.waiting > 0)
    parts.push(`${clips.waiting} clip${clips.waiting === 1 ? '' : 's'} waiting`);
  if (parts.length === 0)
    return { text: 'Comment processing is idle: everything is done.', tone: 'ok' };
  const text = parts.join(', ');
  return { text: `Comment processing: ${text}.`, tone: 'busy' };
}

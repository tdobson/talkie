import { join } from 'node:path';
import { readJson } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import { listComments, listSessions, readCommentMeta } from '@/lib/storage/repo';
import type { CommentRef, CommentStatus } from '@/lib/types';

/** One reviewer session with its comment counts, for the admin video page. */
export interface AdminSessionRow {
  sessionId: string;
  version: number;
  reviewerName: string;
  startedAt: string;
  doneAt: string | null;
  comments: number;
  emptyComments: number;
  failedComments: number;
}

async function readState(ref: CommentRef): Promise<CommentStatus['state'] | null> {
  try {
    return (await readJson<CommentStatus>(join(commentDir(ref), 'status.json')))?.state ?? null;
  } catch {
    // An unreadable status file must not take the whole page down.
    return null;
  }
}

/** Every session of a video with its comment counts, newest first. */
export async function summariseSessions(videoId: string): Promise<AdminSessionRow[]> {
  const rows: AdminSessionRow[] = [];
  for (const session of await listSessions(videoId)) {
    const row: AdminSessionRow = {
      sessionId: session.sessionId,
      version: session.version,
      reviewerName: session.reviewerName,
      startedAt: session.startedAt,
      doneAt: session.doneAt,
      comments: 0,
      emptyComments: 0,
      failedComments: 0,
    };
    for (const ref of await listComments(videoId, session.sessionId)) {
      const meta = await readCommentMeta(ref).catch(() => null);
      if (meta === null) continue;
      const state = await readState(ref);
      row.comments += 1;
      if (state === 'empty') row.emptyComments += 1;
      if (state === 'failed') row.failedComments += 1;
    }
    rows.push(row);
  }
  // ISO timestamps in UTC sort as plain strings.
  return rows.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

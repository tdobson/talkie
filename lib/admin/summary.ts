import { join } from 'node:path';
import { readJson } from '@/lib/storage/json';
import { commentDir } from '@/lib/storage/paths';
import { listComments, listSessions, listVideos, readCommentMeta } from '@/lib/storage/repo';
import type {
  AdminVersionSummary,
  AdminVideoSummary,
  CommentRef,
  CommentStatus,
  VideoRecord,
} from '@/lib/types';

function emptyVersion(version: number): AdminVersionSummary {
  return {
    version,
    sessions: 0,
    comments: 0,
    emptyComments: 0,
    failedComments: 0,
    pendingProcessing: 0,
    lastActivity: null,
  };
}

/** ISO timestamps in UTC sort as plain strings. */
function touch(summary: AdminVersionSummary, at: string | null | undefined): void {
  if (!at) return;
  if (summary.lastActivity === null || at > summary.lastActivity) summary.lastActivity = at;
}

async function readStatus(ref: CommentRef): Promise<CommentStatus | null> {
  try {
    return await readJson<CommentStatus>(join(commentDir(ref), 'status.json'));
  } catch {
    // An unreadable status file must not take the whole admin list down.
    return null;
  }
}

async function summariseVideo(video: VideoRecord, baseUrl: string): Promise<AdminVideoSummary> {
  const byVersion = new Map<number, AdminVersionSummary>();
  for (const v of video.versions) byVersion.set(v.version, emptyVersion(v.version));

  for (const session of await listSessions(video.videoId)) {
    let summary = byVersion.get(session.version);
    if (!summary) {
      summary = emptyVersion(session.version);
      byVersion.set(session.version, summary);
    }
    summary.sessions += 1;
    touch(summary, session.startedAt);
    touch(summary, session.doneAt);

    for (const ref of await listComments(video.videoId, session.sessionId)) {
      const meta = await readCommentMeta(ref).catch(() => null);
      if (meta === null) continue;
      const status = await readStatus(ref);
      summary.comments += 1;
      if (status?.state === 'empty') summary.emptyComments += 1;
      if (status?.state === 'failed') summary.failedComments += 1;
      // A comment still being uploaded ('receiving') is not waiting on the server.
      if (status?.state === 'queued' || status?.state === 'processing') {
        summary.pendingProcessing += 1;
      }
      touch(summary, meta.startedAt);
      touch(summary, meta.endedAt);
      touch(summary, status?.updatedAt);
    }
  }

  return {
    videoId: video.videoId,
    title: video.title,
    reviewUrl: `${baseUrl}/r/${video.token}`,
    latestVersion: video.latestVersion,
    versions: [...byVersion.values()].sort((a, b) => a.version - b.version),
  };
}

/** Every video with per-version counts, newest video first. */
export async function summariseVideos(publicBaseUrl: string): Promise<AdminVideoSummary[]> {
  const baseUrl = publicBaseUrl.replace(/\/+$/, '');
  const videos = (await listVideos()).reverse();
  const summaries: AdminVideoSummary[] = [];
  for (const video of videos) summaries.push(await summariseVideo(video, baseUrl));
  return summaries;
}

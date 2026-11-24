import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { FILES } from '@/lib/pipeline/steps/types';
import { commentsDir, sessionDir, sessionsDir, videoDir } from '@/lib/storage/paths';
import type { ExportOptions } from './model';

// A cheap stand-in for "has anything in this export changed?": file metadata only, nothing
// read or parsed. Every output a comment gets (transcript, moments, stills, clip) is followed
// by a write of its status.json, and each JSON write replaces the file (a new inode), so the
// status files, the sessions and the video record tell the whole story.

async function names(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    return [];
  }
}

async function mark(path: string): Promise<string> {
  try {
    const s = await stat(path);
    return `${s.ino}:${s.size}:${s.mtimeMs}`;
  } catch {
    return '-';
  }
}

/** A strong ETag for the export of one video with these options, from file metadata alone. */
export async function exportFingerprint(videoId: string, opts: ExportOptions): Promise<string> {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ v: 1, videoId, opts }));
  hash.update(await mark(join(videoDir(videoId), 'video.json')));
  for (const sessionId of await names(sessionsDir(videoId))) {
    hash.update(
      `s:${sessionId}:${await mark(join(sessionDir(videoId, sessionId), 'session.json'))}`
    );
    const comments = commentsDir(videoId, sessionId);
    for (const commentId of await names(comments)) {
      const dir = join(comments, commentId);
      hash.update(
        `c:${commentId}:${await mark(join(dir, FILES.status))}:${await mark(join(dir, 'meta.json'))}`
      );
    }
  }
  return `"${hash.digest('hex')}"`;
}

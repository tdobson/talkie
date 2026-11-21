import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommentMeta, CommentRef, SessionRecord, VideoRecord } from '@/lib/types';
import { isUuid, newToken, newVideoId } from './ids';
import { readJson, writeJsonAtomic } from './json';
import {
  commentDir,
  commentsDir,
  ID_RE,
  sessionDir,
  sessionsDir,
  videoDir,
  videosDir,
} from './paths';

async function listDirNames(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Reads one record for a listing. A record that cannot be read or parsed (a hand edit, a full
 * disk, a filesystem fault) is logged and left out, so it cannot take the whole list with it:
 * every review link and the admin pages depend on these lists.
 */
async function readForList<T>(what: string, read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (err) {
    console.error(`Skipping unreadable ${what}.`, err);
    return null;
  }
}

// Videos

const videoJson = (videoId: string) => join(videoDir(videoId), 'video.json');

export async function createVideo(title: string): Promise<VideoRecord> {
  // The 4 character suffix makes a clash unlikely; a few retries make it a non-issue.
  for (let attempt = 0; attempt < 10; attempt++) {
    const videoId = newVideoId(title);
    if ((await getVideo(videoId)) !== null) continue;
    const video: VideoRecord = {
      videoId,
      title,
      token: newToken(),
      createdAt: new Date().toISOString(),
      latestVersion: 0,
      versions: [],
    };
    await saveVideo(video);
    return video;
  }
  throw new Error('Could not allocate a video id.');
}

export async function getVideo(videoId: string): Promise<VideoRecord | null> {
  return readJson<VideoRecord>(videoJson(videoId));
}

export async function saveVideo(v: VideoRecord): Promise<void> {
  await writeJsonAtomic(videoJson(v.videoId), v);
  tokenIndex = null;
}

/** All videos, oldest first. Directories without a readable `video.json` are skipped. */
export async function listVideos(): Promise<VideoRecord[]> {
  const ids = (await listDirNames(videosDir())).filter((name) => ID_RE.test(name));
  const read = (id: string) => readForList(`video.json of ${id}`, () => getVideo(id));
  const videos = (await Promise.all(ids.map(read))).filter(
    (v): v is VideoRecord => v !== null && typeof v.createdAt === 'string'
  );
  return videos.sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.videoId.localeCompare(b.videoId)
  );
}

// Token lookup
//
// Review links are looked up on every reviewer request, so the token to videoId mapping is
// kept in memory. Only SHA-256 digests of the tokens are held, which gives equal-length
// buffers for `timingSafeEqual`. `saveVideo` drops the index. Another process (the import
// CLI) can also add a video, so a miss rebuilds the index, at most once per interval so that
// guessing tokens cannot make the server rescan the disk on every request.

interface TokenIndex {
  dataRoot: string;
  builtAt: number;
  entries: { videoId: string; digest: Buffer }[];
}

const TOKEN_INDEX_MISS_REBUILD_MS = 2000;
let tokenIndex: TokenIndex | null = null;

const digestOf = (token: string) => createHash('sha256').update(token).digest();

async function buildTokenIndex(): Promise<TokenIndex> {
  const videos = await listVideos();
  return {
    dataRoot: videosDir(),
    builtAt: Date.now(),
    entries: videos.map((v) => ({ videoId: v.videoId, digest: digestOf(v.token) })),
  };
}

function lookup(index: TokenIndex, digest: Buffer): string | null {
  let found: string | null = null;
  // No early exit: every entry is compared, each in constant time.
  for (const entry of index.entries) {
    if (timingSafeEqual(entry.digest, digest)) found = entry.videoId;
  }
  return found;
}

export async function findVideoByToken(token: string): Promise<VideoRecord | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return null;
  const digest = digestOf(token);

  let index = tokenIndex;
  if (index === null || index.dataRoot !== videosDir()) {
    index = tokenIndex = await buildTokenIndex();
  }
  let videoId = lookup(index, digest);
  if (videoId === null && Date.now() - index.builtAt >= TOKEN_INDEX_MISS_REBUILD_MS) {
    index = tokenIndex = await buildTokenIndex();
    videoId = lookup(index, digest);
  }
  if (videoId === null) return null;

  // Read the record fresh, and re-check: the index could be stale if the file changed on disk.
  const video = await getVideo(videoId);
  if (video === null || !timingSafeEqual(digestOf(video.token), digest)) return null;
  return video;
}

// Sessions

const sessionJson = (videoId: string, sessionId: string) =>
  join(sessionDir(videoId, sessionId), 'session.json');

export async function createSession(
  videoId: string,
  version: number,
  name: string,
  ua: string
): Promise<SessionRecord> {
  const session: SessionRecord = {
    sessionId: randomUUID(),
    videoId,
    version,
    reviewerName: name,
    userAgent: ua,
    startedAt: new Date().toISOString(),
    doneAt: null,
  };
  await saveSession(session);
  return session;
}

export async function getSession(
  videoId: string,
  sessionId: string
): Promise<SessionRecord | null> {
  return readJson<SessionRecord>(sessionJson(videoId, sessionId));
}

export async function saveSession(s: SessionRecord): Promise<void> {
  await writeJsonAtomic(sessionJson(s.videoId, s.sessionId), s);
}

/** All sessions of a video, oldest first. */
export async function listSessions(videoId: string): Promise<SessionRecord[]> {
  const ids = (await listDirNames(sessionsDir(videoId))).filter(isUuid);
  const read = (id: string) =>
    readForList(`session.json of ${videoId}/${id}`, () => getSession(videoId, id));
  const sessions = (await Promise.all(ids.map(read))).filter(
    (s): s is SessionRecord => s !== null && typeof s.startedAt === 'string'
  );
  return sessions.sort(
    (a, b) => a.startedAt.localeCompare(b.startedAt) || a.sessionId.localeCompare(b.sessionId)
  );
}

// Comments

const metaJson = (ref: CommentRef) => join(commentDir(ref), 'meta.json');

/** Every comment directory of a session, sorted by id. Order by time using the meta. */
export async function listComments(videoId: string, sessionId: string): Promise<CommentRef[]> {
  const ids = (await listDirNames(commentsDir(videoId, sessionId))).filter(isUuid).sort();
  return ids.map((commentId) => ({ videoId, sessionId, commentId }));
}

export async function readCommentMeta(ref: CommentRef): Promise<CommentMeta | null> {
  return readJson<CommentMeta>(metaJson(ref));
}

export async function writeCommentMeta(ref: CommentRef, meta: CommentMeta): Promise<void> {
  await writeJsonAtomic(metaJson(ref), meta);
}

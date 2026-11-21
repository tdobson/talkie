import { join } from 'node:path';
import { config } from '@/lib/config';
import type { CommentRef } from '@/lib/types';
import { isUuid } from './ids';

/** Video ids: lowercase slug, 3 to 64 characters. Session and comment ids are UUIDs. */
export const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

/**
 * Throws unless `id` is safe to use as a single path segment of the given kind.
 * Every path builder below calls this, so nothing from a URL reaches the file system unchecked.
 */
export function assertSafeId(id: string, kind: 'video' | 'session' | 'comment'): void {
  const ok = typeof id === 'string' && (kind === 'video' ? ID_RE.test(id) : isUuid(id));
  if (!ok) throw new Error(`Invalid ${kind} id.`);
}

function assertVersion(version: number): void {
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('Invalid version number.');
  }
}

export function inboxDir(): string {
  return join(config().dataDir, 'inbox');
}

/** Where an import is put together before it is moved into place. Same disk as `videosDir`. */
export function stagingDir(): string {
  return join(config().dataDir, 'staging');
}

export function videosDir(): string {
  return join(config().dataDir, 'videos');
}

export function videoDir(videoId: string): string {
  assertSafeId(videoId, 'video');
  return join(videosDir(), videoId);
}

export function versionDir(videoId: string, version: number): string {
  assertVersion(version);
  return join(videoDir(videoId), 'versions', String(version));
}

export function sourcePath(videoId: string, version: number): string {
  return join(versionDir(videoId, version), 'source.mp4');
}

/** A Talkie version's film, unpacked: the files the film route serves. */
export function filmDir(videoId: string, version: number): string {
  return join(versionDir(videoId, version), 'film');
}

/** A Talkie version's film as one packed .lottie file. */
export function filmPackedPath(videoId: string, version: number): string {
  return join(versionDir(videoId, version), 'film.lottie');
}

export function sessionsDir(videoId: string): string {
  return join(videoDir(videoId), 'sessions');
}

export function sessionDir(videoId: string, sessionId: string): string {
  assertSafeId(sessionId, 'session');
  return join(sessionsDir(videoId), sessionId);
}

export function commentsDir(videoId: string, sessionId: string): string {
  return join(sessionDir(videoId, sessionId), 'comments');
}

export function commentDir(ref: CommentRef): string {
  assertSafeId(ref.commentId, 'comment');
  return join(commentsDir(ref.videoId, ref.sessionId), ref.commentId);
}

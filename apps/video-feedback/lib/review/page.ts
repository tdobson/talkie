import { join } from 'node:path';
import { validateFilm } from '@talkie/format';
import { mediaKindOf } from '@/lib/media-kind';
import { readJson } from '@/lib/storage/json';
import { filmDir, versionDir } from '@/lib/storage/paths';
import type { MediaKind, ProbeInfo } from '@/lib/types';
import { FILM_JSON } from '@/lib/videos/film';
import { resolveToken } from './service';

/** Used for frame stepping when a version has no usable probe.json: 25 frames a second. */
export const DEFAULT_FRAME_DURATION = 1 / 25;

export interface ReviewPageData {
  title: string;
  latestVersion: number;
  /** Frame duration of the latest version. */
  frameDuration: number;
  /**
   * Frame duration of every version, by version number. A session resumed on an older version
   * plays that version's file, so it must step by that version's frames.
   */
  frameDurations: Record<number, number>;
  /**
   * Media kind of every version, by version number. Left off a video that has only MP4
   * versions: read a missing map, or a missing entry, as `'mp4'`.
   */
  mediaKinds?: Record<number, MediaKind>;
  /**
   * Poster image URL of each Talkie version, by version number, served by the film route. A
   * version with no entry has no poster to show. Left off with `mediaKinds`.
   */
  posterUrls?: Record<number, string>;
}

/** The URL of one file of a Talkie version's film, as the film route serves it. */
export function filmFileUrl(token: string, version: number, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `/api/r/${encodeURIComponent(token)}/film/${version}/${encoded}`;
}

async function posterUrlOf(
  token: string,
  videoId: string,
  version: number
): Promise<string | null> {
  try {
    const result = validateFilm(
      await readJson<unknown>(join(filmDir(videoId, version), FILM_JSON))
    );
    return result.ok ? filmFileUrl(token, version, result.film.poster.png) : null;
  } catch {
    // A film that cannot be read fails in the player, which says so. The page still renders.
    return null;
  }
}

async function frameDurationOf(videoId: string, version: number): Promise<number> {
  try {
    const probe = await readJson<ProbeInfo>(join(versionDir(videoId, version), 'probe.json'));
    const d = probe?.frameDuration;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0 && d <= 1) return d;
  } catch {
    // A broken probe file only costs exact frame stepping.
  }
  return DEFAULT_FRAME_DURATION;
}

/** What the reviewer page needs to render, or null if the link is not valid. */
export async function loadReviewPage(token: string): Promise<ReviewPageData | null> {
  const video = await resolveToken(token);
  if (video === null || video.latestVersion < 1) return null;

  const versions = new Set([...video.versions.map((v) => v.version), video.latestVersion]);
  const frameDurations: Record<number, number> = {};
  for (const version of versions) {
    frameDurations[version] = await frameDurationOf(video.videoId, version);
  }
  const page: ReviewPageData = {
    title: video.title,
    latestVersion: video.latestVersion,
    frameDuration: frameDurations[video.latestVersion],
    frameDurations,
  };
  if (!video.versions.some((v) => mediaKindOf(v) === 'talkie')) return page;

  const mediaKinds: Record<number, MediaKind> = {};
  const posterUrls: Record<number, string> = {};
  for (const record of video.versions) {
    mediaKinds[record.version] = mediaKindOf(record);
    if (mediaKinds[record.version] !== 'talkie') continue;
    const url = await posterUrlOf(video.token, video.videoId, record.version);
    if (url !== null) posterUrls[record.version] = url;
  }
  return { ...page, mediaKinds, posterUrls };
}

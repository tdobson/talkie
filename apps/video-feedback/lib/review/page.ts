import { join } from 'node:path';
import { readJson } from '@/lib/storage/json';
import { versionDir } from '@/lib/storage/paths';
import type { ProbeInfo } from '@/lib/types';
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
  return {
    title: video.title,
    latestVersion: video.latestVersion,
    frameDuration: frameDurations[video.latestVersion],
    frameDurations,
  };
}

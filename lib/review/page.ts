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
  frameDuration: number;
}

/** What the reviewer page needs to render, or null if the link is not valid. */
export async function loadReviewPage(token: string): Promise<ReviewPageData | null> {
  const video = await resolveToken(token);
  if (video === null || video.latestVersion < 1) return null;

  let frameDuration = DEFAULT_FRAME_DURATION;
  try {
    const probe = await readJson<ProbeInfo>(
      join(versionDir(video.videoId, video.latestVersion), 'probe.json')
    );
    const d = probe?.frameDuration;
    if (typeof d === 'number' && Number.isFinite(d) && d > 0 && d <= 1) frameDuration = d;
  } catch {
    // A broken probe file only costs exact frame stepping.
  }
  return { title: video.title, latestVersion: video.latestVersion, frameDuration };
}

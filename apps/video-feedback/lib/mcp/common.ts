import { ID_RE } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import type { VideoRecord } from '@/lib/types';
import { type PropSchema, ToolError } from './types';

// Arguments and checks that several tools share.

export const VIDEO_ID_PROP: PropSchema = {
  type: 'string',
  description:
    'The video id, as list_videos gives it (for example "roof-how-a-batten-gauge-works-x1y2").',
  maxLength: 64,
};

export const VERSION_PROP: PropSchema = {
  type: ['integer', 'string'],
  description:
    'Which version of the video: a version number, "latest" (the default) or "all". Each new cut imported is the next version.',
};

/** A version argument as the export reads it. Throws a ToolError the model can act on. */
export function parseVersion(value: unknown): number | 'latest' | 'all' {
  if (value === undefined || value === 'latest') return 'latest';
  if (value === 'all') return 'all';
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1) return value;
  if (typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value)) return Number(value);
  throw new ToolError('"version" must be a version number, "latest" or "all".');
}

/** The video, or a ToolError that says how to find the right id. */
export async function requireVideo(videoId: unknown): Promise<VideoRecord> {
  const video = typeof videoId === 'string' && ID_RE.test(videoId) ? await getVideo(videoId) : null;
  if (video === null) {
    throw new ToolError(
      `There is no video "${String(videoId)}". list_videos shows every video and its id.`
    );
  }
  return video;
}

export function reviewUrlOf(video: VideoRecord, baseUrl: string): string {
  return `${baseUrl}/r/${video.token}`;
}

/** 'mp4' or 'talkie' for one version. Versions from before Talkie support are MP4. */
export function kindOf(video: VideoRecord, version: number): 'mp4' | 'talkie' {
  return video.versions.find((v) => v.version === version)?.mediaKind ?? 'mp4';
}

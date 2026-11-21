import { join } from 'node:path';
import { mediaKindOf } from '@/lib/media-kind';
import { readJson } from '@/lib/storage/json';
import { filmDir, sourcePath } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import type { FrameSource, FrameSourceFactory } from './frame-source';
import { ffmpegFrameSource } from './frame-source-ffmpeg';
import { talkieFrameSource } from './frame-source-talkie';

async function filmSize(dir: string, version: number): Promise<{ width: number; height: number }> {
  const film = await readJson<{ size?: unknown }>(join(dir, 'talkie.json')).catch(() => null);
  const size = film?.size;
  if (
    Array.isArray(size) &&
    size.length === 2 &&
    size.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
  ) {
    return { width: size[0] as number, height: size[1] as number };
  }
  throw new Error(`The film for version ${version} of this video is missing or cannot be read.`);
}

/** Builds the factory. Tests pass their own Talkie source so that no browser starts. */
export function frameSourceFactory(
  deps: {
    talkie?: (filmDir: string, size: { width: number; height: number }) => FrameSource;
  } = {}
): FrameSourceFactory {
  const talkie = deps.talkie ?? ((dir, size) => talkieFrameSource(dir, size));
  return async (videoId, version) => {
    // The path builders check both ids, so this runs before anything is read.
    const mp4 = sourcePath(videoId, version);
    const video = await getVideo(videoId);
    const record = video?.versions.find((v) => v.version === version);
    // A version with no record, or one written before Talkie support, is an MP4.
    if (!record || mediaKindOf(record) === 'mp4') return ffmpegFrameSource(mp4);
    const dir = filmDir(videoId, version);
    return talkie(dir, await filmSize(dir, version));
  };
}

/**
 * Where the stills and the clip of a comment get their frames: ffmpeg for an MP4 version, a
 * headless browser for a Talkie version. The caller must `close()` what it is given.
 */
export const frameSourceFor: FrameSourceFactory = frameSourceFactory();

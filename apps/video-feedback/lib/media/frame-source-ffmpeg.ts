import type { FrameSource } from './frame-source';
import { extractFrame } from './ops';

/** Frames of an MP4 on disk, decoded by ffmpeg. Each call is its own short-lived process. */
export function ffmpegFrameSource(path: string): FrameSource {
  return {
    frame: (vt, maxWidth) => extractFrame(path, vt, maxWidth),
    async close() {},
  };
}

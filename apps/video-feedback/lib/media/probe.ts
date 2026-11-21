import type { ProbeInfo } from '@/lib/types';
import { limits } from '@/lib/limits';
import { runOk } from './run';

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
  disposition?: { attached_pic?: number };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { format_name?: string; duration?: string };
}

async function ffprobe(file: string): Promise<FfprobeOutput> {
  const r = await runOk(
    'ffprobe',
    ['-v', 'error', '-of', 'json', '-show_format', '-show_streams', file],
    { timeoutMs: limits.probeTimeoutMs }
  );
  return JSON.parse(r.stdout.toString('utf8')) as FfprobeOutput;
}

/** Parses an ffprobe rate such as "25/1" or "30000/1001". Returns 0 when unknown. */
function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split('/').map(Number);
  const fps = d === undefined ? n : n / d;
  return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

function parseSeconds(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export async function probe(file: string): Promise<ProbeInfo> {
  const data = await ffprobe(file);
  const streams = data.streams ?? [];
  // Cover art counts as a video stream in ffprobe; skip it.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new Error('No video stream found in file');
  const fps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate);
  if (fps <= 0) throw new Error('Could not read the frame rate of the video');
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps,
    frameDuration: 1 / fps,
    duration: parseSeconds(data.format?.duration) || parseSeconds(video.duration),
    codec: video.codec_name ?? 'unknown',
    pixFmt: video.pix_fmt ?? 'unknown',
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  };
}

/** ffprobe's format name, e.g. "mov,mp4,m4a,3gp,3g2,mj2". Pass it to checkBrowserSafe. */
export async function probeContainer(file: string): Promise<string> {
  return (await ffprobe(file)).format?.format_name ?? '';
}

export function checkBrowserSafe(
  p: ProbeInfo,
  container: string
): { ok: true } | { ok: false; reason: string } {
  if (!container.toLowerCase().includes('mp4'))
    return { ok: false, reason: 'Video must be an MP4 file' };
  if (p.codec !== 'h264')
    return { ok: false, reason: `Video must be H.264 (this file is ${p.codec})` };
  if (p.pixFmt !== 'yuv420p' && p.pixFmt !== 'yuvj420p')
    return {
      ok: false,
      reason: 'Video is 10-bit or uses an unusual colour format; export as 8-bit 4:2:0 H.264',
    };
  if (!(p.duration > 0)) return { ok: false, reason: 'Video has no duration' };
  return { ok: true };
}

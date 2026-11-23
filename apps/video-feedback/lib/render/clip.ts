import { once } from 'node:events';
import { rename, rm } from 'node:fs/promises';
import { CLIP_FPS, CLIP_MAX_WIDTH } from '@/lib/constants';
import { visibleRegion } from '@/lib/geometry';
import type { FrameSource } from '@/lib/media/frame-source';
import { audioDuration } from '@/lib/media/ops';
import { limits } from '@/lib/limits';
import { spawnLowPrio, stderrTail } from '@/lib/media/run';
import { zoomAt } from '@/lib/moments';
import type { CaptureEvent, CommentMeta, ProbeInfo, Rect } from '@/lib/types';
import { AMBER, overlaySvg, pointerSvg, trailSvg } from './overlay';
import { sharp } from './sharp';
import { isPointerEvent, pointerSize } from './stills';

const TRAIL_MS = 1000;
const VT_EPSILON = 1e-4;
// Decoded frames kept in memory at once (1280x720 RGB is about 2.8 MB each).
const FRAME_CACHE_SIZE = 24;
const FULL: Rect = { x: 0, y: 0, width: 1, height: 1 };

/** Output size: width capped at CLIP_MAX_WIDTH, both dimensions even (yuv420p needs that). */
export function clipSize(probe: Pick<ProbeInfo, 'width' | 'height'>): { w: number; h: number } {
  const even = (v: number): number => Math.max(2, Math.floor(v / 2) * 2);
  const w = even(Math.min(CLIP_MAX_WIDTH, probe.width));
  const h = even(Math.round((w * probe.height) / probe.width));
  return { w, h };
}

/** What one output frame shows. Two frames with the same state are the same picture. */
interface FrameState {
  vt: number;
  region: Rect; // part of the picture on screen, normalised
  pointer: { x: number; y: number } | null; // output pixels
  trail: { x: number; y: number }[]; // output pixels
}

function stateAt(
  events: CaptureEvent[],
  t: number,
  startVt: number,
  maxVt: number,
  w: number,
  h: number
): FrameState {
  // Video time follows seeks; pointer samples carry it too, which covers any step that was
  // logged without a seek event.
  let vt = startVt;
  let pointer: Extract<CaptureEvent, { type: 'pointer' | 'click' }> | null = null;
  for (const e of events) {
    if (e.t > t) break;
    if (e.type === 'seek') vt = e.to;
    else if (isPointerEvent(e)) {
      vt = e.vt;
      pointer = e;
    }
  }
  vt = Math.min(Math.max(0, vt), maxVt);
  const zoom = zoomAt(events, t);
  const region = zoom ? visibleRegion(zoom) : FULL;
  const toPx = (p: { x: number; y: number }) => ({
    x: Math.round(((p.x - region.x) / region.width) * w),
    y: Math.round(((p.y - region.y) / region.height) * h),
  });
  const trail = events
    .filter(isPointerEvent)
    .filter((e) => e.t >= t - TRAIL_MS && e.t <= t && Math.abs(e.vt - vt) < VT_EPSILON)
    .map(toPx);
  return { vt, region, pointer: pointer ? toPx(pointer) : null, trail };
}

/**
 * Reconstructed clip of a comment: for every output frame, the video frame the reviewer was
 * looking at (cropped and scaled while they were zoomed in) with the pointer and its last
 * second of trail, set to the comment audio. Frames are composed here and piped to ffmpeg as
 * raw RGB.
 */
export async function renderClip(opts: {
  source: FrameSource;
  audio: string;
  meta: CommentMeta;
  events: CaptureEvent[];
  probe: ProbeInfo;
  out: string;
}): Promise<void> {
  const { source, audio, meta, probe, out } = opts;
  const events = [...opts.events].sort((a, b) => a.t - b.t);
  const { w, h } = clipSize(probe);
  const raw = { raw: { width: w, height: h, channels: 3 as const } };

  const claimedS =
    meta.durationMs !== null && meta.durationMs > 0
      ? meta.durationMs / 1000
      : await audioDuration(audio);
  // The length comes from the reviewer's browser: it is held to the longest comment allowed,
  // and the audio is cut to match, so one comment cannot keep the queue busy for hours.
  const maxS = limits.commentDurationMs / 1000;
  const durationS = Math.min(claimedS, maxS);
  const totalFrames = Math.max(1, Math.ceil(durationS * CLIP_FPS));
  const deadline = Date.now() + limits.clipTimeoutMs;
  // General comments have no paused frame; they are recorded at the end of the video.
  const startVt = meta.pausedAtVideoTime ?? probe.duration;

  // Each distinct video time is decoded once.
  const frames = new Map<string, Promise<Buffer>>();
  const baseFrame = (vt: number): Promise<Buffer> => {
    const key = vt.toFixed(4);
    let hit = frames.get(key);
    if (hit) {
      frames.delete(key); // re-insert: most recently used last
    } else {
      hit = source
        .frame(vt, w)
        .then((png) => sharp(png).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer());
      if (frames.size >= FRAME_CACHE_SIZE) frames.delete(frames.keys().next().value as string);
    }
    frames.set(key, hit);
    return hit;
  };

  const compose = async (s: FrameState): Promise<Buffer> => {
    let img = sharp(await baseFrame(s.vt), raw);
    if (s.region !== FULL) {
      const cw = Math.max(1, Math.min(w, Math.round(s.region.width * w)));
      const ch = Math.max(1, Math.min(h, Math.round(s.region.height * h)));
      const left = Math.min(w - cw, Math.max(0, Math.round(s.region.x * w)));
      const top = Math.min(h - ch, Math.max(0, Math.round(s.region.y * h)));
      const zoomed = await img
        .extract({ left, top, width: cw, height: ch })
        .resize(w, h, { fit: 'fill' })
        .raw()
        .toBuffer();
      img = sharp(zoomed, raw);
    }
    const parts = [
      trailSvg(s.trail, w, h, { fade: true, colour: AMBER }),
      s.pointer ? pointerSvg(s.pointer.x, s.pointer.y, pointerSize(w, h)) : '',
    ].filter(Boolean);
    if (parts.length === 0) return img.raw().toBuffer();
    return img
      .composite([{ input: Buffer.from(overlaySvg(w, h, parts)), top: 0, left: 0 }])
      .removeAlpha()
      .raw()
      .toBuffer();
  };

  const tmp = `${out}.tmp`;
  const child = spawnLowPrio('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-s',
    `${w}x${h}`,
    '-r',
    String(CLIP_FPS),
    '-i',
    '-',
    '-t',
    maxS.toFixed(3),
    '-i',
    audio,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-threads',
    '2',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    tmp,
  ]);
  const stdin = child.stdin;
  if (!stdin) throw new Error('ffmpeg could not be started for the clip.');

  const err: Buffer[] = [];
  child.stderr?.on('data', (c: Buffer) => err.push(c));
  child.stdout?.resume();
  let exited = false;
  const closed = new Promise<number>((resolve, reject) => {
    child.on('error', (e) => {
      exited = true;
      reject(e);
    });
    child.on('close', (code, signal) => {
      exited = true;
      resolve(code ?? (signal ? 128 : 1));
    });
  });
  closed.catch(() => {}); // always awaited below; this only stops an unhandled-rejection report
  // ffmpeg may exit before reading every frame (EPIPE); its exit code tells the story.
  stdin.on('error', () => {});

  // A hard stop at the deadline: it fires even if a frame never comes back (a hung decode), so
  // the render can never hold the queue past its limit.
  const tooLong = () =>
    new Error(
      `The clip passed its time limit of ${Math.round(limits.clipTimeoutMs / 1000)}s and was stopped.`
    );
  let hardStop: ReturnType<typeof setTimeout> | undefined;
  const stopped = new Promise<never>((_, reject) => {
    hardStop = setTimeout(
      () => {
        if (!exited) child.kill('SIGKILL');
        reject(tooLong());
      },
      Math.max(0, deadline - Date.now())
    );
  });
  stopped.catch(() => {}); // raced below; this only stops an unhandled-rejection report
  const inTime = <V>(p: Promise<V>): Promise<V> => Promise.race([p, stopped]);

  try {
    let lastKey = '';
    let lastFrame: Buffer | null = null;
    const overTime = () => {
      if (Date.now() > deadline) throw tooLong();
    };
    for (let i = 0; i < totalFrames && !exited; i++) {
      overTime();
      const state = stateAt(events, (i * 1000) / CLIP_FPS, startVt, probe.duration, w, h);
      const key = JSON.stringify(state);
      if (key !== lastKey || !lastFrame) {
        lastFrame = await inTime(compose(state));
        lastKey = key;
      }
      if (exited) break;
      if (!stdin.write(lastFrame)) {
        await inTime(Promise.race([once(stdin, 'drain').catch(() => {}), closed.catch(() => {})]));
      }
    }
    stdin.end();
    // ffmpeg still has to finish encoding: that wait is under the same limit.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<'expired'>((resolve) => {
      timer = setTimeout(() => resolve('expired'), Math.max(0, deadline - Date.now()));
    });
    const code = await Promise.race([closed, expired]).finally(() => clearTimeout(timer));
    if (code === 'expired') throw tooLong();
    if (code !== 0) {
      const stderr = Buffer.concat(err).toString('utf8');
      throw new Error(`ffmpeg failed (exit ${code}): ${stderrTail(stderr)}`);
    }
    await rename(tmp, out);
  } catch (e) {
    if (!exited) {
      child.kill('SIGKILL');
      await closed.catch(() => {});
    }
    await rm(tmp, { force: true });
    throw e;
  } finally {
    clearTimeout(hardStop);
  }
}

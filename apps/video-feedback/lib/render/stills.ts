import { STILL_MAX_WIDTH } from '@/lib/constants';
import { visibleRegion } from '@/lib/geometry';
import type { FrameSource } from '@/lib/media/frame-source';
import type { CaptureEvent, CommentMeta, Moment, ProbeInfo } from '@/lib/types';
import {
  AMBER,
  boxSvg,
  CYAN,
  overlaySvg,
  type Point,
  pointerSvg,
  ringsSvg,
  trailSvg,
} from './overlay';
import { sharp } from './sharp';

const JPEG_QUALITY = 85;
const TRAIL_MS = 1000;
const VT_EPSILON = 1e-4;

type PointerEvent = Extract<CaptureEvent, { type: 'pointer' | 'click' }>;

export const isPointerEvent = (e: CaptureEvent): e is PointerEvent =>
  e.type === 'pointer' || e.type === 'click';

/** Pointer arrow size for an output of the given size. */
export function pointerSize(w: number, h: number): number {
  return Math.max(24, Math.round(Math.min(w, h) / 22));
}

/** Talkie films are drawn at whatever size is asked for: their probe says `pixFmt: 'vector'`. */
export function isVector(probe: Pick<ProbeInfo, 'pixFmt'>): boolean {
  return probe.pixFmt === 'vector';
}

export function ringRadius(w: number, h: number): number {
  return Math.max(10, Math.round(Math.min(w, h) / 30));
}

async function frameSize(png: Buffer): Promise<{ w: number; h: number }> {
  const meta = await sharp(png).metadata();
  return { w: meta.width, h: meta.height };
}

async function composeJpeg(frame: Buffer, w: number, h: number, parts: string[]): Promise<Buffer> {
  const svg = overlaySvg(w, h, parts);
  return sharp(frame)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .removeAlpha()
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

/**
 * Still for one key moment: the frame at `m.vt` with the pointer, the last second of its trail
 * and rings for clicks in that second. When the reviewer was zoomed in, the full still also
 * shows the zoomed area as a box, and `zoom` is the crop they were looking at.
 */
export async function renderMomentStill(
  source: FrameSource,
  m: Moment,
  events: CaptureEvent[],
  probe: ProbeInfo
): Promise<{ full: Buffer; zoom: Buffer | null }> {
  const frame = await source.frame(m.vt, STILL_MAX_WIDTH);
  const { w, h } = await frameSize(frame);
  const px = (p: { x: number; y: number }): Point => ({ x: p.x * w, y: p.y * h });

  const recent = events
    .filter(isPointerEvent)
    .filter((e) => e.t >= m.t - TRAIL_MS && e.t <= m.t && Math.abs(e.vt - m.vt) < VT_EPSILON)
    .sort((a, b) => a.t - b.t);
  const trail = [...recent.map(px), px(m)];
  const clicks = recent.filter((e) => e.type === 'click').map(px);
  const size = pointerSize(w, h);
  const region = m.zoom ? visibleRegion(m.zoom) : null;

  const full = await composeJpeg(frame, w, h, [
    region ? boxSvg(region, w, h) : '',
    trailSvg(trail, w, h, { fade: true, colour: AMBER }),
    ringsSvg(clicks, ringRadius(w, h)),
    pointerSvg(m.x * w, m.y * h, size),
  ]);
  if (!region) return { full, zoom: null };

  // A video crop comes from source pixels: never upscaled, and not limited by STILL_MAX_WIDTH.
  // A vector film has no source pixels, so the whole frame is drawn again at the still width
  // times the zoom, and the crop is as sharp as the still.
  const zoomWidth = isVector(probe) ? Math.ceil(w * (m.zoom?.scale ?? 1)) : probe.width;
  const native = zoomWidth > w ? await source.frame(m.vt, zoomWidth) : frame;
  const { w: nw, h: nh } = native === frame ? { w, h } : await frameSize(native);
  const cw = Math.max(1, Math.min(nw, Math.round(region.width * nw)));
  const ch = Math.max(1, Math.min(nh, Math.round(region.height * nh)));
  const left = Math.min(nw - cw, Math.max(0, Math.round(region.x * nw)));
  const top = Math.min(nh - ch, Math.max(0, Math.round(region.y * nh)));
  const crop = await sharp(native).extract({ left, top, width: cw, height: ch }).png().toBuffer();
  const zoom = await composeJpeg(crop, cw, ch, [
    pointerSvg(m.x * nw - left, m.y * nh - top, pointerSize(cw, ch)),
  ]);
  return { full, zoom };
}

/**
 * One image summarising the whole comment: the frame the reviewer paused on, the full pointer
 * path fading from light (start) to dark (end) in amber, the path after the first seek in cyan
 * (from then on they were looking at a different frame), and every click as a ring.
 */
export async function renderOverview(
  source: FrameSource,
  meta: CommentMeta,
  events: CaptureEvent[],
  probe: ProbeInfo
): Promise<Buffer> {
  // General comments have no paused frame; they are recorded at the end of the video.
  const vt = meta.pausedAtVideoTime ?? probe.duration;
  const frame = await source.frame(vt, STILL_MAX_WIDTH);
  const { w, h } = await frameSize(frame);
  const px = (p: { x: number; y: number }): Point => ({ x: p.x * w, y: p.y * h });

  const sorted = [...events].sort((a, b) => a.t - b.t);
  const pointers = sorted.filter(isPointerEvent);
  const firstSeek = sorted.find((e) => e.type === 'seek');
  const seekT = firstSeek ? firstSeek.t : Number.POSITIVE_INFINITY;
  const before = pointers.filter((e) => e.t < seekT).map(px);
  const after = pointers.filter((e) => e.t >= seekT).map(px);
  const clicks = pointers.filter((e) => e.type === 'click').map(px);

  return composeJpeg(frame, w, h, [
    trailSvg(before, w, h, { fade: true, colour: AMBER }),
    trailSvg(after, w, h, { fade: false, colour: CYAN }),
    ringsSvg(clicks, ringRadius(w, h)),
  ]);
}

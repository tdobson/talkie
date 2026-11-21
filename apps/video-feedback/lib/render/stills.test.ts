import sharp from 'sharp';
import { probe as probeFile } from '@/lib/media/probe';
import type { FrameSource } from '@/lib/media/frame-source';
import { ffmpegFrameSource } from '@/lib/media/frame-source-ffmpeg';
import { fx } from '@/lib/media/testutil';
import type { CaptureEvent, CommentMeta, Moment, ProbeInfo } from '@/lib/types';
import { renderMomentStill, renderOverview } from './stills';

const events: CaptureEvent[] = [
  { t: 2000, type: 'pointer', x: 0.6, y: 0.2, inside: true, vt: 2 },
  { t: 2400, type: 'pointer', x: 0.45, y: 0.3, inside: true, vt: 2 },
  { t: 2800, type: 'pointer', x: 0.3, y: 0.45, inside: true, vt: 2 },
  { t: 3000, type: 'click', x: 0.25, y: 0.5, inside: true, vt: 2, button: 0 },
  { t: 3500, type: 'seek', from: 2, to: 1, via: 'scrollbar' },
  { t: 3800, type: 'pointer', x: 0.7, y: 0.7, inside: true, vt: 1 },
  { t: 4200, type: 'pointer', x: 0.8, y: 0.8, inside: true, vt: 1 },
];
const base: Moment = {
  id: 'moment-01',
  t: 3000,
  vt: 2,
  x: 0.25,
  y: 0.5,
  inside: true,
  zoom: null,
  kinds: ['click'],
  reasons: ['click'],
};
const meta: CommentMeta = {
  commentId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  version: 1,
  kind: 'moment',
  pausedAtVideoTime: 2,
  startedAt: '2026-11-21T10:00:00.000Z',
  endedAt: '2026-11-21T10:00:05.000Z',
  durationMs: 5000,
  audioMime: 'audio/webm;codecs=opus',
  totalChunks: 1,
  player: {
    containerWidth: 1280,
    containerHeight: 720,
    videoWidth: 640,
    videoHeight: 360,
    contentRect: { x: 0, y: 0, width: 1280, height: 720 },
    fullscreen: false,
    devicePixelRatio: 1,
  },
};

const src = ffmpegFrameSource(fx('h264.mp4'));
let probe: ProbeInfo;
beforeAll(async () => {
  probe = await probeFile(fx('h264.mp4'));
});

describe('stills', () => {
  it('renders a still with the pointer where the moment is', async () => {
    const { full, zoom } = await renderMomentStill(src, base, events, probe);
    const img = sharp(full);
    const m = await img.metadata();
    expect(m.format).toBe('jpeg');
    expect([m.width, m.height]).toEqual([640, 360]);
    expect(zoom).toBeNull();
    const { data } = await img
      .extract({ left: 160 + 3, top: 180 + 6, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(230); // white pointer body just inside the tip
    expect(data[1]).toBeGreaterThan(230);
    expect(data[2]).toBeGreaterThan(230);
  }, 30_000);

  it('produces a zoom crop of the visible region', async () => {
    const m = { ...base, zoom: { scale: 2.5, originX: 0.5, originY: 0.5 } };
    const { full, zoom } = await renderMomentStill(src, m, events, probe);
    expect(zoom).not.toBeNull();
    const zm = await sharp(zoom as Buffer).metadata();
    expect(zm.format).toBe('jpeg');
    expect(zm.width).toBe(256);
    expect(zm.height).toBe(144);
    // The box outline changes the full still compared with the unzoomed one.
    const plain = await renderMomentStill(src, base, events, probe);
    expect(full.equals(plain.full)).toBe(false);
  }, 30_000);

  it('keeps the zoom crop inside the frame when the origin is in a corner', async () => {
    const m = { ...base, x: 0.02, y: 0.02, zoom: { scale: 2.5, originX: 0, originY: 0 } };
    const { zoom } = await renderMomentStill(src, m, events, probe);
    const zm = await sharp(zoom as Buffer).metadata();
    expect([zm.width, zm.height]).toEqual([256, 144]);
  }, 30_000);

  it('renders an overview image', async () => {
    const buf = await renderOverview(src, meta, events, probe);
    const m = await sharp(buf).metadata();
    expect(m.format).toBe('jpeg');
    expect([m.width, m.height]).toEqual([640, 360]);
  }, 30_000);

  it('renders an overview for a general comment with no events', async () => {
    const buf = await renderOverview(
      src,
      { ...meta, kind: 'general', pausedAtVideoTime: null },
      [],
      probe
    );
    expect((await sharp(buf).metadata()).width).toBe(640);
  }, 30_000);

  describe('zoom crops of a vector film', () => {
    // A source that draws at any width asked for, as the Talkie frame source does.
    const widths: number[] = [];
    const vector: FrameSource = {
      async frame(_vt, maxWidth) {
        widths.push(maxWidth);
        const height = Math.round((maxWidth * 9) / 16);
        return sharp({
          create: { width: maxWidth, height, channels: 3, background: '#204060' },
        })
          .png()
          .toBuffer();
      },
      async close() {},
    };
    const vectorProbe = (): ProbeInfo => ({
      ...probe,
      width: 320,
      height: 180,
      codec: 'talkie',
      pixFmt: 'vector',
    });

    it('renders the whole frame at the still width times the zoom scale, then crops', async () => {
      widths.length = 0;
      const m = { ...base, zoom: { scale: 2.5, originX: 0.5, originY: 0.5 } };
      const { full, zoom } = await renderMomentStill(vector, m, events, vectorProbe());
      expect(widths).toEqual([1920, 4800]);
      const fm = await sharp(full).metadata();
      expect([fm.width, fm.height]).toEqual([1920, 1080]);
      const zm = await sharp(zoom as Buffer).metadata();
      expect([zm.width, zm.height]).toEqual([1920, 1080]);
    }, 30_000);

    it('rounds the render width up for a fractional scale', async () => {
      widths.length = 0;
      const m = { ...base, zoom: { scale: 1.3337, originX: 0.5, originY: 0.5 } };
      await renderMomentStill(vector, m, events, vectorProbe());
      expect(widths).toEqual([1920, Math.ceil(1920 * 1.3337)]);
    }, 30_000);

    it('asks for one frame when the reviewer was not zoomed in', async () => {
      widths.length = 0;
      await renderMomentStill(vector, base, events, vectorProbe());
      expect(widths).toEqual([1920]);
    }, 30_000);
  });
});

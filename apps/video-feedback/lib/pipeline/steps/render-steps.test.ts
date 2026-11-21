import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import type { FrameSource } from '@/lib/media/frame-source';
import { probe as probeFile } from '@/lib/media/probe';
import { fx } from '@/lib/media/testutil';
import { commentDir, sourcePath } from '@/lib/storage/paths';
import type { CaptureEvent, CommentMeta, CommentRef, Moment } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { clipStep } from './clip';
import { stillsStep } from './stills';

const ref: CommentRef = {
  videoId: 'demo-video',
  sessionId: '00000000-0000-4000-8000-000000000002',
  commentId: '00000000-0000-4000-8000-000000000001',
};
const meta: CommentMeta = {
  commentId: ref.commentId,
  sessionId: ref.sessionId,
  version: 1,
  kind: 'moment',
  pausedAtVideoTime: 2,
  startedAt: '2026-11-21T10:00:00.000Z',
  endedAt: '2026-11-21T10:00:03.000Z',
  durationMs: 3000,
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
const events: CaptureEvent[] = [
  { t: 500, type: 'pointer', x: 0.5, y: 0.5, inside: true, vt: 2 },
  { t: 1000, type: 'click', x: 0.25, y: 0.5, inside: true, vt: 2, button: 0 },
  { t: 1500, type: 'zoom', state: 'start', scale: 2.5, originX: 0.5, originY: 0.5 },
  { t: 2000, type: 'zoom', state: 'end', scale: 2.5, originX: 0.5, originY: 0.5 },
];
const moment = (n: number, extra: Partial<Moment>): Moment => ({
  id: `moment-0${n}`,
  t: 1000,
  vt: 2,
  x: 0.25,
  y: 0.5,
  inside: true,
  zoom: null,
  kinds: ['click'],
  reasons: ['click'],
  ...extra,
});

let cleanup: () => Promise<void>;
let dir: string;
const logs: string[] = [];
async function ctx() {
  return {
    ref,
    dir,
    meta,
    probe: await probeFile(fx('h264.mp4')),
    log: (m: string) => {
      logs.push(m);
    },
  };
}

beforeAll(async () => {
  ({ cleanup } = await withTmpData());
  dir = commentDir(ref);
  await mkdir(join(dir, 'render'), { recursive: true });
  const src = sourcePath(ref.videoId, 1);
  await mkdir(dirname(src), { recursive: true });
  await copyFile(fx('h264.mp4'), src);
  await copyFile(fx('speech-like.webm'), join(dir, 'audio.webm'));
  await writeFile(join(dir, 'events.json'), JSON.stringify(events));
  await writeFile(
    join(dir, 'moments.json'),
    JSON.stringify([
      moment(1, {}),
      moment(2, { t: 1600, kinds: ['zoom'], zoom: { scale: 2.5, originX: 0.5, originY: 0.5 } }),
    ])
  );
  // A leftover from an earlier run with more moments must not survive.
  await writeFile(join(dir, 'render', 'moment-09.jpg'), 'stale');
});
afterAll(async () => {
  await cleanup();
});

describe('render steps', () => {
  it('stills step writes moment stills, zoom crops and the overview', async () => {
    await stillsStep(await ctx());
    const files = (await readdir(join(dir, 'render'))).sort();
    expect(files).toEqual(['moment-01.jpg', 'moment-02-zoom.jpg', 'moment-02.jpg', 'overview.jpg']);
    const m = await sharp(join(dir, 'render', 'moment-02-zoom.jpg')).metadata();
    expect([m.format, m.width, m.height]).toEqual(['jpeg', 256, 144]);
  }, 60_000);

  it('stills step still writes an overview when there are no moments', async () => {
    await writeFile(join(dir, 'moments.json'), '[]');
    await stillsStep(await ctx());
    expect((await readdir(join(dir, 'render'))).sort()).toEqual(['overview.jpg']);
  }, 60_000);

  it('clip step writes render/clip.mp4 from the assembled audio', async () => {
    await clipStep(await ctx());
    const p = await probeFile(join(dir, 'render', 'clip.mp4'));
    expect(p).toMatchObject({ codec: 'h264', hasAudio: true });
  }, 60_000);

  it('clip step fails clearly when the audio is missing', async () => {
    const c = await ctx();
    await expect(clipStep({ ...c, meta: { ...meta, audioMime: 'audio/mp4' } })).rejects.toThrow(
      /audio\.mp4/
    );
    expect(existsSync(join(dir, 'render', 'clip.mp4'))).toBe(true); // earlier output untouched
  }, 60_000);

  describe('with a frame source of their own', () => {
    // Stands in for the Talkie source: any width, and it counts what it is asked for.
    function counting(failAfter = Number.POSITIVE_INFINITY) {
      const seen = { widths: [] as number[], closed: 0, opened: [] as [string, number][] };
      const source: FrameSource = {
        async frame(_vt, maxWidth) {
          if (seen.widths.length >= failAfter) throw new Error('the browser went away');
          seen.widths.push(maxWidth);
          const height = Math.round((maxWidth * 9) / 16);
          return sharp({ create: { width: maxWidth, height, channels: 3, background: '#f00' } })
            .png()
            .toBuffer();
        },
        async close() {
          seen.closed += 1;
        },
      };
      const frameSource = async (videoId: string, version: number) => {
        seen.opened.push([videoId, version]);
        return source;
      };
      return { seen, frameSource };
    }
    const zoomed = [
      moment(1, { t: 1600, kinds: ['zoom'], zoom: { scale: 2.5, originX: 0.5, originY: 0.5 } }),
    ];

    it('stills step draws a vector film at the zoomed width and closes the source', async () => {
      await writeFile(join(dir, 'moments.json'), JSON.stringify(zoomed));
      const { seen, frameSource } = counting();
      const c = await ctx();
      const probe = { ...c.probe, width: 320, height: 180, codec: 'talkie', pixFmt: 'vector' };
      await stillsStep({ ...c, probe, frameSource });
      expect(seen.opened).toEqual([[ref.videoId, 1]]);
      expect(seen.widths).toEqual([1920, 4800, 1920]);
      expect(seen.closed).toBe(1);
      const m = await sharp(join(dir, 'render', 'moment-01-zoom.jpg')).metadata();
      expect([m.width, m.height]).toEqual([1920, 1080]);
    }, 60_000);

    it('stills step closes the source when a frame fails', async () => {
      await writeFile(join(dir, 'moments.json'), JSON.stringify(zoomed));
      const { seen, frameSource } = counting(1);
      await expect(stillsStep({ ...(await ctx()), frameSource })).rejects.toThrow(
        'the browser went away'
      );
      expect(seen.closed).toBe(1);
    }, 60_000);

    it('clip step takes its frames from the source and closes it', async () => {
      const { seen, frameSource } = counting();
      await clipStep({ ...(await ctx()), frameSource });
      expect(seen.widths.length).toBeGreaterThan(0);
      expect(new Set(seen.widths)).toEqual(new Set([640]));
      expect(seen.closed).toBe(1);
    }, 60_000);

    it('clip step closes the source when the render fails', async () => {
      const { seen, frameSource } = counting(0);
      await expect(clipStep({ ...(await ctx()), frameSource })).rejects.toThrow(
        'the browser went away'
      );
      expect(seen.closed).toBe(1);
    }, 60_000);
  });
});

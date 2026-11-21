import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { audioDuration } from '@/lib/media/ops';
import { probe as probeFile } from '@/lib/media/probe';
import { fx } from '@/lib/media/testutil';
import type { CaptureEvent, CommentMeta } from '@/lib/types';
import { clipSize, renderClip } from './clip';

const events: CaptureEvent[] = [
  { t: 0, type: 'pointer', x: 0.5, y: 0.5, inside: true, vt: 1 },
  { t: 400, type: 'pointer', x: 0.4, y: 0.45, inside: true, vt: 1 },
  { t: 800, type: 'click', x: 0.3, y: 0.4, inside: true, vt: 1, button: 0 },
  { t: 1000, type: 'zoom', state: 'start', scale: 2.5, originX: 0.3, originY: 0.4 },
  { t: 1200, type: 'pointer', x: 0.32, y: 0.42, inside: true, vt: 1, zoomed: true },
  { t: 1400, type: 'zoomPan', originX: 0.35, originY: 0.45 },
  { t: 1600, type: 'zoom', state: 'end', scale: 2.5, originX: 0.35, originY: 0.45 },
  { t: 2000, type: 'seek', from: 1, to: 2.5, via: 'scrollbar' },
  { t: 2300, type: 'pointer', x: 0.7, y: 0.7, inside: true, vt: 2.5 },
];
const meta: CommentMeta = {
  commentId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  version: 1,
  kind: 'moment',
  pausedAtVideoTime: 1,
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

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vf-clip-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('clip', () => {
  it('caps the width and keeps dimensions even', () => {
    expect(clipSize({ width: 1920, height: 1080 })).toEqual({ w: 1280, h: 720 });
    expect(clipSize({ width: 640, height: 360 })).toEqual({ w: 640, h: 360 });
    expect(clipSize({ width: 853, height: 481 })).toEqual({ w: 852, h: 480 });
  });

  it('renders a clip with audio matching the comment length', async () => {
    const out = join(dir, 'clip.mp4');
    const probe = await probeFile(fx('h264.mp4'));
    await renderClip({
      src: fx('h264.mp4'),
      audio: fx('speech-like.webm'),
      meta,
      events,
      probe,
      out,
    });
    const p = await probeFile(out);
    expect(p.codec).toBe('h264');
    expect(p.pixFmt).toBe('yuv420p');
    expect([p.width, p.height]).toEqual([640, 360]);
    expect(p.fps).toBeCloseTo(15, 0);
    expect(p.hasAudio).toBe(true);
    expect(await audioDuration(out)).toBeCloseTo(3, 0);
    expect(existsSync(`${out}.tmp`)).toBe(false);
  }, 60_000);

  it('rejects and leaves no file when ffmpeg fails', async () => {
    const out = join(dir, 'bad.mp4');
    const probe = await probeFile(fx('h264.mp4'));
    await expect(
      renderClip({
        src: fx('h264.mp4'),
        audio: join(dir, 'missing.webm'),
        meta,
        events,
        probe,
        out,
      })
    ).rejects.toThrow(/ffmpeg/);
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.tmp`)).toBe(false);
  }, 60_000);
});

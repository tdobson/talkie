import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import sharp from 'sharp';
import { resetConfigForTests } from '@/lib/config';
import { probe as probeFile } from '@/lib/media/probe';
import { fx } from '@/lib/media/testutil';
import { writeJsonAtomic } from '@/lib/storage/json';
import { sourcePath, versionDir } from '@/lib/storage/paths';
import type { CaptureEvent, Moment } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { processComment } from './process';
import { readStatus } from './status';
import { seedComment, seedVideo } from './testutil';

// The whole pipeline with the real steps: assembly, silence check, (fake) transcription,
// moment selection, stills and the clip. Nothing is stubbed except the transcriber.

const events: CaptureEvent[] = [
  { t: 0, type: 'pointer', x: 0.5, y: 0.5, inside: true, vt: 1.2 },
  { t: 600, type: 'pointer', x: 0.3, y: 0.4, inside: true, vt: 1.2 },
  { t: 1000, type: 'click', x: 0.3, y: 0.4, inside: true, vt: 1.2, button: 0 },
  { t: 1500, type: 'zoom', state: 'start', scale: 2.5, originX: 0.3, originY: 0.4 },
  { t: 1800, type: 'pointer', x: 0.32, y: 0.42, inside: true, vt: 1.2, zoomed: true },
  { t: 2200, type: 'zoom', state: 'end', scale: 2.5, originX: 0.3, originY: 0.4 },
  { t: 2600, type: 'pointer', x: 0.7, y: 0.6, inside: true, vt: 1.2 },
];

let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  process.env.TRANSCRIBER = 'fake';
  resetConfigForTests();
});

afterEach(async () => {
  delete process.env.TRANSCRIBER;
  resetConfigForTests();
  await cleanup();
});

it('takes a seeded comment through every real step, including the clip', async () => {
  const video = await seedVideo();
  const src = sourcePath(video.videoId, 1);
  await mkdir(dirname(src), { recursive: true });
  await copyFile(fx('h264.mp4'), src);
  const probe = await probeFile(src);
  await writeJsonAtomic(join(versionDir(video.videoId, 1), 'probe.json'), probe);

  const { ref, dir } = await seedComment({
    video,
    audio: await readFile(fx('speech-like.webm')),
    parts: 3,
    events,
    meta: {
      player: {
        containerWidth: 1280,
        containerHeight: 720,
        videoWidth: probe.width,
        videoHeight: probe.height,
        contentRect: { x: 0, y: 0, width: 1280, height: 720 },
        fullscreen: false,
        devicePixelRatio: 1,
      },
    },
  });

  await processComment(ref, { includeClip: true });

  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'done',
      moments: 'done',
      stills: 'done',
      clip: 'done',
    },
    error: null,
  });

  expect(existsSync(join(dir, 'audio.webm'))).toBe(true);
  expect(existsSync(join(dir, 'transcript.json'))).toBe(true);
  const moments = JSON.parse(await readFile(join(dir, 'moments.json'), 'utf8')) as Moment[];
  expect(moments.length).toBeGreaterThan(0);

  const rendered = await readdir(join(dir, 'render'));
  expect(rendered).toContain('overview.jpg');
  expect(rendered).toContain('clip.mp4');
  for (const m of moments) {
    expect(rendered).toContain(`${m.id}.jpg`);
    if (m.zoom) expect(rendered).toContain(`${m.id}-zoom.jpg`);
  }
  expect((await sharp(join(dir, 'render', 'overview.jpg')).metadata()).format).toBe('jpeg');
  expect(await probeFile(join(dir, 'render', 'clip.mp4'))).toMatchObject({
    codec: 'h264',
    hasAudio: true,
  });
}, 120_000);

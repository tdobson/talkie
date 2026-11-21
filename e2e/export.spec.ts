import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { FILM_DIR, REPO } from './serve';

// talkie export, on the first 2 s of the sample film at 320x180. This is the only size of export
// that may run on tragicomix, which is why it passes --allow-here.
//
// Build first, from the repo root: yarn build && yarn sample

const run = promisify(execFile);
const LOW = join(REPO, 'scripts/low');
const CLI = join(REPO, 'packages/cli/dist/bin.js');

interface Probe {
  streams: Array<{
    codec_type: string;
    codec_name: string;
    codec_tag_string: string;
    width?: number;
    height?: number;
    pix_fmt?: string;
    r_frame_rate?: string;
    nb_frames?: string;
    duration?: string;
  }>;
  format: { format_name: string; duration: string };
}

// eslint-disable-next-line no-empty-pattern
test('exports the first 2 s as an H.264 MP4 with sound', async ({}, testInfo) => {
  // The export does not depend on which browser the tests drive, so it runs once.
  test.skip(testInfo.project.name !== 'chromium', 'runs once, in the chromium project');
  test.setTimeout(180_000);
  expect(existsSync(CLI), `no CLI at ${CLI}. Run: yarn build`).toBe(true);
  expect(existsSync(FILM_DIR), `no film at ${FILM_DIR}. Run: yarn sample`).toBe(true);

  const out = testInfo.outputPath('first-2s.mp4');
  const exported = await run(
    LOW,
    [
      'node',
      CLI,
      'export',
      FILM_DIR,
      '-o',
      out,
      '--size',
      '320x180',
      '--codec',
      'h264',
      '--from',
      '0',
      '--to',
      '2',
      '--allow-here',
    ],
    { cwd: REPO }
  );
  expect(exported.stdout).toContain('Exported 50 frames');
  expect(existsSync(out)).toBe(true);

  const probed = await run(
    LOW,
    ['ffprobe', '-v', 'error', '-of', 'json', '-show_format', '-show_streams', out],
    { cwd: REPO }
  );
  const probe = JSON.parse(probed.stdout) as Probe;
  expect(probe.format.format_name).toContain('mp4');
  expect(Number(probe.format.duration)).toBeGreaterThan(1.9);
  expect(Number(probe.format.duration)).toBeLessThan(2.15);

  const video = probe.streams.filter((s) => s.codec_type === 'video');
  expect(video).toHaveLength(1);
  expect(video[0]).toMatchObject({
    codec_name: 'h264',
    codec_tag_string: 'avc1',
    width: 320,
    height: 180,
    pix_fmt: 'yuv420p',
    r_frame_rate: '25/1',
    nb_frames: '50',
  });
  expect(Number(video[0]!.duration)).toBeCloseTo(2, 1);

  const audio = probe.streams.filter((s) => s.codec_type === 'audio');
  expect(audio).toHaveLength(1);
  expect(audio[0]).toMatchObject({ codec_name: 'aac', codec_tag_string: 'mp4a' });
  expect(Number(audio[0]!.duration)).toBeGreaterThan(1.9);
  expect(Number(audio[0]!.duration)).toBeLessThan(2.15);
});

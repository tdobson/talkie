import { existsSync } from 'node:fs';
import type { ProbeInfo } from '@/lib/types';
import { checkBrowserSafe, probe, probeContainer } from './probe';
import { fx } from './testutil';

const good: ProbeInfo = {
  width: 640,
  height: 360,
  fps: 25,
  frameDuration: 0.04,
  duration: 4,
  codec: 'h264',
  pixFmt: 'yuv420p',
  hasAudio: true,
};

describe('probe', () => {
  it('probes the h264 fixture', async () => {
    const p = await probe(fx('h264.mp4'));
    expect(p).toMatchObject({
      codec: 'h264',
      pixFmt: 'yuv420p',
      width: 640,
      height: 360,
      hasAudio: true,
    });
    expect(p.fps).toBeCloseTo(25);
    expect(p.frameDuration).toBeCloseTo(0.04);
    expect(p.duration).toBeCloseTo(4, 0);
  });

  it('reports no audio for a video-only file', async () => {
    expect((await probe(fx('mpeg4.mp4'))).hasAudio).toBe(false);
  });

  it('rejects a file with no video stream', async () => {
    await expect(probe(fx('speech-like.wav'))).rejects.toThrow(/no video/i);
  });

  it('rejects a missing file', async () => {
    await expect(probe(fx('nope.mp4'))).rejects.toThrow(/ffprobe/);
  });

  it('reports the container format name', async () => {
    expect(await probeContainer(fx('h264.mp4'))).toContain('mp4');
    expect(await probeContainer(fx('speech-like.webm'))).not.toContain('mp4');
  });
});

describe('checkBrowserSafe', () => {
  it('accepts 8-bit h264 in mp4', async () => {
    expect(checkBrowserSafe(await probe(fx('h264.mp4')), 'mp4')).toEqual({ ok: true });
    expect(checkBrowserSafe(good, 'mov,mp4,m4a,3gp,3g2,mj2')).toEqual({ ok: true });
    expect(checkBrowserSafe({ ...good, pixFmt: 'yuvj420p' }, 'mp4')).toEqual({ ok: true });
  });

  it('rejects non-h264 and 10-bit', async () => {
    expect(checkBrowserSafe(await probe(fx('mpeg4.mp4')), 'mp4')).toEqual({
      ok: false,
      reason: expect.stringMatching(/H\.264/),
    });
    if (existsSync(fx('h264-10bit.mp4')))
      expect(checkBrowserSafe(await probe(fx('h264-10bit.mp4')), 'mp4')).toEqual({
        ok: false,
        reason: expect.stringMatching(/8-bit/),
      });
  });

  it('uses the exact reasons from the plan', () => {
    expect(checkBrowserSafe({ ...good, codec: 'hevc' }, 'mp4')).toEqual({
      ok: false,
      reason: 'Video must be H.264 (this file is hevc)',
    });
    expect(checkBrowserSafe({ ...good, pixFmt: 'yuv422p' }, 'mp4')).toEqual({
      ok: false,
      reason: 'Video is 10-bit or uses an unusual colour format; export as 8-bit 4:2:0 H.264',
    });
  });

  it('rejects other containers and zero duration', () => {
    expect(checkBrowserSafe(good, 'matroska,webm')).toEqual({
      ok: false,
      reason: expect.stringMatching(/MP4/),
    });
    expect(checkBrowserSafe({ ...good, duration: 0 }, 'mp4')).toEqual({
      ok: false,
      reason: expect.stringMatching(/duration/),
    });
  });
});

import sharp from 'sharp';
import { ffmpegFrameSource } from './frame-source-ffmpeg';
import { extractFrame } from './ops';
import { fx } from './testutil';

describe('ffmpegFrameSource', () => {
  it('gives the same frame as extractFrame', async () => {
    const source = ffmpegFrameSource(fx('h264.mp4'));
    const png = await source.frame(1, 320);
    const m = await sharp(png).metadata();
    expect([m.format, m.width, m.height]).toEqual(['png', 320, 180]);
    expect(png.equals(await extractFrame(fx('h264.mp4'), 1, 320))).toBe(true);
  });

  it('never scales up, and close is safe to call twice', async () => {
    const source = ffmpegFrameSource(fx('h264.mp4'));
    expect((await sharp(await source.frame(1, 4000)).metadata()).width).toBe(640);
    await source.close();
    await source.close();
  });
});

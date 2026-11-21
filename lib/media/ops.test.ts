import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  audioDuration,
  concatChunks,
  detectSpeech,
  extractFrame,
  remuxFaststart,
  toWav16k,
} from './ops';
import { probe } from './probe';
import { runOk } from './run';
import { fx } from './testutil';

let dir: string;
const out = (name: string): string => join(dir, name);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'vf-media-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ops', () => {
  it('remuxes to faststart (moov before mdat)', async () => {
    const before = (await readFile(fx('h264-nofaststart.mp4')))
      .subarray(0, 4096)
      .toString('latin1');
    expect(before.indexOf('mdat')).toBeGreaterThan(-1); // the fixture really is not faststart
    await remuxFaststart(fx('h264-nofaststart.mp4'), out('fast.mp4'));
    const head = (await readFile(out('fast.mp4'))).subarray(0, 4096).toString('latin1');
    expect(head.indexOf('moov')).toBeGreaterThan(-1);
    expect(head.indexOf('moov')).toBeLessThan(
      head.indexOf('mdat') === -1 ? Infinity : head.indexOf('mdat')
    );
    expect(existsSync(`${out('fast.mp4')}.tmp`)).toBe(false);
    expect(await probe(out('fast.mp4'))).toMatchObject({
      codec: 'h264',
      width: 640,
      hasAudio: true,
    });
  });

  it('leaves no file behind when the remux fails', async () => {
    await writeFile(out('junk.mp4'), 'not a video');
    await expect(remuxFaststart(out('junk.mp4'), out('bad.mp4'))).rejects.toThrow(/ffmpeg/);
    expect(existsSync(out('bad.mp4'))).toBe(false);
    expect(existsSync(`${out('bad.mp4')}.tmp`)).toBe(false);
  });

  it('extracts a frame scaled to max width', async () => {
    const png = await extractFrame(fx('h264.mp4'), 2.0, 320);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(180);
  });

  it('never upscales a frame', async () => {
    const meta = await sharp(await extractFrame(fx('h264.mp4'), 0, 1920)).metadata();
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(360);
  });

  it('seeks accurately: neighbouring frames differ', async () => {
    const a = await extractFrame(fx('h264.mp4'), 1.0, 320);
    const b = await extractFrame(fx('h264.mp4'), 1.04, 320);
    expect(a.equals(b)).toBe(false);
  });

  it('gives the same frame as a plain decode-from-start seek', async () => {
    // 3.48s is past the fast-seek pre-roll and is not a keyframe (the fixture has one per second).
    const ref = await runOk('ffmpeg', [
      ...[
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        fx('h264.mp4'),
        '-ss',
        '3.48',
        '-frames:v',
        '1',
      ],
      ...['-vf', 'scale=320:-2', '-c:v', 'png', '-f', 'image2pipe', '-'],
    ]);
    const got = await extractFrame(fx('h264.mp4'), 3.48, 320);
    const [a, b] = await Promise.all([
      sharp(got).raw().toBuffer(),
      sharp(ref.stdout).raw().toBuffer(),
    ]);
    expect(a.equals(b)).toBe(true);
  });

  it('measures a recording that has no duration in its header', async () => {
    // A live WebM stream has no duration in its header, as with MediaRecorder output.
    const piped = await runOk('ffmpeg', [
      ...['-hide_banner', '-loglevel', 'error', '-i', fx('speech-like.webm')],
      ...['-c', 'copy', '-f', 'webm', '-live', '1', '-'],
    ]);
    await writeFile(out('nodur.webm'), piped.stdout);
    expect(await audioDuration(out('nodur.webm'))).toBeCloseTo(3, 0);
  });

  it('falls back to the last frame when the time is at or past the end', async () => {
    const meta = await sharp(await extractFrame(fx('h264.mp4'), 99, 320)).metadata();
    expect(meta.width).toBe(320);
  });

  it('converts to 16 kHz mono wav', async () => {
    await toWav16k(fx('speech-like.webm'), out('speech.wav'));
    const header = (await readFile(out('speech.wav'))).subarray(0, 44);
    expect(header.toString('latin1', 0, 4)).toBe('RIFF');
    expect(header.readUInt16LE(22)).toBe(1); // channels
    expect(header.readUInt32LE(24)).toBe(16000); // sample rate
    expect(await audioDuration(out('speech.wav'))).toBeCloseTo(3, 0);
  });

  it('tells speech from silence', async () => {
    const speech = await detectSpeech(fx('speech-like.wav'));
    expect(speech.hasSpeech).toBe(true);
    expect(speech.speechSeconds).toBeCloseTo(3, 0);
    const silence = await detectSpeech(fx('silence.wav'));
    expect(silence.hasSpeech).toBe(false);
    expect(silence.speechSeconds).toBeCloseTo(0, 1);
  });

  it('concatenates chunks byte for byte, in order', async () => {
    await writeFile(out('c0'), Buffer.from([1, 2, 3]));
    await writeFile(out('c1'), Buffer.from([4]));
    await writeFile(out('c2'), Buffer.from([5, 6]));
    await concatChunks([out('c0'), out('c1'), out('c2')], out('joined.bin'));
    expect([...(await readFile(out('joined.bin')))]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(existsSync(`${out('joined.bin')}.tmp`)).toBe(false);
  });

  it('measures audio duration', async () => {
    expect(await audioDuration(fx('speech-like.wav'))).toBeCloseTo(3, 1);
    expect(await audioDuration(fx('speech-like.webm'))).toBeCloseTo(3, 0);
  });
});

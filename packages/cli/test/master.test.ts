import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AAC_ARGS, type Mastered, masterNarration } from '../src/audio/master';
import { measureLoudness, parseEbur128 } from '../src/audio/measure';
import { writeWav } from '../src/audio/wav';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
// without ffmpeg these show as skipped under the title below
const describeFfmpeg = hasFfmpeg ? describe : describe.skip;

const RATE = 48000;
/** 1.5 s of a 220 Hz tone. */
function tone(level: number): Int16Array {
  return Int16Array.from({ length: RATE * 1.5 }, (_, i) =>
    Math.round(level * Math.sin((2 * Math.PI * 220 * i) / RATE))
  );
}
/** 1.5 s of speech-like noise: seeded noise, low-passed, with a 4 Hz syllable envelope. */
function speechNoise(level: number): Int16Array {
  let seed = 12345;
  let low = 0;
  return Int16Array.from({ length: RATE * 1.5 }, (_, i) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    low += 0.15 * (seed / 1073741824 - 1 - low);
    const envelope = 0.6 - 0.4 * Math.cos((2 * Math.PI * 4 * i) / RATE);
    return Math.max(-32768, Math.min(32767, Math.round(level * 3 * low * envelope)));
  });
}
/**
 * 6 s of peaky speech-like noise: low-passed noise squared (keeping its sign) under a syllable
 * envelope, peak normalised to about -0.8 dBFS. Its true peak sits about 21 dB above its loudness,
 * like the real ballad voice, so linear gain to -16 LUFS drives the peaks far into the limiter.
 */
function peakySpeech(): Int16Array {
  let seed = 54321;
  let low = 0;
  const raw = Float64Array.from({ length: RATE * 6 }, (_, i) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    low += 0.15 * (seed / 1073741824 - 1 - low);
    const syllable = 0.5 - 0.5 * Math.cos((2 * Math.PI * 4 * i) / RATE);
    return low * Math.abs(low) * syllable;
  });
  const peak = raw.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return Int16Array.from(raw, (v) => Math.round((v / peak) * 30000));
}
/**
 * 6 s of broader-band peaky noise: peakySpeech with less low-passing (`smooth` 0.4 or 0.5 against
 * its 0.15), so more of it sits in the top octaves. Hard-limited to -4 dBFS, its encodes overshoot:
 * the quantisation noise the codecs add comes out as new peaks past -1 dBTP.
 */
function broadPeaky(seedIn: number, smooth: number): Int16Array {
  let seed = seedIn;
  let low = 0;
  const raw = Float64Array.from({ length: RATE * 6 }, (_, i) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    low += smooth * (seed / 1073741824 - 1 - low);
    const syllable = 0.5 - 0.5 * Math.cos((2 * Math.PI * 4 * i) / RATE);
    return low * Math.abs(low) * syllable;
  });
  const peak = raw.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  return Int16Array.from(raw, (v) => Math.round((v / peak) * 30000));
}

test('the AAC encode turns temporal noise shaping off', () => {
  // ffmpeg's native AAC encoder with TNS on put a full-scale burst (+3.6 dBTP) into the 64 min GSE
  // narration at 1285.85 s from PCM limited to -4 dBFS; the same PCM with TNS off peaks at -2.3 dBTP
  expect(AAC_ARGS.join(' ')).toContain('-aac_tns 0');
});

test('parseEbur128 reads the summary, not the per-frame lines', () => {
  const stderr = [
    '[Parsed_ebur128_0 @ 0x1] t: 0.4 TARGET:-23 LUFS M: -20.1 S:-120.7 I: -20.1 LUFS LRA: 0.0 LU FTPK: -3.0 dBFS TPK: -3.0 dBFS',
    '[Parsed_ebur128_0 @ 0x1] Summary:',
    '',
    '  Integrated loudness:',
    '    I:         -16.3 LUFS',
    '    Threshold: -26.3 LUFS',
    '',
    '  True peak:',
    '    Peak:       -1.4 dBFS',
  ].join('\n');
  expect(parseEbur128(stderr)).toEqual({ integrated: -16.3, truePeak: -1.4 });
  expect(() => parseEbur128('nothing here')).toThrow('no ebur128 summary in the ffmpeg output');
});

describeFfmpeg('needs ffmpeg (skipped when ffmpeg is not on the path)', () => {
  test('masterNarration joins the scenes, lands at -16 LUFS and keeps true peak at or below -1 dBTP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'talkie-master-'));
    try {
      const a = join(dir, "scene one's.wav");
      const b = join(dir, 'scene-2.wav');
      await writeFile(a, writeWav(tone(5000), RATE));
      await writeFile(b, writeWav(speechNoise(6000), RATE));
      const out = join(dir, 'film');
      const result = await masterNarration([a, b], out, { opusContainer: 'webm' });
      expect(result.opus).toBe(join(out, 'u', 'narration.webm'));
      expect(result.aac).toBe(join(out, 'u', 'narration.m4a'));
      expect((await readdir(join(out, 'u'))).toSorted()).toEqual([
        'narration.m4a',
        'narration.webm',
      ]);
      expect(Math.abs(result.integrated + 16)).toBeLessThanOrEqual(1);
      expect(result.truePeak).toBeLessThanOrEqual(-1);
      expect(result.seconds).toBeCloseTo(3, 2);
      for (const file of [result.opus, result.aac]) {
        const measured = await measureLoudness(file);
        expect(Math.abs(measured.integrated + 16)).toBeLessThanOrEqual(1);
        expect(measured.truePeak).toBeLessThanOrEqual(-1);
      }

      const again = join(dir, 'again');
      const ogg = await masterNarration([a, b], again, { opusContainer: 'ogg' });
      expect(ogg.opus).toBe(join(again, 'u', 'narration.ogg'));
      expect((await stat(ogg.opus)).size).toBeGreaterThan(1000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

  test('masterNarration reaches -16 LUFS on peaky speech the limiter has to work hard on', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'talkie-master-'));
    try {
      const a = join(dir, 'peaky.wav');
      await writeFile(a, writeWav(peakySpeech(), RATE));
      const raw = await measureLoudness(a);
      // the input really is peaky: about 20 dB or more between true peak and loudness
      expect(raw.truePeak - raw.integrated).toBeGreaterThan(20);
      const result = await masterNarration([a], join(dir, 'film'), { opusContainer: 'webm' });
      expect(Math.abs(result.integrated + 16)).toBeLessThanOrEqual(0.3);
      expect(result.truePeak).toBeLessThanOrEqual(-1);
      for (const file of [result.opus, result.aac]) {
        const measured = await measureLoudness(file);
        expect(Math.abs(measured.integrated + 16)).toBeLessThanOrEqual(1);
        expect(measured.truePeak).toBeLessThanOrEqual(-1);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

  // without the guard the Opus encode of the first lands at -0.8 dBTP and the AAC encode of the
  // second at -0.7 dBTP, both from PCM limited to -3.8 dBTP
  test.each([
    { name: 'Opus', seed: 7, smooth: 0.4, pick: (r: Mastered) => r.opus },
    { name: 'AAC', seed: 2, smooth: 0.5, pick: (r: Mastered) => r.aac },
  ])(
    'masterNarration keeps the $name encode at or below -1 dBTP when the codec overshoots',
    async ({ seed, smooth, pick }) => {
      const dir = await mkdtemp(join(tmpdir(), 'talkie-master-'));
      try {
        const a = join(dir, 'broad.wav');
        await writeFile(a, writeWav(broadPeaky(seed, smooth), RATE));
        const result = await masterNarration([a], join(dir, 'film'), { opusContainer: 'webm' });
        expect(result.truePeak).toBeLessThanOrEqual(-1);
        const measured = await measureLoudness(pick(result));
        expect(Math.abs(measured.integrated + 16)).toBeLessThanOrEqual(1);
        expect(measured.truePeak).toBeLessThanOrEqual(-1);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
    180000
  );

  test('masterNarration gives the same bytes for the same input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'talkie-master-'));
    try {
      const a = join(dir, 'a.wav');
      await writeFile(a, writeWav(speechNoise(6000), RATE));
      const sum = async (file: string) =>
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex');
      for (const opusContainer of ['webm', 'ogg'] as const) {
        const one = await masterNarration([a], join(dir, `one-${opusContainer}`), {
          opusContainer,
        });
        const two = await masterNarration([a], join(dir, `two-${opusContainer}`), {
          opusContainer,
        });
        expect(await sum(one.opus)).toBe(await sum(two.opus));
        expect(await sum(one.aac)).toBe(await sum(two.aac));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);
});

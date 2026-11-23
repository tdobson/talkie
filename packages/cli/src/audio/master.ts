import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runLow } from './lowproc';
import { type Loudness, measureLoudness } from './measure';
import { readWav } from './wav';

/** Integrated loudness the narration is mastered to, in LUFS. */
export const TARGET_LUFS = -16;
/**
 * True-peak limiting at 4x the sample rate (from the GSE lessons): a limiter working on 48 kHz samples
 * misses the peaks between them. 0.63 is about -4 dBFS, which leaves room for what the lossy codecs add.
 */
const LIMIT = 0.63;
const limiter = (limit: number) =>
  `aresample=192000,alimiter=limit=${limit.toFixed(4)}:level=disabled,aresample=48000`;
/** The most an encode may peak at, in dBTP. */
export const MAX_TRUE_PEAK = -1;
/** Most times an encode that overshoots is limited lower and encoded again. */
const MAX_PEAK_RETRIES = 4;
/** Aim this far under MAX_TRUE_PEAK when an encode is limited lower, in dB. */
const PEAK_MARGIN_DB = 0.3;
/**
 * ffmpeg's native AAC encoder at 64k mono. Temporal noise shaping is off: with it on, the encoder
 * put a burst of six samples swinging to +/-1.1 full scale (+3.6 dBTP) into the 64 min GSE
 * narration at 1285.85 s, from PCM limited to -4 dBFS that encodes cleanly to Opus. Which frame
 * bursts depends on the gain by hundredths of a dB; with TNS off the same PCM peaks at -2.3 dBTP and
 * the loudness does not move.
 */
export const AAC_ARGS = ['-c:a', 'aac', '-b:a', '64k', '-aac_tns', '0', '-ac', '1'];
const OPUS_ARGS = ['-c:a', 'libopus', '-b:a', '32k', '-ac', '1'];
/** Keep ffmpeg from writing its version, dates or random stream ids, so the same input gives the same bytes. */
const BITEXACT = ['-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
const QUIET = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
/** How close to the target the mastered loudness must land, in LU, before we stop correcting. */
const TOLERANCE_LU = 0.3;
/** Most gain-and-limit passes before we keep what we have (the qa loudness gate then reports it). */
const MAX_PASSES = 6;

export interface Mastered extends Loudness {
  /** `u/narration.webm` or `u/narration.ogg` under `outDir`. */
  opus: string;
  /** `u/narration.m4a` under `outDir`. */
  aac: string;
  /** Length of the mastered narration in seconds. */
  seconds: number;
}

/**
 * Join the scene WAVs into one narration track, bring it to -16 LUFS by linear gain, limit the true
 * peak, and encode Opus and AAC into `outDir/u/`. The loudness returned is measured on the mastered
 * audio before encoding.
 *
 * The limiter takes loudness away when the voice has high peaks (the ballad voice peaks about 24 dB
 * above its loudness, so the gain alone left it near -18 LUFS). So we measure after the limiter and,
 * while it is more than 0.3 LU off, change the gain and limit the joined track again. Each new gain
 * follows the slope of the last two passes, because under hard limiting a dB of gain buys well
 * under a dB of loudness. Voices that land first time take one pass, as before.
 */
export async function masterNarration(
  sceneWavs: string[],
  outDir: string,
  { opusContainer }: { opusContainer: 'webm' | 'ogg' }
): Promise<Mastered> {
  if (sceneWavs.length === 0) {
    throw new Error('no scene audio to master');
  }
  const work = await mkdtemp(join(tmpdir(), 'talkie-master-'));
  try {
    const list = join(work, 'list.txt');
    const joined = join(work, 'joined.wav');
    const mastered = join(work, 'mastered.wav');
    const wav = ['-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav'];
    await writeFile(
      list,
      sceneWavs.map((p) => `file '${resolve(p).replaceAll("'", "'\\''")}'\n`).join('')
    );
    await runLow('ffmpeg', [
      ...QUIET,
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      ...BITEXACT,
      ...wav,
      joined,
    ]);

    const before = await measureLoudness(joined);
    const limitAt = async (gain: number) => {
      await runLow('ffmpeg', [
        ...QUIET,
        '-i',
        joined,
        '-af',
        `volume=${gain.toFixed(2)}dB,${limiter(LIMIT)}`,
        ...BITEXACT,
        ...wav,
        mastered,
      ]);
      return measureLoudness(mastered);
    };
    // silence has no loudness to correct
    let gain = Number.isFinite(before.integrated) ? round2(TARGET_LUFS - before.integrated) : 0;
    let loudness = await limitAt(gain);
    let last: { gain: number; integrated: number } | undefined;
    for (
      let pass = 1;
      pass < MAX_PASSES &&
      Number.isFinite(loudness.integrated) &&
      Math.abs(TARGET_LUFS - loudness.integrated) > TOLERANCE_LU;
      pass++
    ) {
      // LU of loudness per dB of gain: 1 with no limiting, less the harder the limiter works
      const slope = last
        ? Math.min(1, Math.max(0.1, (loudness.integrated - last.integrated) / (gain - last.gain)))
        : 1;
      last = { gain, integrated: loudness.integrated };
      gain = round2(gain + (TARGET_LUFS - loudness.integrated) / slope);
      loudness = await limitAt(gain);
    }
    const { samples, sampleRate } = readWav(await readFile(mastered));

    const dir = join(outDir, 'u');
    await mkdir(dir, { recursive: true });
    const opus = join(dir, `narration.${opusContainer}`);
    const aac = join(dir, 'narration.m4a');
    const encode = (from: string, to: string, codec: string[], format: string[]) =>
      runLow('ffmpeg', [...QUIET, '-i', from, ...BITEXACT, ...codec, ...format, to]);
    await encodeUnderPeak(mastered, opus, work, (from, to) =>
      encode(from, to, OPUS_ARGS, ['-f', opusContainer])
    );
    await encodeUnderPeak(mastered, aac, work, (from, to) =>
      encode(from, to, AAC_ARGS, ['-movflags', '+faststart', '-f', 'ipod'])
    );
    return { opus, aac, seconds: samples.length / sampleRate, ...loudness };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Encode `mastered` to `out` and keep its true peak at or below -1 dBTP. A lossy codec adds
 * quantisation noise, which can put new peaks above the limited PCM (more so on broadband sound).
 * When the encode overshoots, limit the mastered PCM lower by the overshoot and encode again. Only
 * the peaks move, so the loudness stays put, which a gain trim of the same size would not do.
 * After MAX_PEAK_RETRIES the last encode is kept and the qa true peak gate reports it.
 */
async function encodeUnderPeak(
  mastered: string,
  out: string,
  work: string,
  encode: (from: string, to: string) => Promise<unknown>
): Promise<void> {
  await encode(mastered, out);
  let limit = LIMIT;
  const lower = join(work, 'lower.wav');
  for (let retry = 0; retry < MAX_PEAK_RETRIES; retry++) {
    const { truePeak } = await measureLoudness(out);
    if (!(truePeak > MAX_TRUE_PEAK)) {
      return;
    }
    limit *= 10 ** (-(truePeak - MAX_TRUE_PEAK + PEAK_MARGIN_DB) / 20);
    await runLow('ffmpeg', [
      ...QUIET,
      '-i',
      mastered,
      '-af',
      limiter(limit),
      ...BITEXACT,
      '-ar',
      '48000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      lower,
    ]);
    await encode(lower, out);
  }
}

/** Round to the 0.01 dB the volume filter is given, so the slope uses the gains really applied. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

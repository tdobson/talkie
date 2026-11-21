import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { SILENCE_MIN_SPEECH_S, SILENCE_NOISE_DB } from '@/lib/constants';
import { run, runOk } from './run';

const FFMPEG_BASE = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
const SILENCE_MIN_GAP_S = 0.5;
// How far before the wanted time the fast (keyframe) seek lands. The accurate seek after -i
// then decodes only this much instead of the whole file up to the wanted time.
const SEEK_PREROLL_S = 2;

/** Writes to `${dst}.tmp`, then renames, so a half-written dst is never visible. */
async function viaTmp(dst: string, write: (tmp: string) => Promise<void>): Promise<void> {
  const tmp = `${dst}.tmp`;
  try {
    await write(tmp);
    await rename(tmp, dst);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Stream copy into an MP4 with the moov atom at the front, so playback can start early. */
export async function remuxFaststart(src: string, dst: string): Promise<void> {
  await viaTmp(dst, async (tmp) => {
    await runOk('ffmpeg', [
      ...FFMPEG_BASE,
      '-i',
      src,
      '-c',
      'copy',
      '-movflags',
      '+faststart',
      '-f',
      'mp4',
      tmp,
    ]);
  });
}

/**
 * One frame as PNG, at exactly video time `vt` (accurate seek: -ss after -i), scaled down to
 * `maxWidth` if wider. A time at or past the end gives the last frame.
 */
export async function extractFrame(src: string, vt: number, maxWidth: number): Promise<Buffer> {
  const scale = `scale='min(${Math.floor(maxWidth)},iw)':-2`;
  const t = Math.max(0, vt);
  const fast = Math.max(0, t - SEEK_PREROLL_S);
  const r = await runOk('ffmpeg', [
    ...FFMPEG_BASE,
    ...(fast > 0 ? ['-ss', fast.toFixed(6)] : []),
    '-i',
    src,
    '-ss',
    (t - fast).toFixed(6),
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    '-vf',
    scale,
    '-c:v',
    'png',
    '-f',
    'image2pipe',
    '-',
  ]);
  if (r.stdout.length > 0) return r.stdout;
  return lastFrame(src, scale);
}

async function lastFrame(src: string, scale: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'vf-frame-'));
  try {
    const file = join(dir, 'last.png');
    // -update 1 keeps overwriting the same file, so the last frame decoded is what remains.
    await runOk('ffmpeg', [
      ...FFMPEG_BASE,
      '-sseof',
      '-3',
      '-i',
      src,
      '-map',
      '0:v:0',
      '-vf',
      scale,
      '-update',
      '1',
      '-c:v',
      'png',
      '-f',
      'image2',
      file,
    ]);
    return await readFile(file);
  } catch (e) {
    throw new Error(`Could not extract a frame from the video: ${(e as Error).message}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 16 kHz mono 16-bit PCM WAV of the first audio track. */
export async function toWav16k(src: string, dst: string): Promise<void> {
  await viaTmp(dst, async (tmp) => {
    await runOk('ffmpeg', [
      ...FFMPEG_BASE,
      '-i',
      src,
      '-map',
      '0:a:0',
      '-vn',
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      tmp,
    ]);
  });
}

/**
 * Speech here means "not silence": total time above the noise floor, found with ffmpeg's
 * silencedetect filter (noise=-40dB:d=0.5), whose report is read from stderr.
 */
export async function detectSpeech(
  wav: string
): Promise<{ hasSpeech: boolean; speechSeconds: number }> {
  const duration = await audioDuration(wav);
  const r = await runOk('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-i',
    wav,
    '-map',
    '0:a:0',
    '-af',
    `silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SILENCE_MIN_GAP_S}`,
    '-f',
    'null',
    '-',
  ]);
  let silent = 0;
  let openStart: number | null = null;
  for (const m of r.stderr.matchAll(/silence_(start|end): (-?[\d.]+)/g)) {
    const at = Math.max(0, Number(m[2]));
    if (m[1] === 'start') openStart = at;
    else if (openStart !== null) {
      silent += Math.max(0, at - openStart);
      openStart = null;
    }
  }
  // Silence that runs to the end of the file may have no closing line.
  if (openStart !== null) silent += Math.max(0, duration - openStart);
  const speechSeconds = Math.max(0, duration - silent);
  return { hasSpeech: speechSeconds >= SILENCE_MIN_SPEECH_S, speechSeconds };
}

/** Joins upload chunks byte for byte, in the order given. */
export async function concatChunks(chunkPaths: string[], dst: string): Promise<void> {
  await viaTmp(dst, async (tmp) => {
    const outStream = createWriteStream(tmp);
    try {
      for (const chunk of chunkPaths)
        await pipeline(createReadStream(chunk), outStream, { end: false });
    } catch (e) {
      outStream.destroy();
      throw e;
    }
    await new Promise<void>((resolve, reject) => {
      outStream.on('error', reject);
      outStream.end(resolve);
    });
  });
}

/**
 * Duration in seconds. Browser recordings (MediaRecorder WebM) often carry no duration in
 * their header, so when ffprobe has none the file is decoded and the last timestamp is used.
 */
export async function audioDuration(file: string): Promise<number> {
  const probed = await runOk('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    file,
  ]);
  const fromHeader = Number(probed.stdout.toString('utf8').trim());
  if (Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;

  const decoded = await run('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-i',
    file,
    '-vn',
    '-f',
    'null',
    '-',
  ]);
  if (decoded.code !== 0) throw new Error(`ffmpeg could not read the duration of ${file}`);
  const times = [...decoded.stderr.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = times.at(-1);
  if (!last) throw new Error(`ffmpeg could not read the duration of ${file}`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

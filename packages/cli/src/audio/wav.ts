import { readFile, rename, stat } from 'node:fs/promises';
import { runLow } from './lowproc';

export interface Wav {
  sampleRate: number;
  samples: Int16Array;
}

const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));

/** Read a PCM16 mono WAV. Chunks other than `fmt ` and `data` are skipped. */
export function readWav(bytes: Uint8Array): Wav {
  if (bytes.length < 12 || tag(bytes, 0) !== 'RIFF' || tag(bytes, 8) !== 'WAVE') {
    throw new Error('not a WAV file');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let sampleRate = 0;
  for (let at = 12; at + 8 <= bytes.length;) {
    const id = tag(bytes, at);
    const declared = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === 'fmt ') {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) {
        throw new Error(
          `expected PCM16 mono, got format ${format}, ${channels} channels, ${bits} bits`
        );
      }
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === 'data') {
      if (!sampleRate) {
        throw new Error('WAV data chunk comes before the fmt chunk');
      }
      // a streamed WAV (ffmpeg to a pipe) declares 0xFFFFFFFF: take what is there
      const size = Math.min(declared, bytes.length - body) & ~1;
      const samples = new Int16Array(size / 2);
      for (let i = 0; i < samples.length; i++) {
        samples[i] = view.getInt16(body + i * 2, true);
      }
      return { sampleRate, samples };
    }
    at = body + declared + (declared % 2);
  }
  throw new Error('WAV file has no data chunk');
}

/** Write PCM16 mono WAV bytes with the plain 44 byte header. */
export function writeWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const put = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      bytes[at + i] = text.charCodeAt(i);
    }
  };
  put(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits
  put(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  return bytes;
}

/** The sample rate every narration line is mixed at. */
export const LINE_RATE = 48000;

/**
 * Convert a voiced line to 48 kHz mono PCM16 with ffmpeg. The result is cached next to the source as
 * `<name>.48k.wav` and reused while it is at least as new as the source.
 */
export async function normaliseLine(wavPath: string): Promise<Wav & { file: string }> {
  const file = `${wavPath.replace(/\.wav$/i, '')}.48k.wav`;
  const source = await stat(wavPath);
  const cached = await stat(file).catch(() => null);
  if (!cached || cached.mtimeMs < source.mtimeMs) {
    const part = `${file}.part`;
    await runLow('ffmpeg', [
      '-hide_banner',
      '-nostdin',
      '-loglevel',
      'error',
      '-y',
      '-i',
      wavPath,
      '-map_metadata',
      '-1',
      '-fflags',
      '+bitexact',
      '-flags:a',
      '+bitexact',
      '-ar',
      String(LINE_RATE),
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      '-f',
      'wav',
      part,
    ]);
    await rename(part, file);
  }
  return { file, ...readWav(await readFile(file)) };
}

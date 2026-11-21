import { runLow } from './lowproc';

export interface Loudness {
  /** Integrated loudness in LUFS (EBU R 128). `-Infinity` for silence. */
  integrated: number;
  /** True peak in dBTP. `-Infinity` for silence. */
  truePeak: number;
}

const number = (text: string) => (/^-?inf$/i.test(text) ? -Infinity : Number(text));

/** Read integrated loudness and true peak from the summary ffmpeg's `ebur128=peak=true` prints. */
export function parseEbur128(stderr: string): Loudness {
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const integrated = /\bI:\s*(-?inf|-?\d+(?:\.\d+)?)\s*LUFS/i.exec(summary);
  const peak = /\bPeak:\s*(-?inf|-?\d+(?:\.\d+)?)\s*dBFS/i.exec(summary);
  if (!stderr.includes('Summary:') || !integrated || !peak) {
    throw new Error('no ebur128 summary in the ffmpeg output');
  }
  return { integrated: number(integrated[1]), truePeak: number(peak[1]) };
}

/** Measure an audio file's integrated loudness and true peak with ffmpeg. */
export async function measureLoudness(path: string): Promise<Loudness> {
  const { stderr } = await runLow('ffmpeg', [
    '-hide_banner',
    '-nostdin',
    '-nostats',
    '-i',
    path,
    '-map',
    '0:a:0',
    '-af',
    'ebur128=peak=true',
    '-f',
    'null',
    '-',
  ]);
  return parseEbur128(stderr);
}

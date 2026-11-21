import { chunkCaption } from './chunk';

export interface VttLine {
  /** When the voice starts, in film seconds. */
  start: number;
  /** When the caption leaves the screen. */
  captionEnd: number;
  /** When the voice stops. */
  voiceEnd: number;
  /** What the voice says. */
  text: string;
  /** What the caption shows instead, for example numerals where the voice says words. */
  caption?: string;
}

/** Format seconds as `hh:mm:ss.mmm`, rounded to the millisecond. */
export function formatVttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
}

const escapeCue = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Build a WebVTT file from script lines. Each line's caption text is chunked; the chunks share the
 * voice span by character count, and the last chunk stays up until `captionEnd`.
 */
export function buildVtt(lines: VttLine[]): string {
  const cues: string[] = [];
  for (const line of lines) {
    const chunks = chunkCaption(line.caption ?? line.text);
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const voice = line.voiceEnd - line.start;
    let at = line.start;
    chunks.forEach((chunk, i) => {
      const last = i === chunks.length - 1;
      const end = last ? line.captionEnd : at + (voice * chunk.length) / total;
      cues.push(`${formatVttTime(at)} --> ${formatVttTime(end)}\n${escapeCue(chunk)}\n`);
      at = end;
    });
  }
  return ['WEBVTT\n', ...cues].join('\n');
}

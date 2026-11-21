import type { PlannedLine } from './model';

export interface LineInput {
  id: string;
  text: string;
  caption?: string;
  voiceSeconds: number;
}
export interface PlanOptions {
  lead?: number;
  gap?: number;
  tail?: number;
  minDuration?: number;
}

/** The shortest time any caption stays up, in seconds. */
export const READ_MIN = 3;
/** A caption stays this long after its voice ends, in seconds. */
const VOICE_PAD = 0.3;

const round = (x: number) => Math.round(x * 1000) / 1000;
const wordCount = (text: string) => (text.trim().match(/\S+/g) ?? []).length;

/** How long a caption of this many words is held so it can be read, in seconds. */
export const readHold = (words: number): number => Math.max(READ_MIN, words / 3 + 1.5);

/**
 * Places voice lines on the scene clock. A caption holds for readHold of its words and never less
 * than its voice. Lines never overlap: the next line starts after the previous caption ends plus the gap.
 */
export function planLines(
  lines: LineInput[],
  opts: PlanOptions = {}
): { lines: PlannedLine[]; duration: number } {
  const { lead = 1.4, gap = 0.7, tail = 2.2, minDuration = 0 } = opts;
  const seen = new Set<string>();
  const planned: PlannedLine[] = [];
  let t = lead;
  let lastEnd = 0;
  for (const line of lines) {
    if (!line.id || !line.text) {
      throw new Error(`script line needs id and text: ${JSON.stringify(line)}`);
    }
    if (seen.has(line.id)) {
      throw new Error(`duplicate line id ${line.id}`);
    }
    if (!Number.isFinite(line.voiceSeconds) || line.voiceSeconds < 0) {
      throw new Error(`line ${line.id} needs a voice length in seconds`);
    }
    seen.add(line.id);
    const start = t;
    const voiceEnd = start + line.voiceSeconds;
    const words = wordCount(line.caption ?? line.text);
    const captionEnd = Math.max(start + readHold(words), voiceEnd + VOICE_PAD);
    planned.push({
      id: line.id,
      text: line.text,
      ...(line.caption === undefined ? {} : { caption: line.caption }),
      start: round(start),
      voiceEnd: round(voiceEnd),
      captionEnd: round(captionEnd),
    });
    lastEnd = Math.max(lastEnd, captionEnd);
    t = captionEnd + gap;
  }
  return { lines: planned, duration: round(Math.max(minDuration, lastEnd + tail)) };
}

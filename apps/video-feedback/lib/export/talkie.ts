import { chapterAt, frameFor, sceneAt, type TalkieFilm } from '@talkie/format';
import type { TalkieMomentInfo } from '@/lib/types';

/** One caption cue: shown from `start` up to, but not at, `end` (seconds of film time). */
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

/** The frame rate and the in and out frames of one scene, as its Lottie file gives them. */
export interface SceneTiming {
  fr: number;
  ip: number;
  op: number;
}

/**
 * How to turn scene time into frames: one frame rate for the whole film, or one entry per
 * scene in film order. An entry is the scene's timing, or just a frame rate when the scene
 * file could not be read (frames then count from 0 and are not clamped).
 */
export type SceneFps = number | readonly (SceneTiming | number)[];

const CUE_TIME =
  /^\s*(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})(?:\s|$)/;

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&nbsp;': ' ',
  '&lrm;': '',
  '&rlm;': '',
};

/** Cue text as a reader sees it: no tags, entities decoded, on one line. */
function plainCue(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|nbsp|lrm|rlm);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim();
}

/** The cues of a WebVTT file, in start order. Blocks that are not cues are skipped. */
export function parseCaptionCues(vtt: string): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const blocks = vtt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    // The timing line is first, or second after an optional cue identifier.
    const at = lines.findIndex((line) => CUE_TIME.test(line));
    if (at < 0 || at > 1) continue;
    const m = CUE_TIME.exec(lines[at]);
    if (!m) continue;
    const time = (h: string | undefined, min: string, s: string, ms: string) =>
      Number(h ?? 0) * 3600 + Number(min) * 60 + Number(s) + Number(ms) / 1000;
    const start = time(m[1], m[2], m[3], m[4]);
    const end = time(m[5], m[6], m[7], m[8]);
    if (!(end > start)) continue;
    cues.push({ start, end, text: plainCue(lines.slice(at + 1).join('\n')) });
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The caption showing at film time `t`, or null. When cues overlap, the later one wins. */
function captionAt(cues: readonly CaptionCue[], t: number): string | null {
  let text: string | null = null;
  for (const cue of cues) {
    if (cue.start <= t && t < cue.end && cue.text !== '') text = cue.text;
  }
  return text;
}

/**
 * Where video time `vt` falls in a Talkie film: the scene, the time and Lottie frame inside
 * that scene, and the chapter and caption showing then. A time exactly on a scene boundary
 * belongs to the later scene, as in the player.
 */
export function talkieInfoFor(
  film: TalkieFilm,
  sceneFps: SceneFps,
  vt: number,
  cues: readonly CaptionCue[]
): TalkieMomentInfo {
  const { index, scene, localTime } = sceneAt(film, vt);
  const timing = typeof sceneFps === 'number' ? sceneFps : (sceneFps[index] ?? 0);
  const frame =
    typeof timing === 'number'
      ? Math.max(localTime * timing, 0)
      : frameFor(localTime, timing.fr, timing.ip, timing.op);
  const chapter = chapterAt(film, vt);
  return {
    sceneId: scene.id,
    sceneIndex: index,
    sceneSrc: scene.src,
    sceneTime: Math.round(localTime * 1000) / 1000,
    sceneFrame: Math.round(frame),
    chapter: chapter >= 0 ? (film.chapters[chapter]?.title ?? null) : null,
    caption: captionAt(cues, vt),
  };
}

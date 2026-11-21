import { outOfBand, stillSpans, type SceneModel } from '@talkie/author';
import { TARGET_LUFS } from '../audio/master';
import type { Loudness } from '../audio/measure';
import { chunkCaption } from '../captions/chunk';

export interface Gate {
  name: string;
  /** INFO is a report with nothing to pass or fail. */
  status: 'PASS' | 'FAIL' | 'INFO';
  details: string[];
}

/** The longest caption chunk the plate holds: two lines of about 56 characters. */
export const MAX_CHUNK_CHARS = 112;
/** Integrated loudness may be this far from the target, in LU. */
export const LUFS_TOLERANCE = 1;
/** The highest true peak allowed, in dBTP. */
export const MAX_TRUE_PEAK = -1;
/** The longest the picture may hold with nothing moving, in seconds. */
export const MAX_STILL_SECONDS = 8;
/** Captions sit below this line on a stage 1080 high. Other heights scale it. */
export const BAND_Y = 845;
const BAND_STAGE_HEIGHT = 1080;

const gate = (name: string, problems: string[]): Gate => ({
  name,
  status: problems.length === 0 ? 'PASS' : 'FAIL',
  details: problems,
});
const num = (x: number, places = 3) => String(Math.round(x * 10 ** places) / 10 ** places);

export const checkGate = (problems: string[]): Gate => gate('check', problems);
export const voiceGate = (problems: string[]): Gate => gate('voice', problems);

const EM_DASH = '\u2014';
const EN_DASH = '\u2013';

/** No em or en dash in anything a viewer reads or hears. */
export function dashGate(items: Array<{ where: string; text: string }>): Gate {
  const problems: string[] = [];
  for (const { where, text } of items) {
    const found = [
      ...(text.includes(EM_DASH) ? ['an em dash'] : []),
      ...(text.includes(EN_DASH) ? ['an en dash'] : []),
    ];
    if (found.length > 0) {
      problems.push(`${where} has ${found.join(' and ')}: "${text}"`);
    }
  }
  return gate('dashes', problems);
}

/** No caption chunk longer than the plate holds. `text` is what the caption shows. */
export function captionGate(lines: Array<{ id: string; text: string }>): Gate {
  const problems: string[] = [];
  for (const line of lines) {
    for (const chunk of chunkCaption(line.text)) {
      if (chunk.length > MAX_CHUNK_CHARS) {
        problems.push(
          `line ${line.id}: a caption chunk is ${chunk.length} characters, over ${MAX_CHUNK_CHARS}: "${chunk.slice(0, 19)} ..."`
        );
      }
    }
  }
  return gate('captions', problems);
}

export interface TrackLoudness extends Loudness {
  src: string;
}

/** Integrated loudness and true peak of the encoded tracks, as two gates. */
export function loudnessGates(tracks: TrackLoudness[]): [Gate, Gate] {
  if (tracks.length === 0) {
    const none = ['the film has no audio track'];
    return [gate('loudness', none), gate('true peak', none)];
  }
  const low = TARGET_LUFS - LUFS_TOLERANCE;
  const high = TARGET_LUFS + LUFS_TOLERANCE;
  let loudOk = true;
  let peakOk = true;
  const loud: string[] = [];
  const peak: string[] = [];
  for (const track of tracks) {
    if (!Number.isFinite(track.integrated) || !Number.isFinite(track.truePeak)) {
      loudOk = false;
      peakOk = false;
      loud.push(`${track.src}: silent`);
      peak.push(`${track.src}: silent`);
      continue;
    }
    const loudFits = track.integrated >= low && track.integrated <= high;
    const peakFits = track.truePeak <= MAX_TRUE_PEAK;
    loudOk &&= loudFits;
    peakOk &&= peakFits;
    loud.push(
      `${track.src}: ${num(track.integrated, 1)} LUFS${loudFits ? '' : `, outside ${low} to ${high}`}`
    );
    peak.push(
      `${track.src}: ${num(track.truePeak, 1)} dBTP${peakFits ? '' : `, over ${MAX_TRUE_PEAK}`}`
    );
  }
  return [
    { name: 'loudness', status: loudOk ? 'PASS' : 'FAIL', details: loud },
    { name: 'true peak', status: peakOk ? 'PASS' : 'FAIL', details: peak },
  ];
}

export interface QaScene {
  id: string;
  model: SceneModel;
}

/** No scene holds its picture for more than 8 s. The tail at the end of a scene is not counted. */
export function stillGate(scenes: QaScene[], tail: number): Gate {
  const problems: string[] = [];
  for (const { id, model } of scenes) {
    const last = model.duration - tail;
    for (const span of stillSpans(model)) {
      const end = Math.min(span.end, last);
      // rounded as it is shown, so 8 s by the clock is not failed over a stray last digit
      const held = Number(num(end - span.start));
      if (held > MAX_STILL_SECONDS) {
        problems.push(
          `scene ${id}: nothing moves for ${held} s, from ${num(span.start)} s to ${num(end)} s`
        );
      }
    }
  }
  return gate('still', problems);
}

/** No art in the part of the stage kept for captions. */
export function bandGate(scenes: QaScene[]): Gate {
  const problems: string[] = [];
  for (const { id, model } of scenes) {
    const y = (BAND_Y * model.size[1]) / BAND_STAGE_HEIGHT;
    for (const hit of outOfBand(model, { y })) {
      problems.push(
        `scene ${id}: "${hit.name}" (${hit.id}) reaches y ${num(hit.bottom, 1)} at ${num(hit.t)} s, into the caption band below y ${num(y, 1)}`
      );
    }
  }
  return gate('caption band', problems);
}

export interface Sizes {
  /** Bytes of every scene's animation after brotli, added up. */
  animation: number;
  scenes: number;
  /** Each audio track. A viewer downloads one of them. */
  audio: Array<{ src: string; bytes: number }>;
  /** Film length in seconds. */
  duration: number;
}

const kB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;
const MB = (bytes: number) => `${(bytes / 1_000_000).toFixed(2)} MB`;

/** What the film weighs on the wire: the animation, and the total with each audio track. */
export function sizeReport(sizes: Sizes): Gate {
  const count = sizes.scenes === 1 ? '1 scene' : `${sizes.scenes} scenes`;
  const details = [`animation: ${kB(sizes.animation)} after brotli (${count})`];
  for (const track of sizes.audio) {
    const total = sizes.animation + track.bytes;
    const perMinute = sizes.duration > 0 ? (total * 60) / sizes.duration : 0;
    details.push(
      `${track.src}: ${kB(track.bytes)}, total ${MB(total)}, ${MB(perMinute)} per minute`
    );
  }
  return { name: 'size', status: 'INFO', details };
}

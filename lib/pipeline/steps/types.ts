import type { CommentMeta, CommentRef, ProbeInfo, StepName } from '@/lib/types';

/** What every pipeline step is given. */
export interface StepContext {
  ref: CommentRef;
  /** The comment directory: raw captures and every derived file live here. */
  dir: string;
  meta: CommentMeta;
  /**
   * The probe of the video version the comment was made on. Reading it throws if that
   * version has no `probe.json`, so only steps that need the picture depend on it.
   */
  probe: ProbeInfo;
  log: (message: string) => void;
}

export type StepFn = (ctx: StepContext) => Promise<void>;

/** The order the steps run in. */
export const STEP_ORDER: readonly StepName[] = [
  'audio',
  'silence',
  'transcribe',
  'moments',
  'stills',
  'clip',
];

export function isStepName(value: unknown): value is StepName {
  return typeof value === 'string' && (STEP_ORDER as readonly string[]).includes(value);
}

/** File names inside a comment directory. */
export const FILES = {
  status: 'status.json',
  events: 'events.json',
  wav: 'audio16k.wav',
  transcript: 'transcript.json',
  moments: 'moments.json',
  renderDir: 'render',
  clip: 'clip.mp4',
} as const;

/** The assembled recording: `audio.mp4` for MP4 recorders (Safari), otherwise `audio.webm`. */
export function audioFileName(audioMime: string): 'audio.mp4' | 'audio.webm' {
  return /mp4|m4a|aac/i.test(audioMime) ? 'audio.mp4' : 'audio.webm';
}

/**
 * Thrown by the audio step, after it has written `events.json`, when the recording holds no
 * audio at all: the microphone was gone for the whole comment. Not a failure. The steps that
 * need sound are skipped, and the pointing still gets its moments and stills.
 */
export class NoAudioError extends Error {
  constructor() {
    super('The recording has no audio.');
    this.name = 'NoAudioError';
  }
}

/** Thrown by the silence step when the recording holds no speech. Not a failure. */
export class EmptyCommentError extends Error {
  constructor() {
    super('No speech in the recording.');
    this.name = 'EmptyCommentError';
  }
}

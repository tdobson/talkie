export interface MediaAdapter extends EventTarget {
  readonly kind: 'mp4' | 'talkie';
  readonly naturalSize: { width: number; height: number } | null;
  readonly duration: number;
  currentTime: number;
  readonly paused: boolean;
  readonly ended: boolean;
  play(): Promise<void>;
  pause(): void;
  /** Seconds per frame at the current time (constant for mp4). */
  frameDuration(): number;
  /** Active caption text at the current time, or null. Always null for mp4. */
  caption(): string | null;
  destroy(): void;
}

export type MediaAdapterEvent =
  | 'play'
  | 'pause'
  | 'seeking'
  | 'seeked'
  | 'timeupdate'
  | 'waiting'
  | 'playing'
  | 'ended'
  | 'loadedmetadata'
  | 'error';

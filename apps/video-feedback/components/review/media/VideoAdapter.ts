import type { MediaAdapterEvent } from './adapter';
import type { PlayerAdapter } from './playerAdapter';

/** Element events passed on under the same name, plus durationchange as new metadata. */
const FORWARDED: Array<[string, MediaAdapterEvent]> = [
  ['play', 'play'],
  ['pause', 'pause'],
  ['seeking', 'seeking'],
  ['seeked', 'seeked'],
  ['timeupdate', 'timeupdate'],
  ['waiting', 'waiting'],
  ['playing', 'playing'],
  ['ended', 'ended'],
  ['loadedmetadata', 'loadedmetadata'],
  ['durationchange', 'loadedmetadata'],
  ['error', 'error'],
];

/** Element events that mean the picture is waiting for data (true) or has it again (false). */
const BUFFERING: Array<[string, boolean]> = [
  ['loadstart', true],
  ['waiting', true],
  ['loadeddata', false],
  ['canplay', false],
  ['playing', false],
];

/**
 * An MP4 behind the MediaAdapter contract. It wraps a `<video>` element that React renders and
 * owns: the adapter only listens to it and drives it, and destroy() leaves the element in place.
 */
export class VideoAdapter extends EventTarget implements PlayerAdapter {
  readonly kind = 'mp4' as const;
  private readonly video: HTMLVideoElement;
  private readonly frame: () => number;
  private listeners: Array<[string, EventListener]> = [];
  private destroyed = false;

  /** `frameDuration` is read on every step, so it can follow the version being played. */
  constructor(video: HTMLVideoElement, frameDuration: () => number) {
    super();
    this.video = video;
    this.frame = frameDuration;
    for (const [from, to] of FORWARDED) {
      this.listen(from, () => this.dispatchEvent(new Event(to)));
    }
    for (const [from, buffering] of BUFFERING) {
      this.listen(from, () =>
        this.dispatchEvent(new CustomEvent('buffering', { detail: buffering }))
      );
    }
  }

  get naturalSize(): { width: number; height: number } | null {
    const { videoWidth: width, videoHeight: height } = this.video;
    return width > 0 && height > 0 ? { width, height } : null;
  }

  get duration(): number {
    return this.video.duration;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  set currentTime(t: number) {
    this.video.currentTime = t;
  }

  get paused(): boolean {
    return this.video.paused;
  }

  get ended(): boolean {
    return this.video.ended;
  }

  get failed(): boolean {
    return this.video.error != null;
  }

  async play(): Promise<void> {
    await this.video.play();
  }

  pause(): void {
    this.video.pause();
  }

  frameDuration(): number {
    return this.frame();
  }

  stepFrame(direction: 1 | -1): number {
    return this.video.currentTime + direction * this.frame();
  }

  caption(): null {
    return null;
  }

  setVolume(volume: number): void {
    this.video.volume = volume;
    this.video.muted = volume === 0;
  }

  override dispatchEvent(event: Event): boolean {
    return this.destroyed ? false : super.dispatchEvent(event);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [type, listener] of this.listeners) {
      this.video.removeEventListener(type, listener);
    }
    this.listeners = [];
  }

  private listen(type: string, listener: EventListener): void {
    this.video.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }
}

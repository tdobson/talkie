import type { TalkieFilm } from '@talkie/format';
import type { Cue } from '@talkie/player';
import type { TalkieEngineLike } from './TalkieAdapter';

/**
 * Test double: a `<video>` element for jsdom that behaves like a 320x180, 4 second video. Play,
 * pause and seeking fire the events a browser would.
 */
export function fakeVideo(): { video: HTMLVideoElement; loadMetadata: () => void } {
  const video = document.createElement('video');
  let time = 0;
  let paused = true;
  let loaded = false;
  const fire = (type: string) => video.dispatchEvent(new Event(type));
  Object.defineProperties(video, {
    videoWidth: { configurable: true, get: () => (loaded ? 320 : 0) },
    videoHeight: { configurable: true, get: () => (loaded ? 180 : 0) },
    duration: { configurable: true, get: () => (loaded ? 4 : Number.NaN) },
    paused: { configurable: true, get: () => paused },
    currentTime: {
      configurable: true,
      get: () => time,
      set: (t: number) => {
        time = t;
        fire('seeking');
        fire('seeked');
      },
    },
  });
  video.play = async () => {
    paused = false;
    fire('play');
    fire('playing');
  };
  video.pause = () => {
    if (paused) return;
    paused = true;
    fire('pause');
  };
  return {
    video,
    loadMetadata: () => {
      loaded = true;
      fire('loadedmetadata');
    },
  };
}

/** Test double: the part of TalkieEngine the adapter uses, with no canvas and no audio. */
export class FakeEngine extends EventTarget implements TalkieEngineLike {
  film: TalkieFilm | null = null;
  cues: Cue[] = [];
  paused = true;
  ended = false;
  volume = 1;
  muted = false;
  destroyed = false;
  loaded: string[] = [];
  /** Set to make load() fail the way the engine does: an error event, then a rejection. */
  failWith: Error | null = null;
  /** Set to make play() reject, as a browser does when it refuses to start playback. */
  refusePlay: Error | null = null;
  private time = 0;
  private readonly source: TalkieFilm;
  private readonly sourceCues: Cue[];

  constructor(source: TalkieFilm, sourceCues: Cue[] = []) {
    super();
    this.source = source;
    this.sourceCues = sourceCues;
  }

  async load(input: unknown): Promise<TalkieFilm> {
    this.loaded.push(String(input));
    if (this.failWith) {
      this.dispatchEvent(new CustomEvent('error', { detail: this.failWith }));
      throw this.failWith;
    }
    this.film = this.source;
    this.cues = this.sourceCues;
    this.dispatchEvent(new Event('loadedmetadata'));
    return this.source;
  }

  async play(): Promise<void> {
    if (this.refusePlay) throw this.refusePlay;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('playing'));
  }

  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  }

  get currentTime(): number {
    return this.time;
  }

  set currentTime(t: number) {
    if (!this.film) return;
    this.time = Math.min(Math.max(t, 0), this.film.duration);
    this.dispatchEvent(new Event('seeking'));
    this.dispatchEvent(new Event('seeked'));
  }

  get duration(): number {
    return this.film ? this.film.duration : Number.NaN;
  }

  /** Moves the playhead as playback would: a timeupdate and no seek events. */
  advanceTo(t: number): void {
    this.time = t;
    this.dispatchEvent(new Event('timeupdate'));
  }

  /** Ends playback as the narration running out would. */
  finish(): void {
    this.time = this.duration;
    this.ended = true;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }

  warn(sceneId: string): void {
    this.dispatchEvent(
      new CustomEvent('scenewarning', { detail: { sceneId, error: new Error('gone') } })
    );
  }

  destroy(): void {
    this.destroyed = true;
  }
}

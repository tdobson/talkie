import {
  chapterAt,
  frameFor,
  openFilm,
  sceneAt,
  TalkieError,
  type FilmInput,
  type FilmSource,
  type TalkieFilm,
} from '@talkie/format';
import { pickAudio } from './audio-select';
import { createDotLottieRenderer } from './dotlottie-renderer';
import type { CreateRenderer } from './renderer';
import { SceneSlots } from './scene-slots';
import { SmoothClock } from './smooth-clock';
import { parseVtt, type Cue } from './vtt';

export interface EngineOptions {
  container: HTMLElement;
  createRenderer?: CreateRenderer;
  raf?: (cb: FrameRequestCallback) => number;
  cancelRaf?: (id: number) => void;
  now?: () => number;
  debug?: boolean;
}

/** Audio events passed straight on to listeners of the engine. */
const FORWARDED = [
  'play',
  'playing',
  'pause',
  'seeking',
  'seeked',
  'waiting',
  'ended',
  'ratechange',
  'volumechange',
] as const;

/** These audio events can change what should be on screen, so each one wakes the frame loop. */
const WAKE = new Set<string>(['play', 'playing', 'pause', 'seeking', 'seeked', 'ended']);

const TIMEUPDATE_MS = 250;

/**
 * Plays a Talkie film with no UI: one audio element is the clock, two stacked canvases show the
 * scene for the current time. Mirrors the HTMLMediaElement API and events.
 *
 * Events: play, playing, pause, seeking, seeked, waiting, ended, ratechange, volumechange,
 * timeupdate, loadedmetadata, chapterchange (detail `{ index }`), error (detail TalkieError),
 * scenewarning (detail `{ sceneId, error }`) and, with `debug`, frame (detail
 * `{ filmTime, audioTime }`).
 */
export class TalkieEngine extends EventTarget {
  /** The clock. Exposed for integrations such as Media Session; drive playback through the engine. */
  readonly audio: HTMLAudioElement;

  private opts: EngineOptions;
  private now: () => number;
  private raf: (cb: FrameRequestCallback) => number;
  private cancelRaf: (id: number) => void;
  private clock: SmoothClock;
  private slots: SceneSlots | null = null;
  private source: FilmSource | null = null;
  private currentFilm: TalkieFilm | null = null;
  private currentCues: Cue[] = [];
  private loadId = 0;
  private rafId: number | null = null;
  private chapter = -1;
  private lastTimeupdate = -Infinity;
  private metadataSent = false;
  private pendingTime: number | null = null;
  /** Film time last asked for through renderAt. It stays on screen until the audio moves. */
  private held: number | null = null;
  private wantPlaying = false;
  private destroyed = false;
  private listeners: Array<[string, EventListener]> = [];

  constructor(opts: EngineOptions) {
    super();
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
    this.raf = opts.raf ?? ((cb) => requestAnimationFrame(cb));
    this.cancelRaf = opts.cancelRaf ?? ((id) => cancelAnimationFrame(id));
    this.clock = new SmoothClock(this.now);
    this.audio = document.createElement('audio');
    this.audio.preload = 'metadata';

    for (const type of FORWARDED) {
      this.listen(type, () => {
        this.dispatchEvent(new Event(type));
        if (WAKE.has(type)) {
          this.wake();
        }
      });
    }
    this.listen('loadedmetadata', () => {
      if (this.pendingTime !== null) {
        this.audio.currentTime = this.pendingTime;
        this.pendingTime = null;
      }
      this.maybeSendMetadata();
    });
    this.listen('error', () => {
      if (!this.currentFilm) {
        return;
      }
      const code = this.audio.error?.code;
      this.fail(
        code === 4
          ? new TalkieError('no-playable-audio', 'the browser could not decode the narration')
          : new TalkieError('network', 'the narration could not be loaded', this.audio.error)
      );
    });
  }

  get film(): TalkieFilm | null {
    return this.currentFilm;
  }

  get cues(): Cue[] {
    return this.currentCues;
  }

  /** Open a film and show its first frame (or the frame at `start`). Rejects with a TalkieError. */
  async load(input: FilmInput, opts: { start?: number } = {}): Promise<TalkieFilm> {
    const id = ++this.loadId;
    this.unload();
    try {
      const { film, source } = await openFilm(input);
      if (id !== this.loadId || this.destroyed) {
        source.dispose();
        throw new TalkieError('invalid-film', 'the load was replaced by a newer one');
      }
      this.source = source;
      const track = pickAudio(film.audio, (type) => this.audio.canPlayType(type));
      const [audioUrl, cues] = await Promise.all([source.url(track.src), loadCues(film, source)]);
      if (id !== this.loadId || this.destroyed) {
        throw new TalkieError('invalid-film', 'the load was replaced by a newer one');
      }
      this.currentFilm = film;
      this.currentCues = cues;
      this.slots = new SceneSlots({
        container: this.opts.container,
        createRenderer: this.opts.createRenderer ?? createDotLottieRenderer,
        loadScene: (index) => source.json(film.scenes[index]!.src),
        onShow: () => this.draw(),
        onFail: (index, cause) => {
          const sceneId = film.scenes[index]!.id;
          const error = new TalkieError(
            'scene-failed',
            `scene ${sceneId} could not be loaded`,
            cause
          );
          this.dispatchEvent(new CustomEvent('scenewarning', { detail: { sceneId, error } }));
        },
      });
      const start = Math.min(Math.max(opts.start ?? 0, 0), film.duration);
      this.pendingTime = start > 0 ? start : null;
      this.audio.preload = 'metadata';
      this.audio.src = audioUrl;
      this.chapter = chapterAt(film, start);
      await this.renderAt(start);
      this.maybeSendMetadata();
      return film;
    } catch (cause) {
      const error =
        cause instanceof TalkieError
          ? cause
          : new TalkieError('invalid-film', 'the film could not be opened', cause);
      if (id === this.loadId && !this.destroyed) {
        this.fail(error);
      }
      throw error;
    }
  }

  async play(): Promise<void> {
    this.wantPlaying = true;
    await this.audio.play();
  }

  pause(): void {
    this.wantPlaying = false;
    this.audio.pause();
  }

  get currentTime(): number {
    if (!this.currentFilm) {
      return 0;
    }
    const t = this.pendingTime ?? this.audio.currentTime;
    return Math.min(Math.max(t, 0), this.currentFilm.duration);
  }

  set currentTime(t: number) {
    if (!this.currentFilm || !Number.isFinite(t)) {
      return;
    }
    const time = Math.min(Math.max(t, 0), this.currentFilm.duration);
    if (this.audio.readyState < 1) {
      // No metadata yet, so the element cannot seek. Hold the time and show its picture now.
      this.pendingTime = time;
      void this.renderAt(time);
      return;
    }
    this.audio.currentTime = time;
    this.held = null;
    this.wake();
  }

  /** The film's length in seconds, from talkie.json. NaN until a film is loaded. */
  get duration(): number {
    return this.currentFilm ? this.currentFilm.duration : NaN;
  }

  get paused(): boolean {
    return this.audio.paused;
  }

  get ended(): boolean {
    return this.audio.ended;
  }

  get playbackRate(): number {
    return this.audio.playbackRate;
  }

  set playbackRate(rate: number) {
    this.audio.playbackRate = rate;
  }

  get volume(): number {
    return this.audio.volume;
  }

  set volume(volume: number) {
    this.audio.volume = volume;
  }

  get muted(): boolean {
    return this.audio.muted;
  }

  set muted(muted: boolean) {
    this.audio.muted = muted;
  }

  /**
   * Load the scene for film time `t` if needed, set its frame, and resolve after the draw. Used
   * for export and previews. It does not move the audio. Resolves without drawing if the scene
   * cannot be loaded (a scenewarning event says so).
   */
  async renderAt(t: number): Promise<void> {
    const film = this.currentFilm;
    const slots = this.slots;
    if (!film || !slots) {
      return;
    }
    this.held = t;
    const pos = sceneAt(film, t);
    let slot = slots.show(pos.index);
    if (!slot && !slots.hasFailed(pos.index)) {
      await slots.settled();
      if (this.slots !== slots || this.held !== t) {
        return;
      }
      slot = slots.show(pos.index);
    }
    if (slot?.timing) {
      const { fr, ip, op } = slot.timing;
      slot.renderer.setFrame(frameFor(pos.localTime, fr, ip, op));
    }
  }

  /** After a network error: reload the audio and carry on from the same time. */
  async retry(): Promise<void> {
    if (!this.currentFilm) {
      return;
    }
    const time = this.currentTime;
    const resume = this.wantPlaying;
    this.pendingTime = time;
    this.audio.load();
    if (resume) {
      await this.audio.play();
    }
  }

  /** Redraw at the new canvas size. The default renderer resizes itself; call this for others. */
  resize(): void {
    this.slots?.resize();
    this.draw();
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.loadId++;
    for (const [type, listener] of this.listeners) {
      this.audio.removeEventListener(type, listener);
    }
    this.listeners = [];
    this.audio.pause();
    this.unload();
  }

  private listen(type: string, listener: EventListener): void {
    this.audio.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }

  private unload(): void {
    if (this.rafId !== null) {
      this.cancelRaf(this.rafId);
      this.rafId = null;
    }
    this.slots?.destroy();
    this.slots = null;
    this.source?.dispose();
    this.source = null;
    this.currentFilm = null;
    this.currentCues = [];
    this.chapter = -1;
    this.lastTimeupdate = -Infinity;
    this.metadataSent = false;
    this.pendingTime = null;
    this.held = null;
    if (this.audio.hasAttribute('src')) {
      this.audio.removeAttribute('src');
    }
  }

  private fail(error: TalkieError): void {
    this.dispatchEvent(new CustomEvent('error', { detail: error }));
  }

  private maybeSendMetadata(): void {
    if (this.metadataSent || !this.currentFilm || !this.slots || this.audio.readyState < 1) {
      return;
    }
    this.metadataSent = true;
    this.dispatchEvent(new Event('loadedmetadata'));
  }

  private get running(): boolean {
    return (!this.audio.paused && !this.audio.ended) || this.audio.seeking;
  }

  /** Draw now, and keep drawing each animation frame while the film is playing or seeking. */
  private wake(): void {
    if (this.rafId !== null || !this.currentFilm) {
      return;
    }
    this.rafId = this.raf(() => {
      this.rafId = null;
      this.held = null;
      this.draw();
      if (this.running) {
        this.wake();
      }
    });
  }

  private draw(): void {
    const film = this.currentFilm;
    const slots = this.slots;
    if (!film || !slots) {
      return;
    }
    const audio = this.audio;
    const audioTime = this.pendingTime ?? audio.currentTime;
    const read = this.clock.read({
      currentTime: audioTime,
      paused: audio.paused || audio.ended,
      seeking: audio.seeking,
      playbackRate: audio.playbackRate,
    });
    const running = this.running;
    const time = running ? read : (this.held ?? read);
    const t = Math.min(Math.max(time, 0), film.duration);
    const pos = sceneAt(film, t);
    const slot = slots.show(pos.index);
    if (slot?.timing) {
      const { fr, ip, op } = slot.timing;
      slot.renderer.setFrame(frameFor(pos.localTime, fr, ip, op));
      if (running && pos.index + 1 < film.scenes.length) {
        slots.prefetch(pos.index + 1);
      }
    }
    if (this.opts.debug) {
      this.dispatchEvent(new CustomEvent('frame', { detail: { filmTime: t, audioTime } }));
    }
    const chapter = chapterAt(film, t);
    if (chapter !== this.chapter) {
      this.chapter = chapter;
      this.dispatchEvent(new CustomEvent('chapterchange', { detail: { index: chapter } }));
    }
    const wall = this.now();
    if (!running || wall - this.lastTimeupdate >= TIMEUPDATE_MS) {
      this.lastTimeupdate = wall;
      this.dispatchEvent(new Event('timeupdate'));
    }
  }
}

/** Cues of the film's first captions track. Captions are optional, so a failure gives none. */
async function loadCues(film: TalkieFilm, source: FilmSource): Promise<Cue[]> {
  const track = film.captions[0];
  if (!track) {
    return [];
  }
  try {
    const response = await fetch(await source.url(track.src));
    return response.ok ? parseVtt(await response.text()) : [];
  } catch {
    return [];
  }
}

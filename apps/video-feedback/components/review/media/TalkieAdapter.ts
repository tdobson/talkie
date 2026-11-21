// Loaded with a dynamic import from an effect in Player.tsx, never on the server: the engine
// behind it draws with WebAssembly and needs a document.
import { openFilm, sceneAt, type TalkieFilm } from '@talkie/format';
import type { Cue, TalkieEngine } from '@talkie/player';
import type { MediaAdapterEvent } from './adapter';
import type { PlayerAdapter, SceneWarningDetail } from './playerAdapter';

/** The part of TalkieEngine the adapter uses. Tests fake exactly this. */
export interface TalkieEngineLike extends EventTarget {
  readonly film: TalkieEngine['film'];
  readonly cues: TalkieEngine['cues'];
  load(input: string): Promise<TalkieFilm>;
  play(): Promise<void>;
  pause(): void;
  currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  readonly ended: boolean;
  volume: number;
  muted: boolean;
  destroy(): void;
}

export interface TalkieAdapterOptions {
  /** The film folder: `talkie.json` and everything it lists are fetched relative to it. */
  filmUrl: string;
  /** Reads one scene's Lottie JSON by its path in the film. */
  sceneJson: (src: string) => Promise<unknown>;
  /** Called by destroy(), after the engine has gone. */
  dispose?: () => void;
}

/** Engine events passed on under the same name. */
const FORWARDED: MediaAdapterEvent[] = [
  'play',
  'pause',
  'seeking',
  'seeked',
  'timeupdate',
  'waiting',
  'playing',
  'ended',
  'loadedmetadata',
];

/** Used for frame stepping until a scene's own rate has been read, or if it cannot be. */
const DEFAULT_FR = 30;
/** Two times closer than this are the same frame boundary. */
const EPSILON = 1e-6;

/** Cue text as plain text: WebVTT tags such as <v Name> and <i> are dropped. */
export function cueText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function frameRateOf(scene: unknown): number {
  const fr = (scene as { fr?: unknown } | null)?.fr;
  return typeof fr === 'number' && Number.isFinite(fr) && fr > 0 ? fr : DEFAULT_FR;
}

/**
 * A Talkie film behind the MediaAdapter contract: a TalkieEngine with no controls of its own,
 * so nothing it draws can show a timecode. The engine's audio element is the clock.
 */
export class TalkieAdapter extends EventTarget implements PlayerAdapter {
  readonly kind = 'talkie' as const;
  private readonly engine: TalkieEngineLike;
  private readonly options: TalkieAdapterOptions;
  private listeners: Array<[string, EventListener]> = [];
  /** Frames a second of each scene read so far, by scene index. */
  private readonly rates = new Map<number, number>();
  private readonly reading = new Set<number>();
  private hasFailed = false;
  private destroyed = false;

  constructor(engine: TalkieEngineLike, options: TalkieAdapterOptions) {
    super();
    this.engine = engine;
    this.options = options;
    for (const type of FORWARDED) {
      this.listen(type, () => this.dispatchEvent(new Event(type)));
    }
    this.listen('waiting', () => this.buffering(true));
    this.listen('playing', () => {
      this.hasFailed = false;
      this.buffering(false);
    });
    // Frame steps happen while paused, so the rates they need are read as soon as it stops.
    for (const type of ['pause', 'seeked', 'loadedmetadata']) {
      this.listen(type, () => this.readRates());
    }
    this.listen('error', (e) => {
      // invalid-film, unsupported-version, network or no-playable-audio: all end the same way
      // for the reviewer, with the error panel and its Reload button.
      const code = (e as CustomEvent<{ code?: string } | null>).detail?.code ?? 'invalid-film';
      this.hasFailed = true;
      this.dispatchEvent(new CustomEvent('error', { detail: code }));
    });
    this.listen('scenewarning', (e) => {
      const sceneId = (e as CustomEvent<{ sceneId?: unknown } | null>).detail?.sceneId;
      if (typeof sceneId !== 'string') return;
      const detail: SceneWarningDetail = { sceneId };
      this.dispatchEvent(new CustomEvent('scenewarning', { detail }));
    });
  }

  /**
   * Opens the film and shows its first frame. Never rejects: a film that cannot be opened is
   * reported through the `error` event. Call it after listening, so nothing is missed.
   */
  async load(): Promise<void> {
    if (this.destroyed) return;
    this.buffering(true);
    try {
      await this.engine.load(this.options.filmUrl);
    } catch {
      // The engine has already sent its error event. If it somehow did not, say so now.
      if (!this.hasFailed) {
        this.hasFailed = true;
        this.dispatchEvent(new CustomEvent('error', { detail: 'invalid-film' }));
      }
      return;
    }
    this.readRates();
    this.buffering(false);
  }

  get naturalSize(): { width: number; height: number } | null {
    const film = this.engine.film;
    return film ? { width: film.size[0], height: film.size[1] } : null;
  }

  get duration(): number {
    return this.engine.film ? this.engine.film.duration : Number.NaN;
  }

  get currentTime(): number {
    return this.engine.currentTime;
  }

  set currentTime(t: number) {
    if (this.destroyed) return;
    this.engine.currentTime = t;
  }

  get paused(): boolean {
    return this.engine.paused;
  }

  get ended(): boolean {
    return this.engine.ended;
  }

  get failed(): boolean {
    return this.hasFailed;
  }

  async play(): Promise<void> {
    if (this.destroyed) return;
    await this.engine.play();
  }

  pause(): void {
    if (this.destroyed) return;
    this.engine.pause();
  }

  frameDuration(): number {
    const film = this.engine.film;
    if (!film) return 1 / DEFAULT_FR;
    return 1 / this.rateOf(sceneAt(film, this.currentTime).index);
  }

  stepFrame(direction: 1 | -1): number {
    const film = this.engine.film;
    const t = this.currentTime;
    if (!film) return t + direction / DEFAULT_FR;
    const { index, scene, localTime } = sceneAt(film, t);
    if (direction === 1) {
      const to = t + 1 / this.rateOf(index);
      // Scenes need not share a frame grid: a step that would cross into the next scene lands
      // on its first frame, exactly, instead of somewhere inside it.
      const crosses = index < film.scenes.length - 1 && to > scene.end - EPSILON;
      return crosses ? scene.end : to;
    }
    // On a scene's first frame the frame before is the earlier scene's last one.
    const from = index > 0 && localTime < EPSILON ? index - 1 : index;
    return t - 1 / this.rateOf(from);
  }

  caption(): string | null {
    const t = this.currentTime;
    for (const cue of this.engine.cues as Cue[]) {
      if (cue.start > t) break;
      if (t < cue.end) return cueText(cue.text);
    }
    return null;
  }

  setVolume(volume: number): void {
    this.engine.volume = volume;
    this.engine.muted = volume === 0;
  }

  override dispatchEvent(event: Event): boolean {
    return this.destroyed ? false : super.dispatchEvent(event);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [type, listener] of this.listeners) {
      this.engine.removeEventListener(type, listener);
    }
    this.listeners = [];
    this.engine.destroy();
    this.options.dispose?.();
  }

  private listen(type: string, listener: EventListener): void {
    this.engine.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }

  private buffering(waiting: boolean): void {
    this.dispatchEvent(new CustomEvent('buffering', { detail: waiting }));
  }

  private rateOf(index: number): number {
    const known = this.rates.get(index);
    if (known !== undefined) return known;
    this.readRate(index);
    return DEFAULT_FR;
  }

  /** Reads the rates a step from here could need: this scene's and the one before it. */
  private readRates(): void {
    const film = this.engine.film;
    if (!film) return;
    const { index } = sceneAt(film, this.currentTime);
    this.readRate(index);
    if (index > 0) this.readRate(index - 1);
  }

  private readRate(index: number): void {
    const scene = this.engine.film?.scenes[index];
    if (!scene || this.destroyed || this.rates.has(index) || this.reading.has(index)) return;
    this.reading.add(index);
    this.options
      .sceneJson(scene.src)
      .then(
        (json) => this.rates.set(index, frameRateOf(json)),
        () => {
          // Not cached: the next step asks again. Until then the step is 1/30 s.
        }
      )
      .finally(() => this.reading.delete(index));
  }
}

/**
 * Mounts a TalkieEngine in `container` and wraps it. The film is not opened yet: add listeners,
 * then call load().
 */
export async function mountTalkieAdapter(
  container: HTMLElement,
  filmUrl: string
): Promise<TalkieAdapter> {
  const { TalkieEngine } = await import('@talkie/player');
  const engine = new TalkieEngine({ container });
  // The engine keeps its film source to itself, so scene JSON is read through a second one. It
  // asks for the same URLs the engine does, which the browser already has in its cache.
  let opened: ReturnType<typeof openFilm> | null = null;
  const source = () => {
    opened ??= openFilm(filmUrl);
    // A failed open is not kept, so a later step can try again.
    opened.catch(() => {
      opened = null;
    });
    return opened;
  };
  return new TalkieAdapter(engine, {
    filmUrl,
    sceneJson: async (src) => (await source()).source.json(src),
    dispose: () => {
      void opened?.then(
        (film) => film.source.dispose(),
        () => {}
      );
    },
  });
}

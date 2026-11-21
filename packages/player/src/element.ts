import { openFilm, sceneAt, type TalkieError, type TalkieFilm } from '@talkie/format';
import { createDotLottieRenderer, setWasmUrl } from './engine/dotlottie-renderer';
import { TalkieEngine, type EngineOptions } from './engine/engine';
import type { CreateRenderer } from './engine/renderer';
import { CaptionsView } from './ui/captions-view';
import { AutoHide, Controls, type ControlsHost } from './ui/controls';
import { formatTime } from './ui/format-time';
import { isFullscreen, toggleFullscreen, watchFullscreen } from './ui/fullscreen';
import { keyAction, type KeyAction } from './ui/keyboard';
import { attachMediaSession } from './ui/media-session';
import { Preview } from './ui/preview';
import { Resume, resumeKey } from './ui/resume';
import { Scrubber } from './ui/scrubber';
import { renderTemplate, type TemplateRefs } from './ui/template';
import { attachTouch } from './ui/touch';

/** The public face of the engine, which is all the element uses. Tests swap in a fake. */
export type PlayerEngine = Pick<TalkieEngine, keyof TalkieEngine>;

export type TalkieSource = Blob | ArrayBuffer | Uint8Array;

/** Engine events the element passes on to the page. */
const REDISPATCHED = [
  'loadedmetadata',
  'play',
  'playing',
  'pause',
  'timeupdate',
  'seeking',
  'seeked',
  'waiting',
  'ended',
  'ratechange',
  'volumechange',
  'chapterchange',
  'error',
  'scenewarning',
  'frame',
] as const;

const MESSAGES: Record<string, string> = {
  'no-playable-audio': 'This browser cannot play the sound for this film.',
  'unsupported-version':
    'This film was made for a newer version of the player. Update the player to watch it.',
  'invalid-film': 'This film cannot be played because its files are not valid.',
  network: 'The film could not be loaded. Check your connection and try again.',
};

// On a server there is no HTMLElement. A stand-in keeps this module importable there (Next.js
// renders pages on the server first); the element is only ever defined in a browser.
const Base = (typeof HTMLElement === 'undefined' ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * `<talkie-player>`: plays a Talkie film with YouTube-style controls.
 *
 * Attributes: `src`, `controls` (on unless "false"), `autoplay` (plays muted), `start`,
 * `captions` (a language, or "off"), `poster`, `wasm-url`, `debug`. Property `source` takes the
 * bytes of a `.lottie`. Properties, methods and events mirror HTMLMediaElement, plus
 * `chapterchange`, `scenewarning` and (with `debug`) `frame`.
 */
export class TalkiePlayerElement extends Base implements ControlsHost {
  static observedAttributes = [
    'src',
    'controls',
    'autoplay',
    'start',
    'captions',
    'poster',
    'wasm-url',
    'debug',
  ];

  /** Makes the engine. Tests replace this to inject a fake. */
  static engineFactory: (opts: EngineOptions) => PlayerEngine = (opts) => new TalkieEngine(opts);

  /** Makes the renderer for the scrub-bar preview. */
  static previewRenderer: CreateRenderer = createDotLottieRenderer;

  private engine: PlayerEngine | null = null;
  private refs: TemplateRefs | null = null;
  private controls: Controls | null = null;
  private autoHide: AutoHide | null = null;
  private scrubber: Scrubber | null = null;
  private captionsView: CaptionsView | null = null;
  private preview: Preview | null = null;
  private resume: Resume | null = null;
  private filmStyle: HTMLStyleElement | null = null;
  private teardown: Array<() => void> = [];
  private detachMediaSession: (() => void) | null = null;
  private sourceValue: TalkieSource | null = null;
  private pending: { volume?: number; muted?: boolean; playbackRate?: number } = {};
  private loadQueued = false;
  private loadSeq = 0;
  private loading = false;
  private waiting = false;
  private started = false;
  private autoMuted = false;
  private posterUrl: string | null = null;
  private failedScenes = new Set<string>();

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  // Lifecycle

  connectedCallback(): void {
    if (this.engine) {
      return;
    }
    if (!this.hasAttribute('tabindex')) {
      this.tabIndex = 0;
    }
    const refs = renderTemplate(this.shadowRoot!);
    this.refs = refs;
    this.filmStyle = document.createElement('style');
    this.shadowRoot!.append(this.filmStyle);

    const engine = TalkiePlayerElement.engineFactory({
      container: refs.canvases,
      debug: this.hasAttribute('debug'),
    });
    this.engine = engine;
    if (this.pending.volume !== undefined) {
      engine.volume = this.pending.volume;
    }
    if (this.pending.muted !== undefined) {
      engine.muted = this.pending.muted;
    }
    if (this.pending.playbackRate !== undefined) {
      engine.playbackRate = this.pending.playbackRate;
    }
    this.pending = {};

    this.autoHide = new AutoHide(refs.root);
    this.captionsView = new CaptionsView(refs.captions, refs.plate);
    this.controls = new Controls(refs, this, () => this.autoHide?.hold(this.controls!.menuOpen));
    this.scrubber = new Scrubber(refs.scrubber, refs.segments, refs.thumb, {
      onSeek: (time, final) => this.onScrub(time, final),
      onHover: (time, fraction) => this.showPreview(time, fraction),
      onHoverEnd: () => {
        refs.preview.hidden = true;
      },
    });

    this.started = false;
    this.wireEngine(engine);
    this.wireUi(refs);
    this.applyControls();
    this.controls.syncAll();
    this.refresh();
    this.scheduleLoad();
  }

  disconnectedCallback(): void {
    this.saveResume();
    for (const undo of this.teardown) {
      undo();
    }
    this.teardown = [];
    this.detachMediaSession?.();
    this.detachMediaSession = null;
    this.autoHide?.destroy();
    this.preview?.destroy();
    this.preview = null;
    this.engine?.destroy();
    this.engine = null;
    this.loadSeq++;
    this.refs = null;
    this.controls = null;
    this.autoHide = null;
    this.scrubber = null;
    this.captionsView = null;
    this.resume = null;
  }

  attributeChangedCallback(name: string, before: string | null, now: string | null): void {
    if (before === now || !this.engine) {
      return;
    }
    if (name === 'src') {
      this.scheduleLoad();
    } else if (name === 'controls') {
      this.applyControls();
    } else if (name === 'captions') {
      this.controls?.syncCaptions();
      this.updateCaptions();
    } else if (name === 'poster') {
      this.updatePoster();
    }
    // start, autoplay and wasm-url are read when a film loads; debug when the element connects.
  }

  // Media API

  /** The bytes of a `.lottie` to play in place of `src`. */
  get source(): TalkieSource | null {
    return this.sourceValue;
  }

  set source(value: TalkieSource | null) {
    this.sourceValue = value ?? null;
    this.scheduleLoad();
  }

  get film(): TalkieFilm | null {
    return this.engine?.film ?? null;
  }

  play(): Promise<void> {
    return this.engine ? this.engine.play() : Promise.resolve();
  }

  pause(): void {
    this.engine?.pause();
  }

  /** After a network error: try again from the same time. */
  retry(): void {
    this.hideError();
    if (this.engine?.film) {
      this.engine.retry().catch(() => undefined);
    } else {
      this.scheduleLoad();
    }
  }

  get currentTime(): number {
    return this.engine?.currentTime ?? 0;
  }

  set currentTime(time: number) {
    if (this.engine) {
      this.engine.currentTime = time;
      this.refresh();
    }
  }

  get duration(): number {
    return this.engine?.duration ?? NaN;
  }

  get paused(): boolean {
    return this.engine?.paused ?? true;
  }

  get ended(): boolean {
    return this.engine?.ended ?? false;
  }

  get playbackRate(): number {
    return this.engine?.playbackRate ?? this.pending.playbackRate ?? 1;
  }

  set playbackRate(rate: number) {
    if (this.engine) {
      this.engine.playbackRate = rate;
      this.controls?.syncRate();
    } else {
      this.pending.playbackRate = rate;
    }
  }

  get volume(): number {
    return this.engine?.volume ?? this.pending.volume ?? 1;
  }

  set volume(volume: number) {
    if (this.engine) {
      this.engine.volume = volume;
      this.controls?.syncVolume();
    } else {
      this.pending.volume = volume;
    }
  }

  get muted(): boolean {
    return this.engine?.muted ?? this.pending.muted ?? false;
  }

  set muted(muted: boolean) {
    if (this.engine) {
      this.engine.muted = muted;
      this.controls?.syncVolume();
    } else {
      this.pending.muted = muted;
    }
  }

  // What the control bar asks of the element

  get captionsOn(): boolean {
    const value = this.getAttribute('captions');
    return value !== null && value !== 'off';
  }

  get hasCaptions(): boolean {
    return (this.engine?.cues.length ?? 0) > 0;
  }

  get isFullscreen(): boolean {
    return isFullscreen(this);
  }

  togglePlay(): void {
    if (!this.engine) {
      return;
    }
    if (this.engine.paused || this.engine.ended) {
      // Browsers reject play() without a tap, or when the load failed. The UI already shows why.
      this.engine.play().catch(() => undefined);
    } else {
      this.engine.pause();
    }
  }

  toggleCaptions(): void {
    const lang = this.engine?.film?.captions[0]?.lang ?? 'on';
    this.setAttribute('captions', this.captionsOn ? 'off' : lang);
  }

  toggleFullscreen(): void {
    void toggleFullscreen(this);
  }

  // Wiring

  private wireEngine(engine: PlayerEngine): void {
    const on = (type: string, listener: (event: Event) => void) => {
      engine.addEventListener(type, listener);
      this.teardown.push(() => engine.removeEventListener(type, listener));
    };

    on('play', () => {
      this.started = true;
      this.autoHide?.setPlaying(true);
      this.refreshChrome();
    });
    on('playing', () => {
      this.waiting = false;
      this.hideError();
      this.refreshChrome();
    });
    on('pause', () => {
      this.waiting = false;
      this.autoHide?.setPlaying(false);
      this.saveResume();
      this.refreshChrome();
    });
    on('ended', () => {
      this.waiting = false;
      this.autoHide?.setPlaying(false);
      this.saveResume();
      this.refreshChrome();
    });
    on('waiting', () => {
      this.waiting = true;
      this.refreshChrome();
    });
    on('seeked', () => this.refresh());
    on('timeupdate', () => {
      this.refresh();
      const e = this.engine;
      if (e && !e.paused && e.film) {
        this.resume?.update(e.currentTime, e.film.duration);
      }
    });
    on('ratechange', () => this.controls?.syncRate());
    on('volumechange', () => {
      if (!engine.muted) {
        this.autoMuted = false;
      }
      this.controls?.syncVolume();
      this.refreshChrome();
    });
    on('chapterchange', () => this.controls?.syncChapter());
    on('scenewarning', (event) => {
      const id = (event as CustomEvent<{ sceneId: string }>).detail?.sceneId;
      if (id) {
        this.failedScenes.add(id);
        this.updatePoster();
      }
    });
    on('error', (event) => this.showError((event as CustomEvent<TalkieError>).detail));

    // The page listens on the element, so pass each engine event on once the UI has seen it.
    for (const type of REDISPATCHED) {
      on(type, (event) => {
        const init = { composed: true };
        this.dispatchEvent(
          event instanceof CustomEvent
            ? new CustomEvent(type, { ...init, detail: event.detail })
            : new Event(type, init)
        );
      });
    }
  }

  private wireUi(refs: TemplateRefs): void {
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      listener: (event: HTMLElementEventMap[K]) => void
    ) => {
      this.addEventListener(type, listener);
      this.teardown.push(() => this.removeEventListener(type, listener));
    };

    // On a touch screen a tap on the picture toggles the controls (see attachTouch), so only
    // touches on the bar itself count as activity here.
    const pointer = (event: PointerEvent) => {
      if (event.pointerType !== 'touch' || event.composedPath().includes(refs.bar)) {
        this.autoHide?.activity();
      }
    };
    listen('pointermove', pointer);
    listen('pointerdown', pointer);
    listen('focusin', () => this.autoHide?.activity());
    listen('keydown', (event) => this.onKeyDown(event));

    this.teardown.push(
      attachTouch(
        refs.stage,
        { back: refs.rippleBack, forward: refs.rippleForward },
        {
          onToggleControls: () => {
            if (this.controls?.menuOpen) {
              this.closeMenus();
            } else if (!this.started) {
              this.togglePlay();
            } else {
              this.autoHide?.toggle();
            }
          },
          onSkip: (seconds) => {
            this.controls?.skip(seconds);
            this.autoHide?.activity();
          },
          onClick: () => {
            if (this.controls?.menuOpen) {
              this.closeMenus();
            } else {
              this.togglePlay();
            }
          },
        }
      )
    );

    const stop = (fn: () => void) => (event: Event) => {
      event.stopPropagation();
      fn();
    };
    refs.bigPlay.addEventListener(
      'click',
      stop(() => this.togglePlay())
    );
    refs.unmute.addEventListener(
      'click',
      stop(() => {
        this.autoMuted = false;
        this.muted = false;
        this.refreshChrome();
      })
    );
    refs.retry.addEventListener(
      'click',
      stop(() => this.retry())
    );
    refs.error.addEventListener('click', (event) => event.stopPropagation());

    this.teardown.push(
      watchFullscreen(this, () => {
        this.controls?.syncFullscreen();
        this.engine?.resize();
      })
    );
  }

  private closeMenus(): void {
    this.controls?.closeMenus();
    this.autoHide?.hold(false);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !this.engine) {
      return;
    }
    const target = event.composedPath()[0];
    // Space and Enter on a focused button press that button.
    if ((event.key === ' ' || event.key === 'Enter') && target instanceof HTMLButtonElement) {
      return;
    }
    const action = keyAction(event.key, {
      currentTime: this.currentTime,
      duration: this.duration,
      volume: this.volume,
    });
    if (action) {
      event.preventDefault();
      this.apply(action);
    }
  }

  private apply(action: KeyAction): void {
    switch (action.type) {
      case 'toggle-play':
        this.togglePlay();
        break;
      case 'seek':
        this.currentTime = action.time;
        break;
      case 'volume':
        this.volume = action.volume;
        break;
      case 'mute':
        this.muted = !this.muted;
        break;
      case 'captions':
        this.toggleCaptions();
        break;
      case 'fullscreen':
        this.toggleFullscreen();
        break;
    }
  }

  // Loading

  private scheduleLoad(): void {
    if (!this.engine || this.loadQueued) {
      return;
    }
    this.loadQueued = true;
    queueMicrotask(() => {
      this.loadQueued = false;
      this.load();
    });
  }

  private load(): void {
    const engine = this.engine;
    const src = this.getAttribute('src');
    const input = this.sourceValue ?? src;
    if (!engine || !input) {
      return;
    }
    const seq = ++this.loadSeq;
    this.detachMediaSession?.();
    this.detachMediaSession = null;
    this.preview?.destroy();
    this.preview = null;
    this.failedScenes.clear();
    this.posterUrl = null;
    this.started = false;
    this.loading = true;
    this.waiting = false;
    this.hideError();

    const wasmUrl = this.getAttribute('wasm-url');
    if (wasmUrl) {
      setWasmUrl(wasmUrl);
    }
    const autoplay = this.hasAttribute('autoplay');
    if (autoplay) {
      // Browsers only let a film start by itself when it is silent.
      engine.muted = true;
      this.autoMuted = true;
    }

    // A film with a src has a resume key before it opens. A film given as bytes is keyed by
    // its title and duration, which are only known once it has opened.
    const keyed = this.sourceValue === null && src !== null;
    this.resume = keyed ? new Resume(resumeKey(src, { title: '', duration: 0 })) : null;
    const startAttr = this.getAttribute('start');
    const given = startAttr === null || startAttr.trim() === '' ? NaN : Number(startAttr);
    const start = Number.isFinite(given) ? given : (this.resume?.read() ?? undefined);

    this.refreshChrome();
    engine.load(input, { start }).then(
      (film) => {
        if (seq !== this.loadSeq || this.engine !== engine) {
          return;
        }
        this.loading = false;
        this.onFilm(film, src, keyed, Number.isFinite(given));
        if (autoplay) {
          engine.play().catch(() => {
            // Refused even when muted. The big play button is still there.
          });
        }
      },
      () => {
        // The engine has sent an error event for this, which put up the message.
        if (seq === this.loadSeq) {
          this.loading = false;
          this.refreshChrome();
        }
      }
    );
  }

  private onFilm(film: TalkieFilm, src: string | null, keyed: boolean, startGiven: boolean): void {
    const engine = this.engine!;
    this.filmStyle!.textContent = `:host { --talkie-aspect: ${film.size[0]} / ${film.size[1]}; }`;

    if (!keyed) {
      this.resume = new Resume(resumeKey(null, film));
      const saved = startGiven ? null : this.resume.read();
      if (saved !== null) {
        engine.currentTime = saved;
      }
    }

    // A folder film's poster sits next to talkie.json. A packed film's poster is inside the
    // file, where only the engine can reach, so its first frame stands in for the poster.
    if (keyed && src && !new URL(src, document.baseURI).pathname.endsWith('.lottie')) {
      const folder = new URL(src, document.baseURI);
      if (!folder.pathname.endsWith('/')) {
        folder.pathname += '/';
      }
      this.posterUrl = new URL(film.poster.png, folder).href;
    }

    this.scrubber?.setFilm(film);
    this.controls?.syncAll();
    this.detachMediaSession = attachMediaSession(
      this,
      film,
      this.getAttribute('poster') ?? this.posterUrl
    );
    this.refresh();
  }

  // Keeping the picture of the UI in step

  /** Everything that follows the film time. */
  private refresh(): void {
    const engine = this.engine;
    if (!engine) {
      return;
    }
    const time = engine.currentTime;
    if (this.scrubber && !this.scrubber.isDragging) {
      this.scrubber.update(time, engine.audio?.buffered ?? null);
    }
    this.controls?.syncTime();
    this.controls?.syncChapter();
    this.updateCaptions();
    this.refreshChrome();
  }

  /** The play button, spinner, chips and poster. */
  private refreshChrome(): void {
    const refs = this.refs;
    const engine = this.engine;
    if (!refs || !engine) {
      return;
    }
    const failed = !refs.error.hidden;
    refs.bigPlay.hidden = this.started || failed || this.loading;
    refs.spinner.hidden = failed || !(this.loading || this.waiting);
    refs.unmute.hidden = !(this.autoMuted && engine.muted) || failed;
    this.controls?.syncPlay();
    this.updatePoster();
  }

  private updatePoster(): void {
    const refs = this.refs;
    if (!refs) {
      return;
    }
    const url = this.getAttribute('poster') ?? this.posterUrl;
    const film = this.engine?.film;
    const sceneFailed =
      film !== null &&
      film !== undefined &&
      this.failedScenes.has(sceneAt(film, this.currentTime).scene.id);
    if (url && refs.poster.getAttribute('src') !== url) {
      refs.poster.setAttribute('src', url);
    }
    // The poster covers the picture before the first play, and for any scene that would not load.
    refs.poster.hidden = !url || (this.started && !sceneFailed);
  }

  private updateCaptions(): void {
    const engine = this.engine;
    if (engine) {
      this.captionsView?.update(engine.cues, engine.currentTime, this.captionsOn);
    }
  }

  private applyControls(): void {
    this.refs?.root.setAttribute(
      'data-controls',
      this.getAttribute('controls') === 'false' ? 'off' : 'on'
    );
  }

  private showError(error: TalkieError | undefined): void {
    const refs = this.refs;
    if (!refs) {
      return;
    }
    const code = error?.code ?? 'invalid-film';
    refs.errorText.textContent = MESSAGES[code] ?? MESSAGES['invalid-film']!;
    refs.error.setAttribute('data-code', code);
    refs.retry.hidden = code !== 'network';
    refs.error.hidden = false;
    refs.root.toggleAttribute('data-failed', true);
    this.loading = false;
    this.waiting = false;
    this.refreshChrome();
  }

  private hideError(): void {
    if (this.refs && !this.refs.error.hidden) {
      this.refs.error.hidden = true;
      this.refs.root.toggleAttribute('data-failed', false);
      this.refreshChrome();
    }
  }

  private saveResume(): void {
    const engine = this.engine;
    if (engine?.film && this.started) {
      this.resume?.save(engine.currentTime, engine.film.duration);
    }
  }

  // Scrubbing

  private onScrub(time: number, final: boolean): void {
    this.autoHide?.hold(!final || (this.controls?.menuOpen ?? false));
    if (final) {
      this.currentTime = time;
    } else {
      // While dragging, move the bar and the preview only. The film seeks once, on release.
      this.scrubber?.update(time, this.engine?.audio?.buffered ?? null);
    }
  }

  private showPreview(time: number, fraction: number): void {
    const refs = this.refs;
    const film = this.engine?.film;
    if (!refs || !film) {
      return;
    }
    let title = '';
    for (const c of film.chapters) {
      if (c.start <= time) {
        title = c.title;
      }
    }
    refs.previewTitle.textContent = title;
    refs.previewTime.textContent = formatTime(time);
    refs.preview.style.left = `clamp(84px, ${fraction * 100}%, calc(100% - 84px))`;
    refs.preview.hidden = false;

    const input = this.sourceValue ?? this.getAttribute('src');
    if (!this.preview && input) {
      this.preview = new Preview({
        canvas: refs.previewCanvas,
        createRenderer: TalkiePlayerElement.previewRenderer,
        open: () => openFilm(input),
      });
    }
    this.preview?.renderAt(time);
  }
}

/** Register the element. Safe to call twice, and does nothing where there is no DOM. */
export function defineTalkiePlayer(tag = 'talkie-player'): void {
  if (typeof customElements !== 'undefined' && !customElements.get(tag)) {
    customElements.define(tag, TalkiePlayerElement);
  }
}

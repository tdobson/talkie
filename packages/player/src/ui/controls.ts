import type { TalkieFilm } from '@talkie/format';
import { formatTime } from './format-time';
import { Menu } from './menu';
import { ICONS, type TemplateRefs } from './template';

export const HIDE_AFTER_MS = 3000;

/**
 * Hides the controls after 3 s of playback with no pointer or keyboard activity. They are
 * always shown while paused, and while something (an open menu, a drag) holds them.
 */
export class AutoHide {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  private held = false;

  constructor(private root: HTMLElement) {}

  get hidden(): boolean {
    return this.root.hasAttribute('data-hidden');
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.activity();
  }

  /** Keep the controls up while `held` is true. */
  hold(held: boolean): void {
    this.held = held;
    this.activity();
  }

  /** The viewer did something: show the controls and start the countdown again. */
  activity(): void {
    this.show();
    if (this.playing && !this.held) {
      this.timer = setTimeout(() => this.hide(), HIDE_AFTER_MS);
    }
  }

  /** For a tap on a touch screen: hide if showing, show if hidden. */
  toggle(): void {
    if (this.hidden || !this.playing || this.held) {
      this.activity();
    } else {
      this.hide();
    }
  }

  destroy(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private show(): void {
    this.clear();
    this.root.removeAttribute('data-hidden');
  }

  private hide(): void {
    this.clear();
    this.root.setAttribute('data-hidden', '');
  }
}

/** What the control bar needs from the player element. */
export interface ControlsHost {
  readonly paused: boolean;
  readonly ended: boolean;
  readonly duration: number;
  readonly film: TalkieFilm | null;
  readonly captionsOn: boolean;
  readonly hasCaptions: boolean;
  readonly isFullscreen: boolean;
  currentTime: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
  togglePlay(): void;
  toggleCaptions(): void;
  toggleFullscreen(): void;
}

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const speedLabel = (rate: number) => (rate === 1 ? 'Normal' : `${rate}x`);

function setButton(button: HTMLButtonElement, icon: string, label: string): void {
  if (button.getAttribute('aria-label') !== label || button.childElementCount === 0) {
    button.innerHTML = icon;
    button.setAttribute('aria-label', label);
  }
}

/** Wires the control bar's buttons and menus to the player, and keeps them in step with it. */
export class Controls {
  readonly settingsMenu: Menu;
  readonly chaptersMenu: Menu;

  constructor(
    private refs: TemplateRefs,
    private host: ControlsHost,
    onMenuChange: () => void
  ) {
    const stop = (fn: () => void) => (event: Event) => {
      event.stopPropagation();
      fn();
    };
    refs.play.addEventListener(
      'click',
      stop(() => host.togglePlay())
    );
    refs.skipBack.addEventListener(
      'click',
      stop(() => this.skip(-10))
    );
    refs.skipForward.addEventListener(
      'click',
      stop(() => this.skip(10))
    );
    refs.mute.addEventListener(
      'click',
      stop(() => {
        host.muted = !host.muted;
      })
    );
    refs.volume.addEventListener('input', () => {
      host.volume = Number(refs.volume.value);
      host.muted = host.volume === 0;
    });
    // Arrow keys on the volume slider change the volume, so keep them from the shortcuts.
    refs.volume.addEventListener('keydown', (event) => event.stopPropagation());
    refs.captionsToggle.addEventListener(
      'click',
      stop(() => host.toggleCaptions())
    );
    refs.fullscreen.addEventListener(
      'click',
      stop(() => host.toggleFullscreen())
    );

    this.settingsMenu = new Menu(
      refs.settingsMenu,
      refs.settings,
      'Playback speed',
      (value) => {
        host.playbackRate = Number(value);
        onMenuChange();
      },
      () => {
        this.chaptersMenu.close();
        onMenuChange();
      }
    );
    this.chaptersMenu = new Menu(
      refs.chaptersMenu,
      refs.chapters,
      'Chapters',
      (value) => {
        host.currentTime = Number(value);
        onMenuChange();
      },
      () => {
        this.settingsMenu.close();
        onMenuChange();
      }
    );
    refs.settings.addEventListener('click', onMenuChange);
    refs.chapters.addEventListener('click', onMenuChange);
    this.settingsMenu.setItems(
      SPEEDS.map((rate) => ({ value: String(rate), label: speedLabel(rate), checked: rate === 1 }))
    );
  }

  get menuOpen(): boolean {
    return this.settingsMenu.isOpen || this.chaptersMenu.isOpen;
  }

  closeMenus(): void {
    this.settingsMenu.close();
    this.chaptersMenu.close();
  }

  skip(seconds: number): void {
    if (Number.isFinite(this.host.duration)) {
      this.host.currentTime += seconds;
    }
  }

  syncAll(): void {
    this.syncFilm();
    this.syncPlay();
    this.syncVolume();
    this.syncTime();
    this.syncRate();
    this.syncCaptions();
    this.syncFullscreen();
  }

  syncFilm(): void {
    const film = this.host.film;
    const chapters = film?.chapters ?? [];
    this.refs.chapters.hidden = chapters.length === 0;
    this.chaptersMenu.setItems(
      chapters.map((c) => ({ value: String(c.start), label: c.title, note: formatTime(c.start) }))
    );
    if (chapters.length === 0) {
      this.chaptersMenu.close();
    }
    this.syncChapter();
    this.syncCaptions();
    this.syncTime();
  }

  syncPlay(): void {
    const { paused, ended } = this.host;
    const icon = ended ? ICONS.replay : paused ? ICONS.play : ICONS.pause;
    const label = ended ? 'Replay' : paused ? 'Play' : 'Pause';
    setButton(this.refs.play, icon, label);
  }

  syncVolume(): void {
    const { muted, volume } = this.host;
    const silent = muted || volume === 0;
    setButton(this.refs.mute, silent ? ICONS.muted : ICONS.volume, silent ? 'Unmute' : 'Mute');
    this.refs.volume.value = String(muted ? 0 : volume);
    this.refs.volume.setAttribute(
      'aria-valuetext',
      `${Math.round((muted ? 0 : volume) * 100)} percent`
    );
  }

  syncTime(): void {
    const duration = Number.isFinite(this.host.duration) ? this.host.duration : 0;
    this.refs.time.textContent = `${formatTime(this.host.currentTime)} / ${formatTime(duration)}`;
  }

  syncChapter(): void {
    const film = this.host.film;
    let title = '';
    let start = '';
    for (const c of film?.chapters ?? []) {
      if (c.start <= this.host.currentTime) {
        title = c.title;
        start = String(c.start);
      }
    }
    this.refs.chapterTitle.textContent = title;
    this.chaptersMenu.check(start);
  }

  syncRate(): void {
    this.settingsMenu.check(String(this.host.playbackRate));
  }

  syncCaptions(): void {
    this.refs.captionsToggle.hidden = !this.host.hasCaptions;
    this.refs.captionsToggle.setAttribute('aria-pressed', String(this.host.captionsOn));
  }

  syncFullscreen(): void {
    const on = this.host.isFullscreen;
    setButton(
      this.refs.fullscreen,
      on ? ICONS.exitFullscreen : ICONS.fullscreen,
      on ? 'Exit full screen' : 'Full screen'
    );
  }
}

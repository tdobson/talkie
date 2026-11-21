import { frameFor, sceneAt, type FilmSource, type TalkieFilm } from '@talkie/format';
import type { CreateRenderer, SceneRenderer, SceneTiming } from '../engine/renderer';

export const PREVIEW_INTERVAL_MS = 100;

export interface PreviewOptions {
  canvas: HTMLCanvasElement;
  createRenderer: CreateRenderer;
  /** Open the film a second time, for scene files. Called once, on the first hover. */
  open: () => Promise<{ film: TalkieFilm; source: FilmSource }>;
  now?: () => number;
}

/**
 * The scrub-bar hover preview: a small canvas with its own renderer, so looking ahead never
 * disturbs the main picture. Draws are throttled to 10 per second, and the last time asked
 * for always gets drawn.
 */
export class Preview {
  private opts: PreviewOptions;
  private now: () => number;
  private renderer: SceneRenderer | null = null;
  private opened: Promise<{ film: TalkieFilm; source: FilmSource } | null> | null = null;
  private source: FilmSource | null = null;
  private loadedIndex = -1;
  private timing: SceneTiming | null = null;
  private wanted: number | null = null;
  private lastDraw = -Infinity;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private destroyed = false;

  constructor(opts: PreviewOptions) {
    this.opts = opts;
    this.now = opts.now ?? (() => performance.now());
  }

  /** Ask for the picture at film time `t`. */
  renderAt(t: number): void {
    if (this.destroyed) {
      return;
    }
    this.wanted = t;
    this.schedule();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.renderer?.destroy();
    this.renderer = null;
    this.source?.dispose();
    this.source = null;
  }

  private schedule(): void {
    if (this.timer !== null || this.busy || this.wanted === null) {
      return;
    }
    const wait = Math.max(this.lastDraw + PREVIEW_INTERVAL_MS - this.now(), 0);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drawWanted();
    }, wait);
  }

  private async drawWanted(): Promise<void> {
    const t = this.wanted;
    if (t === null || this.destroyed) {
      return;
    }
    this.wanted = null;
    this.busy = true;
    this.lastDraw = this.now();
    try {
      await this.draw(t);
    } catch {
      // A preview that cannot be drawn is left as it was. The film itself is not affected.
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  private async draw(t: number): Promise<void> {
    this.opened ??= this.opts.open().catch(() => null);
    const opened = await this.opened;
    if (!opened || this.destroyed) {
      if (opened && this.source !== opened.source) {
        opened.source.dispose();
      }
      return;
    }
    this.source = opened.source;
    const { film, source } = opened;
    const pos = sceneAt(film, t);
    if (pos.index !== this.loadedIndex) {
      this.renderer ??= this.opts.createRenderer(this.opts.canvas);
      this.timing = null;
      this.loadedIndex = -1;
      const timing = await this.renderer.load(await source.json(pos.scene.src));
      if (this.destroyed) {
        return;
      }
      this.timing = timing;
      this.loadedIndex = pos.index;
    }
    if (this.timing && this.renderer) {
      const { fr, ip, op } = this.timing;
      this.renderer.setFrame(frameFor(pos.localTime, fr, ip, op));
    }
  }
}

import type { CreateRenderer, SceneRenderer, SceneTiming } from './renderer';

export type SlotState = 'empty' | 'loading' | 'ready' | 'failed';

export interface SceneSlot {
  canvas: HTMLCanvasElement;
  renderer: SceneRenderer;
  /** Scene held (or being loaded) by this slot, -1 when empty. */
  sceneIndex: number;
  state: SlotState;
  /** Set while state is 'ready'. */
  timing: SceneTiming | null;
}

export interface SceneSlotsOptions {
  container: HTMLElement;
  createRenderer: CreateRenderer;
  /** Fetch and parse the Lottie JSON of scene `index`. */
  loadScene: (index: number) => Promise<unknown>;
  /** A slot holding `index` became the visible one. */
  onShow?: (index: number) => void;
  /** Scene `index` could not be loaded. Called once per scene. */
  onFail?: (index: number, error: unknown) => void;
}

const CACHE_SIZE = 6;

/**
 * Two stacked canvases. One is visible; the other loads the next scene out of sight, so crossing
 * a scene boundary is a visibility swap and never shows a half-loaded picture.
 */
export class SceneSlots {
  readonly slots: [SceneSlot, SceneSlot];
  private front = 0;
  private wanted = -1;
  private destroyed = false;
  private tokens = [0, 0];
  private queues: [Promise<void>, Promise<void>] = [Promise.resolve(), Promise.resolve()];
  private cache = new Map<number, Promise<unknown>>();
  private failed = new Set<number>();

  constructor(private opts: SceneSlotsOptions) {
    const make = (): SceneSlot => {
      const canvas = document.createElement('canvas');
      canvas.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;display:block;visibility:hidden';
      opts.container.append(canvas);
      return {
        canvas,
        renderer: opts.createRenderer(canvas),
        sceneIndex: -1,
        state: 'empty',
        timing: null,
      };
    };
    this.slots = [make(), make()];
  }

  /** The visible slot, or null when nothing has been shown yet. */
  get visible(): SceneSlot | null {
    const slot = this.slots[this.front]!;
    return slot.canvas.style.visibility === 'visible' ? slot : null;
  }

  /** True once loading scene `index` has failed. */
  hasFailed(index: number): boolean {
    return this.failed.has(index);
  }

  /**
   * Make scene `index` the visible one. Returns its slot when it is on screen and ready for
   * setFrame, or null while it loads (the old picture holds) or after it failed.
   */
  show(index: number): SceneSlot | null {
    if (this.destroyed) {
      return null;
    }
    this.wanted = index;
    const at = this.find(index);
    if (at >= 0) {
      const slot = this.slots[at]!;
      if (slot.state !== 'ready') {
        return null;
      }
      this.reveal(at);
      return slot;
    }
    if (!this.failed.has(index)) {
      this.loadInto(1 - this.front, index);
    }
    return null;
  }

  /** Load scene `index` into the hidden slot, if that slot is not busy loading. */
  prefetch(index: number): void {
    const hidden = 1 - this.front;
    if (
      this.destroyed ||
      this.failed.has(index) ||
      this.find(index) >= 0 ||
      this.slots[hidden]!.state === 'loading'
    ) {
      return;
    }
    this.loadInto(hidden, index);
  }

  /** Resolves when every load started so far has finished, whether it worked or not. */
  settled(): Promise<void> {
    return Promise.all(this.queues).then(() => undefined);
  }

  resize(): void {
    for (const slot of this.slots) {
      if (slot.state === 'ready') {
        slot.renderer.resize();
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.cache.clear();
    for (const slot of this.slots) {
      slot.renderer.destroy();
      slot.canvas.remove();
      slot.state = 'empty';
      slot.sceneIndex = -1;
      slot.timing = null;
    }
  }

  private find(index: number): number {
    return this.slots.findIndex((s) => s.sceneIndex === index && s.state !== 'empty');
  }

  private reveal(at: number): void {
    const slot = this.slots[at]!;
    if (this.front === at && slot.canvas.style.visibility === 'visible') {
      return;
    }
    this.front = at;
    slot.canvas.style.visibility = 'visible';
    this.slots[1 - at]!.canvas.style.visibility = 'hidden';
    this.opts.onShow?.(slot.sceneIndex);
  }

  private scene(index: number): Promise<unknown> {
    let entry = this.cache.get(index);
    if (entry) {
      this.cache.delete(index);
    } else {
      entry = this.opts.loadScene(index);
      entry.catch(() => {
        if (this.cache.get(index) === entry) {
          this.cache.delete(index);
        }
      });
    }
    this.cache.set(index, entry);
    while (this.cache.size > CACHE_SIZE) {
      this.cache.delete(this.cache.keys().next().value!);
    }
    return entry;
  }

  private loadInto(at: number, index: number): void {
    const slot = this.slots[at]!;
    const token = ++this.tokens[at]!;
    const current = () => !this.destroyed && this.tokens[at] === token;
    slot.sceneIndex = index;
    slot.state = 'loading';
    slot.timing = null;
    const data = this.scene(index);
    data.catch(() => {});
    // One load at a time per renderer; a load that was overtaken while it waited is skipped.
    this.queues[at] = this.queues[at]!.then(async () => {
      if (!current()) {
        return;
      }
      try {
        const timing = await slot.renderer.load(await data);
        if (!current()) {
          return;
        }
        slot.timing = timing;
        slot.state = 'ready';
        if (this.wanted === index) {
          this.reveal(at);
        }
      } catch (error) {
        if (!current()) {
          return;
        }
        slot.state = 'failed';
        if (!this.failed.has(index)) {
          this.failed.add(index);
          this.opts.onFail?.(index, error);
        }
      }
    });
  }
}

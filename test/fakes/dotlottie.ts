// Jest stand-in for @lottiefiles/dotlottie-web: records calls, draws nothing.
// Like the real library, a player is not ready until its WASM has started, which
// happens after the constructor returns. Until then load() does nothing at all,
// and only data passed to the constructor gets loaded.
export interface FakeCall {
  method: 'load' | 'setFrame' | 'resize' | 'destroy';
  args: unknown[];
}

type Listener = (event: { type: string; error?: Error }) => void;

export class DotLottie {
  static instances: DotLottie[] = [];
  static wasmUrl: string | undefined;

  static setWasmUrl(url: string): void {
    DotLottie.wasmUrl = url;
  }

  /** Make the next players fail to start their WASM. */
  static failWasm = false;

  static reset(): void {
    DotLottie.instances = [];
    DotLottie.wasmUrl = undefined;
    DotLottie.failWasm = false;
  }

  readonly config: Record<string, unknown>;
  readonly calls: FakeCall[] = [];
  isReady = false;
  isLoaded = false;
  currentFrame = 0;
  /** load() calls made before the player was ready, which the real library drops. */
  droppedLoads = 0;
  private destroyed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
    DotLottie.instances.push(this);
    const fail = DotLottie.failWasm;
    queueMicrotask(() => {
      if (this.destroyed) {
        return;
      }
      if (fail) {
        this.emit('loadError', new Error('Failed to load wasm module'));
        return;
      }
      this.isReady = true;
      this.emit('ready');
      if (config.data !== undefined || config.src !== undefined) {
        this.finishLoad();
      }
    });
  }

  load(config: Record<string, unknown> = {}): void {
    if (!this.isReady) {
      this.droppedLoads += 1;
      return;
    }
    this.calls.push({ method: 'load', args: [config] });
    this.finishLoad();
  }

  private finishLoad(): void {
    queueMicrotask(() => {
      if (this.destroyed) {
        return;
      }
      this.isLoaded = true;
      this.emit('load');
    });
  }

  setFrame(frame: number): void {
    this.calls.push({ method: 'setFrame', args: [frame] });
    this.currentFrame = frame;
  }

  resize(): void {
    this.calls.push({ method: 'resize', args: [] });
  }

  destroy(): void {
    this.calls.push({ method: 'destroy', args: [] });
    this.destroyed = true;
    this.isReady = false;
    this.isLoaded = false;
    this.listeners.clear();
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  private emit(type: string, error?: Error): void {
    const event = error ? { type, error } : { type };
    [...(this.listeners.get(type) ?? [])].forEach((listener) => listener(event));
  }
}

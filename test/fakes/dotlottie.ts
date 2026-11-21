// Jest stand-in for @lottiefiles/dotlottie-web: records calls, draws nothing.
export interface FakeCall {
  method: 'load' | 'setFrame' | 'resize' | 'destroy';
  args: unknown[];
}

type Listener = (event: { type: string }) => void;

export class DotLottie {
  static instances: DotLottie[] = [];
  static wasmUrl: string | undefined;

  static setWasmUrl(url: string): void {
    DotLottie.wasmUrl = url;
  }

  static reset(): void {
    DotLottie.instances = [];
    DotLottie.wasmUrl = undefined;
  }

  readonly config: Record<string, unknown>;
  readonly calls: FakeCall[] = [];
  isLoaded = false;
  currentFrame = 0;
  private listeners = new Map<string, Set<Listener>>();

  constructor(config: Record<string, unknown> = {}) {
    this.config = config;
    DotLottie.instances.push(this);
  }

  load(config: Record<string, unknown> = {}): void {
    this.calls.push({ method: 'load', args: [config] });
    this.isLoaded = true;
    this.emit('load');
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

  private emit(type: string): void {
    this.listeners.get(type)?.forEach((listener) => listener({ type }));
  }
}

import type { DotLottie } from '@lottiefiles/dotlottie-web';
import { TalkieError } from '@talkie/format';
import type { CreateRenderer, SceneRenderer, SceneTiming } from './renderer';

let wasmUrl: string | undefined;
let appliedWasmUrl: string | undefined;

/** Where to fetch the dotLottie WASM from. Call before the first film loads. */
export function setWasmUrl(url: string): void {
  wasmUrl = url;
}

/** Read fr, ip and op from a parsed Lottie animation. */
export function readTiming(animation: unknown): SceneTiming {
  const a = (animation ?? {}) as Record<string, unknown>;
  const { fr, ip, op } = a;
  if (
    typeof fr !== 'number' ||
    typeof ip !== 'number' ||
    typeof op !== 'number' ||
    !(fr > 0) ||
    !(op > ip)
  ) {
    throw new TalkieError('scene-failed', 'scene is not a Lottie animation (bad fr, ip or op)');
  }
  return { fr, ip, op };
}

/** The default renderer: dotlottie-web, imported only when the first scene loads. */
export const createDotLottieRenderer: CreateRenderer = (canvas) => {
  let player: DotLottie | null = null;
  let destroyed = false;
  // One load at a time: a second scene waits for the one before it to settle.
  let tail: Promise<unknown> = Promise.resolve();
  let abort: (() => void) | null = null;

  const loadNow = async (animation: unknown): Promise<void> => {
    const { DotLottie: Player } = await import('@lottiefiles/dotlottie-web');
    if (destroyed) {
      throw new TalkieError('scene-failed', 'renderer was destroyed while loading');
    }
    if (wasmUrl !== undefined && wasmUrl !== appliedWasmUrl) {
      Player.setWasmUrl(wasmUrl);
      appliedWasmUrl = wasmUrl;
    }
    const config = {
      autoplay: false,
      loop: false,
      renderConfig: { devicePixelRatio: window.devicePixelRatio, autoResize: true },
    };
    const data = animation as Record<string, unknown>;
    // DotLottie.load() does nothing until the WASM has started, which is some time
    // after the constructor returns. So the first scene goes in through the
    // constructor, and load() is only used on a player that says it is ready.
    const existing = player;
    if (existing && !existing.isReady) {
      throw new TalkieError('scene-failed', 'the dotLottie player did not start');
    }
    const p = existing ?? new Player({ canvas, data, ...config });
    player = p;
    await new Promise<void>((resolve, reject) => {
      const done = (error?: Error) => {
        p.removeEventListener('load', onLoad);
        p.removeEventListener('loadError', onError);
        abort = null;
        if (error) {
          reject(new TalkieError('scene-failed', error.message, error));
        } else {
          resolve();
        }
      };
      const onLoad = () => done();
      const onError = (event: { error?: Error }) =>
        done(event.error ?? new Error('the scene could not be loaded'));
      p.addEventListener('load', onLoad);
      p.addEventListener('loadError', onError);
      abort = () => done(new Error('renderer was destroyed while loading'));
      if (existing) {
        try {
          p.load({ data, ...config });
        } catch (e) {
          done(e instanceof Error ? e : new Error(String(e)));
        }
      }
    });
  };

  const renderer: SceneRenderer = {
    async load(animation) {
      const timing = readTiming(animation);
      const run = tail.then(() => loadNow(animation));
      tail = run.catch(() => undefined);
      await run;
      return timing;
    },
    setFrame(frame) {
      player?.setFrame(frame);
    },
    resize() {
      player?.resize();
    },
    destroy() {
      destroyed = true;
      abort?.();
      player?.destroy();
      player = null;
    },
  };
  return renderer;
};

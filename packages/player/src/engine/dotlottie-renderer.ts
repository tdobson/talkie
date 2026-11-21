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

  const renderer: SceneRenderer = {
    async load(animation) {
      const timing = readTiming(animation);
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
      player ??= new Player({ canvas, ...config });
      const p = player;
      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error) => {
          p.removeEventListener('load', onLoad);
          p.removeEventListener('loadError', onError);
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
        try {
          p.load({ data: animation as Record<string, unknown>, ...config });
        } catch (e) {
          done(e instanceof Error ? e : new Error(String(e)));
        }
      });
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
      player?.destroy();
      player = null;
    },
  };
  return renderer;
};

import { TalkieError } from '@talkie/format';
import { DotLottie } from '../../../../test/fakes/dotlottie';
import {
  createDotLottieRenderer,
  readTiming,
  setWasmUrl,
} from '../../src/engine/dotlottie-renderer';

const scene = { v: '5.7.0', fr: 60, ip: 0, op: 600, layers: [] };

beforeEach(() => DotLottie.reset());

describe('dotLottie renderer', () => {
  test('creates no player until a scene loads', () => {
    createDotLottieRenderer(document.createElement('canvas'));
    expect(DotLottie.instances).toHaveLength(0);
  });

  test('loads the animation data and returns its timing', async () => {
    const canvas = document.createElement('canvas');
    const renderer = createDotLottieRenderer(canvas);
    await expect(renderer.load(scene)).resolves.toEqual({ fr: 60, ip: 0, op: 600 });
    const player = DotLottie.instances[0]!;
    expect(player.config).toMatchObject({
      canvas,
      autoplay: false,
      loop: false,
      renderConfig: { devicePixelRatio: window.devicePixelRatio, autoResize: true },
    });
    expect(player.calls[0]).toMatchObject({
      method: 'load',
      args: [{ data: scene, autoplay: false, loop: false }],
    });
  });

  test('reuses one player for later scenes and forwards frame, resize and destroy', async () => {
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    await renderer.load(scene);
    await renderer.load({ ...scene, op: 120 });
    expect(DotLottie.instances).toHaveLength(1);
    renderer.setFrame(12.5);
    renderer.resize();
    renderer.destroy();
    expect(DotLottie.instances[0]!.calls.map((c) => c.method)).toEqual([
      'load',
      'load',
      'setFrame',
      'resize',
      'destroy',
    ]);
    expect(DotLottie.instances[0]!.calls[2]!.args).toEqual([12.5]);
  });

  test('passes the WASM URL on before the first player is made', async () => {
    setWasmUrl('/wasm/dotlottie-player.wasm');
    await createDotLottieRenderer(document.createElement('canvas')).load(scene);
    expect(DotLottie.wasmUrl).toBe('/wasm/dotlottie-player.wasm');
  });

  test('rejects JSON that is not a Lottie animation', async () => {
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    await expect(renderer.load({ nope: true })).rejects.toBeInstanceOf(TalkieError);
    expect(() => readTiming({ fr: 60, ip: 10, op: 10 })).toThrow(TalkieError);
    expect(DotLottie.instances).toHaveLength(0);
  });
});

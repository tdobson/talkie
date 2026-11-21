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
      data: scene,
      autoplay: false,
      loop: false,
      renderConfig: { devicePixelRatio: window.devicePixelRatio, autoResize: true },
    });
    expect(player.calls).toEqual([]);
  });

  test('never calls load() on a player that is not ready, since the library drops it', async () => {
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    const first = renderer.load(scene);
    const second = renderer.load({ ...scene, op: 120 });
    await expect(first).resolves.toEqual({ fr: 60, ip: 0, op: 600 });
    await expect(second).resolves.toEqual({ fr: 60, ip: 0, op: 120 });
    const player = DotLottie.instances[0]!;
    expect(DotLottie.instances).toHaveLength(1);
    expect(player.droppedLoads).toBe(0);
    expect(player.calls.map((c) => c.method)).toEqual(['load']);
  });

  test('loads later scenes through load() once the player is ready', async () => {
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    await renderer.load(scene);
    const next = { ...scene, op: 120 };
    await renderer.load(next);
    expect(DotLottie.instances[0]!.calls).toEqual([
      {
        method: 'load',
        args: [expect.objectContaining({ data: next, autoplay: false, loop: false })],
      },
    ]);
  });

  test('fails the scene when the WASM cannot start', async () => {
    DotLottie.failWasm = true;
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    await expect(renderer.load(scene)).rejects.toMatchObject({ code: 'scene-failed' });
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
      'setFrame',
      'resize',
      'destroy',
    ]);
    expect(DotLottie.instances[0]!.calls[1]!.args).toEqual([12.5]);
  });

  test('passes the WASM URL on before the first player is made', async () => {
    setWasmUrl('/wasm/dotlottie-player.wasm');
    await createDotLottieRenderer(document.createElement('canvas')).load(scene);
    expect(DotLottie.wasmUrl).toBe('/wasm/dotlottie-player.wasm');
  });

  test('fails a pending load when the renderer is destroyed', async () => {
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    const pending = renderer.load(scene);
    await Promise.resolve();
    renderer.destroy();
    await expect(pending).rejects.toMatchObject({ code: 'scene-failed' });
  });

  test('rejects JSON that is not a Lottie animation', async () => {
    const renderer = createDotLottieRenderer(document.createElement('canvas'));
    await expect(renderer.load({ nope: true })).rejects.toBeInstanceOf(TalkieError);
    expect(() => readTiming({ fr: 60, ip: 10, op: 10 })).toThrow(TalkieError);
    expect(DotLottie.instances).toHaveLength(0);
  });
});

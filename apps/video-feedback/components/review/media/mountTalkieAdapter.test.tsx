import { mountTalkieAdapter, TALKIE_WASM_PATH } from './TalkieAdapter';

const { setWasmUrl, engines } = vi.hoisted(() => ({
  setWasmUrl: vi.fn(),
  engines: [] as EventTarget[],
}));

vi.mock('@talkie/player', () => ({
  setWasmUrl,
  TalkieEngine: class extends EventTarget {
    constructor() {
      super();
      // The renderer must know where its WebAssembly is before the engine can load a scene.
      expect(setWasmUrl).toHaveBeenCalled();
      engines.push(this);
    }
    destroy() {}
  },
}));

describe('mountTalkieAdapter', () => {
  it('points the renderer at this site for its WebAssembly, never at a CDN', async () => {
    const adapter = await mountTalkieAdapter(document.createElement('div'), '/api/r/tok/film/1/');
    expect(engines).toHaveLength(1);
    expect(setWasmUrl).toHaveBeenCalledExactlyOnceWith(
      new URL(TALKIE_WASM_PATH, location.href).href
    );
    expect(new URL(setWasmUrl.mock.calls[0][0]).origin).toBe(location.origin);
    expect(TALKIE_WASM_PATH).toBe('/talkie/dotlottie-player.wasm');
    adapter.destroy();
  });
});

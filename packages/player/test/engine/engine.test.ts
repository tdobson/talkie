import { TalkieError } from '@talkie/format';
import valid from '../../../format/test/fixtures/valid.json';
import { TalkieEngine } from '../../src/engine/engine';
import { fakeRenderers, flush } from './helpers';

const BASE = 'https://films.test/demo/';
const VTT = 'WEBVTT\n\n00:01.000 --> 00:03.000\nFix the first batten.\n';
const lottie = (seconds: number) => ({ v: '5.7.0', fr: 60, ip: 0, op: seconds * 60, layers: [] });

function routes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [`${BASE}talkie.json`]: valid,
    [`${BASE}a/s01.json`]: lottie(18.4),
    [`${BASE}a/s02.json`]: lottie(22.6),
    [`${BASE}a/s03.json`]: lottie(19),
    [`${BASE}captions/en.vtt`]: VTT,
    ...overrides,
  };
}

interface AudioState {
  currentTime: number;
  paused: boolean;
  seeking: boolean;
  ended: boolean;
  readyState: number;
  error: { code: number } | null;
  loads: number;
}

/** jsdom has no media playback: back the properties the engine reads with plain values. */
function fakeAudio(audio: HTMLAudioElement, canPlay = 'probably'): AudioState {
  const state: AudioState = {
    currentTime: 0,
    paused: true,
    seeking: false,
    ended: false,
    readyState: 1,
    error: null,
    loads: 0,
  };
  for (const key of ['currentTime', 'paused', 'seeking', 'ended', 'readyState', 'error'] as const) {
    Object.defineProperty(audio, key, {
      configurable: true,
      get: () => state[key],
      set: (value: never) => {
        state[key] = value;
      },
    });
  }
  audio.canPlayType = () => canPlay as CanPlayTypeResult;
  audio.play = async () => {
    state.paused = false;
    audio.dispatchEvent(new Event('play'));
  };
  audio.pause = () => {
    state.paused = true;
    audio.dispatchEvent(new Event('pause'));
  };
  audio.load = () => {
    state.loads++;
    state.currentTime = 0;
  };
  return state;
}

function setup(opts: { files?: Record<string, unknown>; canPlay?: string; debug?: boolean } = {}) {
  const files = opts.files ?? routes();
  const fetched: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    const body = files[url];
    return {
      ok: body !== undefined,
      status: body === undefined ? 404 : 200,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  }) as typeof fetch;

  let wall = 0;
  let pending: FrameRequestCallback[] = [];
  const container = document.createElement('div');
  const { made, create } = fakeRenderers();
  const engine = new TalkieEngine({
    container,
    createRenderer: create,
    raf: (cb) => pending.push(cb),
    cancelRaf: () => {
      pending = [];
    },
    now: () => wall,
    debug: opts.debug,
  });
  const audio = fakeAudio(engine.audio, opts.canPlay);
  const events: Event[] = [];
  for (const type of [
    'play',
    'pause',
    'timeupdate',
    'loadedmetadata',
    'chapterchange',
    'error',
    'scenewarning',
    'frame',
    'ended',
  ]) {
    engine.addEventListener(type, (e) => events.push(e));
  }
  return {
    engine,
    audio,
    container,
    made,
    events,
    fetched,
    count: (type: string) => events.filter((e) => e.type === type).length,
    details: (type: string) =>
      events.filter((e) => e.type === type).map((e) => (e as CustomEvent).detail),
    pendingFrames: () => pending.length,
    /** Advance the wall clock and the audio, then run one animation frame. */
    frame(ms = 16, audioTime?: number) {
      wall += ms;
      if (audioTime !== undefined) {
        audio.currentTime = audioTime;
      }
      const run = pending;
      pending = [];
      run.forEach((cb) => cb(wall));
    },
    /** The scene on screen and the last frame it was set to. */
    picture() {
      const canvas = container.querySelector<HTMLCanvasElement>('canvas[style*="visible"]');
      const renderer = made.find((r) => r.canvas === canvas);
      const scene = renderer?.loads.at(-1) as { op: number } | undefined;
      return { op: scene?.op, frame: renderer?.frames.at(-1) };
    },
  };
}

describe('TalkieEngine', () => {
  test('load opens the film, picks audio, reads captions and shows frame 0 of scene 0', async () => {
    const { engine, container, picture, fetched } = setup();
    const film = await engine.load(BASE);
    expect(film.title).toBe(valid.title);
    expect(engine.film).toBe(film);
    expect(engine.duration).toBe(60);
    expect(engine.paused).toBe(true);
    expect(engine.audio.getAttribute('src')).toBe(`${BASE}u/n.webm`);
    expect(engine.audio.preload).toBe('metadata');
    expect(engine.cues).toEqual([{ start: 1, end: 3, text: 'Fix the first batten.' }]);
    expect(container.querySelectorAll('canvas')).toHaveLength(2);
    expect(picture()).toEqual({ op: 1104, frame: 0 });
    expect(fetched).not.toContain(`${BASE}a/s02.json`);
  });

  test('falls back to the next audio track the browser can play', async () => {
    const { engine } = setup();
    engine.audio.canPlayType = (type) => (type.startsWith('audio/mp4') ? 'maybe' : '');
    await engine.load(BASE);
    expect(engine.audio.getAttribute('src')).toBe(`${BASE}u/n.m4a`);
  });

  test('reports no playable audio as an error event and a rejection', async () => {
    const { engine, details } = setup({ canPlay: '' });
    await expect(engine.load(BASE)).rejects.toMatchObject({ code: 'no-playable-audio' });
    expect(details('error')).toHaveLength(1);
    expect(details('error')[0]).toBeInstanceOf(TalkieError);
    expect(engine.film).toBeNull();
  });

  test('reports a film that cannot be fetched', async () => {
    const { engine, details } = setup({ files: {} });
    await expect(engine.load(BASE)).rejects.toMatchObject({ code: 'network' });
    expect(details('error')[0]).toMatchObject({ code: 'network' });
  });

  test('loadedmetadata waits for both the film and the audio metadata', async () => {
    const { engine, audio, count } = setup();
    audio.readyState = 0;
    await engine.load(BASE);
    expect(count('loadedmetadata')).toBe(0);
    audio.readyState = 1;
    engine.audio.dispatchEvent(new Event('loadedmetadata'));
    engine.audio.dispatchEvent(new Event('loadedmetadata'));
    expect(count('loadedmetadata')).toBe(1);
  });

  test('load with a start time shows that frame and seeks once metadata is in', async () => {
    const { engine, audio, picture } = setup();
    audio.readyState = 0;
    await engine.load(BASE, { start: 30 });
    expect(engine.currentTime).toBe(30);
    expect(picture().op).toBe(1356);
    expect(picture().frame).toBeCloseTo(696, 6);
    audio.readyState = 1;
    engine.audio.dispatchEvent(new Event('loadedmetadata'));
    expect(audio.currentTime).toBe(30);
  });

  test('play advances frames with the audio clock', async () => {
    const { engine, frame, picture, count, pendingFrames } = setup();
    await engine.load(BASE);
    await engine.play();
    expect(count('play')).toBe(1);
    expect(engine.paused).toBe(false);
    frame(16, 1);
    expect(picture().frame).toBeCloseTo(60, 6);
    frame(16, 2);
    expect(picture().frame).toBeCloseTo(120, 6);
    // Between coarse updates of currentTime the smoothing clock carries the picture on.
    frame(20);
    expect(picture().frame).toBeCloseTo(121.2, 6);
    expect(pendingFrames()).toBe(1);
  });

  test('pause holds the picture and stops the frame loop', async () => {
    const { engine, frame, picture, pendingFrames, made } = setup();
    await engine.load(BASE);
    await engine.play();
    frame(16, 5);
    engine.pause();
    frame(16);
    expect(picture().frame).toBeCloseTo(300, 6);
    expect(pendingFrames()).toBe(0);
    const drawn = made.map((r) => r.frames.length);
    frame(500);
    expect(made.map((r) => r.frames.length)).toEqual(drawn);
  });

  test('setting currentTime seeks and renders the right scene', async () => {
    const { engine, audio, frame, picture } = setup();
    await engine.load(BASE);
    engine.currentTime = 30;
    expect(audio.currentTime).toBe(30);
    expect(engine.currentTime).toBe(30);
    frame();
    expect(picture().op).toBe(1104);
    await flush();
    expect(picture().op).toBe(1356);
    expect(picture().frame).toBeCloseTo(696, 6);
  });

  test('currentTime is clamped to the film', async () => {
    const { engine, audio } = setup();
    await engine.load(BASE);
    engine.currentTime = 999;
    expect(audio.currentTime).toBe(60);
    engine.currentTime = -5;
    expect(audio.currentTime).toBe(0);
  });

  test('a scene boundary swaps slots without a reload', async () => {
    const { engine, frame, picture, made, fetched, details } = setup();
    await engine.load(BASE);
    await engine.play();
    frame(16, 18.3);
    await flush();
    expect(fetched).toContain(`${BASE}a/s02.json`);
    expect(picture().op).toBe(1104);
    const loads = made.map((r) => r.loads.length);

    frame(16, 18.5);
    expect(picture().op).toBe(1356);
    expect(picture().frame).toBeCloseTo(6, 6);
    expect(made.map((r) => r.loads.length)).toEqual(loads);
    expect(details('chapterchange')).toEqual([{ index: 1 }]);
  });

  test('a failing scene emits scenewarning once and playback continues', async () => {
    const files = routes();
    delete files[`${BASE}a/s02.json`];
    const { engine, frame, picture, details, count } = setup({ files });
    await engine.load(BASE);
    await engine.play();
    frame(16, 20);
    await flush();
    frame(16, 21);
    await flush();
    expect(details('scenewarning')).toHaveLength(1);
    expect(details('scenewarning')[0].sceneId).toBe('s02');
    expect(details('scenewarning')[0].error).toMatchObject({ code: 'scene-failed' });
    expect(count('error')).toBe(0);
    expect(engine.paused).toBe(false);

    frame(16, 42);
    await flush();
    expect(picture().op).toBe(1140);
    expect(picture().frame).toBeCloseTo(60, 6);
  });

  test('renderAt resolves after setFrame, loading the scene if needed', async () => {
    const { engine, picture, audio } = setup();
    await engine.load(BASE);
    await engine.renderAt(45);
    expect(picture().op).toBe(1140);
    expect(picture().frame).toBeCloseTo(240, 6);
    expect(audio.currentTime).toBe(0);
  });

  test('timeupdate fires at most 4 times a second while playing', async () => {
    const { engine, frame, count } = setup();
    await engine.load(BASE);
    const before = count('timeupdate');
    await engine.play();
    for (let i = 1; i <= 60; i++) {
      frame(16, i * 0.016);
    }
    const fired = count('timeupdate') - before;
    expect(fired).toBeGreaterThanOrEqual(3);
    expect(fired).toBeLessThanOrEqual(4);
  });

  test('debug emits a frame event per draw with film and audio time', async () => {
    const { engine, frame, details } = setup({ debug: true });
    await engine.load(BASE);
    await engine.play();
    frame(16, 2);
    frame(10);
    const frames = details('frame');
    expect(frames.at(-2)).toEqual({ filmTime: 2, audioTime: 2 });
    expect(frames.at(-1).audioTime).toBe(2);
    expect(frames.at(-1).filmTime).toBeCloseTo(2.01, 6);
  });

  test('an audio network error becomes an error event and retry resumes at the same time', async () => {
    const { engine, audio, frame, details } = setup();
    await engine.load(BASE);
    await engine.play();
    frame(16, 12);
    audio.error = { code: 2 };
    audio.paused = true;
    engine.audio.dispatchEvent(new Event('error'));
    expect(details('error')[0]).toMatchObject({ code: 'network' });

    await engine.retry();
    expect(audio.loads).toBe(1);
    expect(engine.currentTime).toBe(12);
    expect(engine.paused).toBe(false);
    engine.audio.dispatchEvent(new Event('loadedmetadata'));
    expect(audio.currentTime).toBe(12);
  });

  test('mirrors rate, volume and muted onto the audio element', async () => {
    const { engine } = setup();
    engine.playbackRate = 1.5;
    engine.volume = 0.4;
    engine.muted = true;
    expect(engine.audio.playbackRate).toBe(1.5);
    expect(engine.audio.volume).toBe(0.4);
    expect(engine.audio.muted).toBe(true);
    expect([engine.playbackRate, engine.volume, engine.muted]).toEqual([1.5, 0.4, true]);
  });

  test('destroy removes the canvases and stops listening to the audio', async () => {
    const { engine, container, made, count, pendingFrames } = setup();
    await engine.load(BASE);
    await engine.play();
    engine.destroy();
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
    expect(made.every((r) => r.destroyed)).toBe(true);
    expect(pendingFrames()).toBe(0);
    const plays = count('play');
    engine.audio.dispatchEvent(new Event('play'));
    expect(count('play')).toBe(plays);
    expect(engine.film).toBeNull();
  });
});

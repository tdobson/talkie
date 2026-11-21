import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TalkieFilm } from '@talkie/format';
import { runAdapterContract } from './adapterContract';
import { FakeEngine } from './fakes';
import { cueText, TalkieAdapter } from './TalkieAdapter';

const FIXTURE = join(process.cwd(), 'test/fixtures/talkie-mini');
const readFixture = (path: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE, path), 'utf8'));
const film = readFixture('talkie.json') as TalkieFilm;
const CUES = [
  { start: 0, end: 2, text: 'Red scene.' },
  { start: 2, end: 4, text: 'Blue scene.' },
];
const FILM_URL = '/api/r/tok/film/v/1/';

function make(sceneJson: (src: string) => Promise<unknown> = async (src) => readFixture(src)) {
  const engine = new FakeEngine(film, CUES);
  const loads = vi.fn(sceneJson);
  const adapter = new TalkieAdapter(engine, { filmUrl: FILM_URL, sceneJson: loads });
  return { engine, adapter, loads, loadMetadata: () => adapter.load() };
}

/** Lets the scene JSON lookups started by a seek or a load finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

runAdapterContract('TalkieAdapter', make);

describe('TalkieAdapter', () => {
  it('loads the film folder into the engine and takes its size and length from the film', async () => {
    const { engine, adapter } = make();
    expect(adapter.kind).toBe('talkie');
    expect(Number.isNaN(adapter.duration)).toBe(true);
    await adapter.load();
    expect(engine.loaded).toEqual([FILM_URL]);
    expect(adapter.naturalSize).toEqual({ width: 320, height: 180 });
    expect(adapter.duration).toBe(4);
  });

  it('says the metadata is known once the film is open, even before the narration has loaded', async () => {
    const { engine, adapter } = make();
    engine.quietMetadata = true;
    const seen = vi.fn();
    adapter.addEventListener('loadedmetadata', seen);
    await adapter.load();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(adapter.naturalSize).toEqual({ width: 320, height: 180 });
  });

  it('says so once only when the engine reports the metadata itself', async () => {
    const { adapter } = make();
    const seen = vi.fn();
    adapter.addEventListener('loadedmetadata', seen);
    await adapter.load();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('setting the time always reports a time update, for the caption and the scroll bar', async () => {
    const { adapter } = make();
    await adapter.load();
    const seen = vi.fn();
    adapter.addEventListener('timeupdate', seen);
    adapter.currentTime = 2.5;
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('frame duration comes from the scene under the playhead, read once per scene', async () => {
    const rates: Record<string, number> = { 'a/s01.json': 30, 'a/s02.json': 12 };
    const { adapter, loads } = make(async (src) => ({ fr: rates[src] }));
    await adapter.load();
    await settle();
    expect(adapter.frameDuration()).toBe(1 / 30);
    adapter.currentTime = 3;
    await settle();
    expect(adapter.frameDuration()).toBe(1 / 12);
    adapter.currentTime = 1;
    adapter.currentTime = 3.5;
    await settle();
    expect(loads.mock.calls.filter(([src]) => src === 'a/s02.json')).toHaveLength(1);
    expect(loads.mock.calls.filter(([src]) => src === 'a/s01.json')).toHaveLength(1);
  });

  it('falls back to 30 frames a second while a scene is unread, or cannot be read', async () => {
    const { adapter } = make(async () => {
      throw new Error('offline');
    });
    await adapter.load();
    await settle();
    expect(adapter.frameDuration()).toBe(1 / 30);
    const odd = make(async () => ({ fr: 'fast' }));
    await odd.adapter.load();
    await settle();
    expect(odd.adapter.frameDuration()).toBe(1 / 30);
  });

  describe('frame steps in the fixture', () => {
    it('at 1.98, a step forward lands on 2.0, the first frame of scene two', async () => {
      const { adapter } = make();
      await adapter.load();
      adapter.currentTime = 1.98;
      await settle();
      expect(adapter.stepFrame(1)).toBe(2);
    });

    it('at 2.0, a step back lands on 2 - 1/30, the last frame of scene one', async () => {
      const { adapter } = make();
      await adapter.load();
      adapter.currentTime = 2;
      await settle();
      expect(adapter.stepFrame(-1)).toBeCloseTo(2 - 1 / 30, 10);
    });

    it('a step back off a boundary uses the earlier scene, whatever its frame rate', async () => {
      const rates: Record<string, number> = { 'a/s01.json': 10, 'a/s02.json': 30 };
      const { adapter } = make(async (src) => ({ fr: rates[src] }));
      await adapter.load();
      adapter.currentTime = 2;
      await settle();
      expect(adapter.stepFrame(-1)).toBeCloseTo(1.9, 10);
      expect(adapter.stepFrame(1)).toBeCloseTo(2 + 1 / 30, 10);
    });

    it('inside a scene a step is one frame either way', async () => {
      const { adapter } = make();
      await adapter.load();
      adapter.currentTime = 1;
      await settle();
      expect(adapter.stepFrame(1)).toBeCloseTo(1 + 1 / 30, 10);
      expect(adapter.stepFrame(-1)).toBeCloseTo(1 - 1 / 30, 10);
    });

    it('the last scene has no boundary to stop at', async () => {
      const { adapter } = make();
      await adapter.load();
      adapter.currentTime = 3.99;
      await settle();
      expect(adapter.stepFrame(1)).toBeCloseTo(3.99 + 1 / 30, 10);
    });
  });

  it('caption is the cue covering the current time, as plain text', async () => {
    const { engine, adapter } = make();
    expect(adapter.caption()).toBeNull();
    await adapter.load();
    expect(adapter.caption()).toBe('Red scene.');
    adapter.currentTime = 2;
    expect(adapter.caption()).toBe('Blue scene.');
    engine.cues = [{ start: 0, end: 1, text: '<v Tim>Fish &amp; <i>chips</i>' }];
    adapter.currentTime = 0.5;
    expect(adapter.caption()).toBe('Fish & chips');
    adapter.currentTime = 1;
    expect(adapter.caption()).toBeNull();
    expect(cueText('a &lt; b&nbsp;&gt; c')).toBe('a < b > c');
  });

  it.each(['invalid-film', 'unsupported-version', 'network', 'no-playable-audio'])(
    'a %s TalkieError becomes the error event, and the adapter has failed',
    async (code) => {
      const { engine, adapter } = make();
      engine.failWith = Object.assign(new Error('no'), { code });
      const errors: unknown[] = [];
      adapter.addEventListener('error', (e) => errors.push((e as CustomEvent).detail));
      await adapter.load();
      expect(errors).toEqual([code]);
      expect(adapter.failed).toBe(true);
    }
  );

  it('is no longer failed once the film plays again', async () => {
    const { engine, adapter } = make();
    await adapter.load();
    engine.dispatchEvent(new CustomEvent('error', { detail: { code: 'network' } }));
    expect(adapter.failed).toBe(true);
    engine.dispatchEvent(new Event('playing'));
    expect(adapter.failed).toBe(false);
  });

  it('a scene warning is passed on with the scene id only', async () => {
    const { engine, adapter } = make();
    await adapter.load();
    const seen: unknown[] = [];
    adapter.addEventListener('scenewarning', (e) => seen.push((e as CustomEvent).detail));
    engine.warn('s02');
    expect(seen).toEqual([{ sceneId: 's02' }]);
  });

  it('reports buffering while the film loads, and when the narration stalls', async () => {
    const { engine, adapter } = make();
    const states: boolean[] = [];
    adapter.addEventListener('buffering', (e) => states.push((e as CustomEvent<boolean>).detail));
    await adapter.load();
    expect(states).toEqual([true, false]);
    engine.dispatchEvent(new Event('waiting'));
    engine.dispatchEvent(new Event('playing'));
    expect(states).toEqual([true, false, true, false]);
  });

  it('sets the volume on the engine, and mutes at zero', () => {
    const { engine, adapter } = make();
    adapter.setVolume(0.3);
    expect(engine.volume).toBe(0.3);
    expect(engine.muted).toBe(false);
    adapter.setVolume(0);
    expect(engine.muted).toBe(true);
  });

  it('destroy destroys the engine once and stops listening to it', async () => {
    const { engine, adapter } = make();
    await adapter.load();
    const remove = vi.spyOn(engine, 'removeEventListener');
    const destroy = vi.spyOn(engine, 'destroy');
    adapter.destroy();
    adapter.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls.length).toBeGreaterThanOrEqual(10);
  });
});

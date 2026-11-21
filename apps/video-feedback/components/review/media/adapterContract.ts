import type { MediaAdapter, MediaAdapterEvent } from './adapter';

/** What a contract run needs: the adapter, and a way to make its fake media report metadata. */
export interface AdapterHarness {
  adapter: MediaAdapter;
  /** Makes the fake media behind the adapter load, so `loadedmetadata` fires. */
  loadMetadata: () => void | Promise<void>;
}

const EVENTS: MediaAdapterEvent[] = [
  'play',
  'pause',
  'seeking',
  'seeked',
  'timeupdate',
  'waiting',
  'playing',
  'ended',
  'loadedmetadata',
  'error',
];

/** Records every contract event the adapter fires, in order. */
function record(adapter: MediaAdapter): MediaAdapterEvent[] {
  const seen: MediaAdapterEvent[] = [];
  for (const type of EVENTS) adapter.addEventListener(type, () => seen.push(type));
  return seen;
}

const only = (seen: MediaAdapterEvent[], ...types: MediaAdapterEvent[]) =>
  seen.filter((type) => types.includes(type));

/**
 * The behaviour the player relies on, whatever is behind the adapter. Each adapter's test file
 * runs this against a fake of the thing it wraps: a 320x180 picture, 4 seconds long.
 */
export function runAdapterContract(
  name: string,
  makeAdapter: () => AdapterHarness | Promise<AdapterHarness>
): void {
  describe(`${name}: MediaAdapter contract`, () => {
    let harness: AdapterHarness;
    beforeEach(async () => {
      harness = await makeAdapter();
    });
    afterEach(() => harness.adapter.destroy());

    it('play then pause fires play then pause', async () => {
      const { adapter, loadMetadata } = harness;
      await loadMetadata();
      const seen = record(adapter);
      expect(adapter.paused).toBe(true);
      await adapter.play();
      expect(adapter.paused).toBe(false);
      adapter.pause();
      expect(adapter.paused).toBe(true);
      expect(only(seen, 'play', 'pause')).toEqual(['play', 'pause']);
    });

    it('setting currentTime fires seeking then seeked, and moves the time', async () => {
      const { adapter, loadMetadata } = harness;
      await loadMetadata();
      const seen = record(adapter);
      adapter.currentTime = 1.5;
      expect(adapter.currentTime).toBe(1.5);
      expect(only(seen, 'seeking', 'seeked')).toEqual(['seeking', 'seeked']);
    });

    it('naturalSize and duration are known after loadedmetadata', async () => {
      const { adapter, loadMetadata } = harness;
      const seen = record(adapter);
      expect(adapter.naturalSize).toBeNull();
      await loadMetadata();
      expect(seen).toContain('loadedmetadata');
      expect(adapter.naturalSize).toEqual({ width: 320, height: 180 });
      expect(adapter.duration).toBe(4);
    });

    it('frameDuration is positive, before and after the media loads', async () => {
      const { adapter, loadMetadata } = harness;
      expect(adapter.frameDuration()).toBeGreaterThan(0);
      await loadMetadata();
      expect(adapter.frameDuration()).toBeGreaterThan(0);
    });

    it('destroy stops events, and may be called twice', async () => {
      const { adapter, loadMetadata } = harness;
      await loadMetadata();
      const seen = record(adapter);
      adapter.destroy();
      adapter.destroy();
      await adapter.play().catch(() => {});
      adapter.pause();
      adapter.currentTime = 2;
      expect(seen).toEqual([]);
    });
  });
}

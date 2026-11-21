import { runAdapterContract } from './adapterContract';
import { fakeVideo } from './fakes';
import { VideoAdapter } from './VideoAdapter';

const FRAME = 1 / 25;

function make() {
  const { video, loadMetadata } = fakeVideo();
  return { video, adapter: new VideoAdapter(video, () => FRAME), loadMetadata };
}

runAdapterContract('VideoAdapter', make);

describe('VideoAdapter', () => {
  it('is an mp4 with a constant frame duration and no captions', () => {
    const { adapter, loadMetadata } = make();
    loadMetadata();
    expect(adapter.kind).toBe('mp4');
    expect(adapter.frameDuration()).toBe(FRAME);
    expect(adapter.caption()).toBeNull();
    adapter.currentTime = 2;
    expect(adapter.stepFrame(1)).toBe(2 + FRAME);
    expect(adapter.stepFrame(-1)).toBe(2 - FRAME);
  });

  it('reads the frame duration each time, so a new version steps by its own frames', () => {
    const { video } = fakeVideo();
    let frame = 1 / 25;
    const adapter = new VideoAdapter(video, () => frame);
    frame = 1 / 50;
    expect(adapter.frameDuration()).toBe(1 / 50);
  });

  it('a change of duration counts as new metadata', () => {
    const { video, adapter } = make();
    const seen = vi.fn();
    adapter.addEventListener('loadedmetadata', seen);
    video.dispatchEvent(new Event('durationchange'));
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reports buffering from the element load and stall events', () => {
    const { video, adapter } = make();
    const states: boolean[] = [];
    adapter.addEventListener('buffering', (e) => states.push((e as CustomEvent<boolean>).detail));
    for (const type of ['loadstart', 'loadeddata', 'waiting', 'canplay', 'waiting', 'playing']) {
      video.dispatchEvent(new Event(type));
    }
    expect(states).toEqual([true, false, true, false, true, false]);
  });

  it('sets the volume, and mutes at zero', () => {
    const { video, adapter } = make();
    adapter.setVolume(0.4);
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(false);
    adapter.setVolume(0);
    expect(video.muted).toBe(true);
  });

  it('has failed once the element has an error', () => {
    const { video, adapter } = make();
    expect(adapter.failed).toBe(false);
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 4 } });
    expect(adapter.failed).toBe(true);
  });

  it('destroy stops listening to the element', () => {
    const { video, adapter } = make();
    const add = vi.spyOn(video, 'addEventListener');
    const remove = vi.spyOn(video, 'removeEventListener');
    adapter.destroy();
    expect(add).not.toHaveBeenCalled();
    expect(remove.mock.calls.length).toBeGreaterThanOrEqual(10);
  });
});

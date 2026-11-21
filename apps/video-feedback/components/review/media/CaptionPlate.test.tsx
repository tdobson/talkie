import type { TalkieFilm } from '@talkie/format';
import { T } from '@/lib/testids';
import { act, render, screen } from '@/test/helpers/render';
import { CaptionPlate } from './CaptionPlate';
import { FakeEngine, fakeVideo } from './fakes';
import { TalkieAdapter } from './TalkieAdapter';
import { VideoAdapter } from './VideoAdapter';

const film = {
  talkie: 1,
  title: 'Mini',
  duration: 4,
  size: [320, 180],
  audio: [],
  scenes: [
    { id: 's01', src: 'a/s01.json', start: 0, end: 2 },
    { id: 's02', src: 'a/s02.json', start: 2, end: 4 },
  ],
  chapters: [],
  captions: [],
  poster: { png: 'poster.png' },
} satisfies TalkieFilm;
const CUES = [
  { start: 0, end: 1.5, text: 'Red scene.' },
  { start: 2, end: 4, text: 'Blue scene.' },
];
const RECT = { x: 100, y: 0, width: 800, height: 450 };

async function talkie() {
  const engine = new FakeEngine(film, CUES);
  const adapter = new TalkieAdapter(engine, {
    filmUrl: '/film/',
    sceneJson: async () => ({ fr: 30 }),
  });
  await adapter.load();
  return { engine, adapter };
}

describe('CaptionPlate', () => {
  it('shows the caption for the current time at the bottom of the picture', async () => {
    const { adapter } = await talkie();
    render(<CaptionPlate adapter={adapter} rect={RECT} on />);
    const plate = screen.getByTestId(T.captionPlate);
    expect(plate).toHaveTextContent('Red scene.');
    const box = plate.parentElement as HTMLElement;
    expect(box.style.left).toBe('100px');
    expect(box.style.top).toBe('0px');
    expect(box.style.width).toBe('800px');
    expect(box.style.height).toBe('450px');
  });

  it('follows the film as it plays and as it is scrolled, and goes when no cue covers the time', async () => {
    const { engine, adapter } = await talkie();
    render(<CaptionPlate adapter={adapter} rect={RECT} on />);
    act(() => engine.advanceTo(1.7));
    expect(screen.queryByTestId(T.captionPlate)).toBeNull();
    act(() => engine.advanceTo(2.2));
    expect(screen.getByTestId(T.captionPlate)).toHaveTextContent('Blue scene.');
    act(() => {
      adapter.currentTime = 0.5;
    });
    expect(screen.getByTestId(T.captionPlate)).toHaveTextContent('Red scene.');
  });

  it('is invisible to the pointer, so a click lands on the picture under it', async () => {
    const { adapter } = await talkie();
    render(<CaptionPlate adapter={adapter} rect={RECT} on />);
    const plate = screen.getByTestId(T.captionPlate);
    expect(plate.style.pointerEvents).toBe('none');
    expect((plate.parentElement as HTMLElement).style.pointerEvents).toBe('none');
    // Not marked as off the picture either: the stage would ignore a click that started here.
    expect(plate.closest('[data-no-capture]')).toBeNull();
  });

  it('shows nothing when captions are off', async () => {
    const { adapter } = await talkie();
    const { rerender } = render(<CaptionPlate adapter={adapter} rect={RECT} on={false} />);
    expect(screen.queryByTestId(T.captionPlate)).toBeNull();
    rerender(<CaptionPlate adapter={adapter} rect={RECT} on />);
    expect(screen.getByTestId(T.captionPlate)).toBeInTheDocument();
  });

  it('shows nothing for an mp4, or before there is an adapter', () => {
    const { video, loadMetadata } = fakeVideo();
    const adapter = new VideoAdapter(video, () => 1 / 25);
    loadMetadata();
    const { rerender } = render(<CaptionPlate adapter={adapter} rect={RECT} on />);
    expect(screen.queryByTestId(T.captionPlate)).toBeNull();
    rerender(<CaptionPlate adapter={null} rect={null} on />);
    expect(screen.queryByTestId(T.captionPlate)).toBeNull();
  });

  it('stops listening when it goes away', async () => {
    const { adapter } = await talkie();
    const add = vi.spyOn(adapter, 'addEventListener');
    const remove = vi.spyOn(adapter, 'removeEventListener');
    const { unmount } = render(<CaptionPlate adapter={adapter} rect={RECT} on />);
    expect(add).toHaveBeenCalled();
    unmount();
    expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
  });
});

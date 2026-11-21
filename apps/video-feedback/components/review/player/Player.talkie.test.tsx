import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TalkieFilm } from '@talkie/format';
import { useReducer } from 'react';
import type { PendingChunk } from '@/lib/capture/uploader';
import { HOLD_TO_ZOOM_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { initialState, type ReviewState, reducer } from '@/lib/review/machine';
import { T } from '@/lib/testids';
import type { CaptureEvent, MediaKind } from '@/lib/types';
import { FakeMediaRecorder, fakeStream, stubMediaPlayback } from '@/test/helpers/fakeMedia';
import { act, fireEvent, render, screen } from '@/test/helpers/render';
import { FakeEngine } from '../media/fakes';
import { TalkieAdapter } from '../media/TalkieAdapter';
import { type MountTalkie, Player, type PlayerUploader } from './Player';

const FIXTURE = join(process.cwd(), 'test/fixtures/talkie-mini');
const readFixture = (path: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE, path), 'utf8'));
const film = readFixture('talkie.json') as TalkieFilm;
const CUES = [
  { start: 0, end: 2, text: 'Red scene.' },
  { start: 2, end: 4, text: 'Blue scene.' },
];

const playerState: ReviewState = {
  ...initialState,
  screen: 'player',
  name: 'Sarah',
  sessionId: 'sid',
  version: 3,
};

type Chunk = Omit<PendingChunk, 'key' | 'token'>;

function fakeUploader() {
  const chunks: Chunk[] = [];
  const uploader: PlayerUploader = {
    enqueue: vi.fn(async (chunk: Chunk) => {
      chunks.push(chunk);
    }),
    complete: vi.fn(async () => {}),
  };
  const events = (): CaptureEvent[] => chunks.flatMap((c) => c.events);
  return { uploader, chunks, events };
}

function Harness(props: {
  uploader: PlayerUploader;
  stream: MediaStream;
  mediaKind: MediaKind;
  mountTalkie: MountTalkie;
}) {
  const [state, dispatch] = useReducer(reducer, playerState);
  return (
    <>
      <output data-testid="screen">{state.screen}</output>
      <Player
        token="tok"
        frameDuration={0.04}
        mediaKind={props.mediaKind}
        mountTalkie={props.mountTalkie}
        state={state}
        dispatch={dispatch}
        stream={props.stream}
        uploader={props.uploader}
        trouble={false}
        onReconnectMic={() => {}}
        onDone={() => {}}
      />
    </>
  );
}

/** Lets the mount promise, the film load and the fake recorder's zero-delay timers run. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(5));
const playPause = () => fireEvent.click(screen.getByTestId(T.playPause));

async function setup(opts: { mediaKind?: MediaKind; failWith?: string } = {}) {
  const up = fakeUploader();
  const engine = new FakeEngine(film, CUES);
  if (opts.failWith) engine.failWith = Object.assign(new Error('no'), { code: opts.failWith });
  const mounts: Array<{ container: HTMLElement; filmUrl: string }> = [];
  const mountTalkie: MountTalkie = vi.fn(async (container, filmUrl) => {
    mounts.push({ container, filmUrl });
    return new TalkieAdapter(engine, { filmUrl, sceneJson: async (src) => readFixture(src) });
  });
  const view = render(
    <Harness
      uploader={up.uploader}
      stream={fakeStream().stream}
      mediaKind={opts.mediaKind ?? 'talkie'}
      mountTalkie={mountTalkie}
    />
  );
  // A 1000x500 stage and a 16:9 film: the picture is 888.9 wide, with bars left and right.
  const stage = screen.getByTestId(T.videoStage);
  stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
  await settle();
  return { ...up, ...view, engine, stage, mounts, mountTalkie };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  stubMediaPlayback();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Player with a Talkie film', () => {
  it('mounts the engine in the picture layer and loads the film folder for this version', async () => {
    const { engine, mounts, stage } = await setup();
    expect(mounts).toHaveLength(1);
    expect(mounts[0].filmUrl).toBe('/api/r/tok/film/?version=3');
    expect(engine.loaded).toEqual(['/api/r/tok/film/?version=3']);
    const surface = mounts[0].container;
    expect(stage.contains(surface)).toBe(true);
    expect(surface).toHaveAttribute('data-testid', T.video);
    expect(stage).toHaveAttribute('data-media-kind', 'talkie');
    expect(document.querySelector('video')).toBeNull();
    // The picture layer is sized by the film, letterboxed in the stage.
    const layer = surface.parentElement as HTMLElement;
    expect(Number.parseFloat(layer.style.width)).toBeCloseTo((500 * 16) / 9, 2);
    expect(layer.style.height).toBe('500px');
    expect(screen.queryByTestId(T.videoLoading)).toBeNull();
  });

  it('pausing opens a comment on the film time, with the film size as the picture size', async () => {
    const { engine, chunks } = await setup();
    playPause();
    expect(engine.paused).toBe(false);
    engine.advanceTo(1.25);
    playPause();
    expect(engine.paused).toBe(true);
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    await settle();
    playPause();
    await settle();
    expect(chunks[0].meta).toMatchObject({
      kind: 'moment',
      version: 3,
      pausedAtVideoTime: 1.25,
      player: { videoWidth: 320, videoHeight: 180, containerWidth: 1000, containerHeight: 500 },
    });
  });

  it('Right at 1.98 lands on 2.0 and Left at 2.0 lands on 2 - 1/30, each logged as a seek', async () => {
    const { engine, events } = await setup();
    playPause();
    engine.advanceTo(1.98);
    playPause();
    await settle();

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(engine.currentTime).toBe(2);
    await settle();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(engine.currentTime).toBeCloseTo(2 - 1 / 30, 10);
    await settle();
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(engine.currentTime).toBeCloseTo(3 - 1 / 30, 10);

    playPause();
    await settle();
    const seeks = events().filter((e) => e.type === 'seek');
    expect(seeks).toHaveLength(3);
    expect(seeks[0]).toMatchObject({ from: 1.98, to: 2, via: 'key' });
    expect(seeks[1]).toMatchObject({ from: 2, via: 'key' });
  });

  it('the arrows do nothing while the film plays', async () => {
    const { engine } = await setup();
    playPause();
    engine.advanceTo(1);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(engine.currentTime).toBe(1);
  });

  it('shows captions by default, and the toggle turns them off and on', async () => {
    const { engine } = await setup();
    expect(screen.getByTestId(T.captionPlate)).toHaveTextContent('Red scene.');
    const toggle = screen.getByTestId(T.captionsToggle);
    expect(toggle).toHaveAccessibleName(copy.player.captionsOn);

    playPause();
    act(() => engine.advanceTo(2.5));
    expect(screen.getByTestId(T.captionPlate)).toHaveTextContent('Blue scene.');

    fireEvent.click(toggle);
    expect(screen.queryByTestId(T.captionPlate)).toBeNull();
    expect(screen.getByTestId(T.captionsToggle)).toHaveAccessibleName(copy.player.captionsOff);
    // The toggle is a control, not the picture: it neither pauses nor plays.
    expect(engine.paused).toBe(false);
    fireEvent.click(screen.getByTestId(T.captionsToggle));
    expect(screen.getByTestId(T.captionPlate)).toHaveTextContent('Blue scene.');
  });

  it('a click on the plate area is a click on the picture, with the coordinates under the plate', async () => {
    const { engine, events, stage } = await setup();
    playPause();
    engine.advanceTo(1);
    playPause();
    await settle();

    const plate = screen.getByTestId(T.captionPlate);
    expect(stage.contains(plate)).toBe(true);
    expect(plate.style.pointerEvents).toBe('none');
    expect(plate.closest('[data-no-capture]')).toBeNull();

    // Bottom centre of the picture, where the plate is drawn. With pointer-events off the
    // browser gives the press to the stage, which is what the test does here.
    fireEvent.pointerDown(stage, { clientX: 500, clientY: 470, button: 0 });
    await act(() => vi.advanceTimersByTimeAsync(80));
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 470, button: 0 });
    fireEvent.click(stage);
    await settle();
    // Clicking while paused is pointing: it never plays.
    expect(engine.paused).toBe(true);

    playPause();
    await settle();
    const clicks = events().filter((e) => e.type === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ x: 0.5, y: 0.94, inside: true, vt: 1 });
  });

  it('clicking the picture while the film plays pauses it; holding zooms only while paused', async () => {
    const { engine, stage, mounts } = await setup();
    const layer = mounts[0].container.parentElement as HTMLElement;
    playPause();
    fireEvent.pointerDown(stage, { clientX: 500, clientY: 250, button: 0 });
    await act(() => vi.advanceTimersByTimeAsync(HOLD_TO_ZOOM_MS + 20));
    expect(layer.style.transform).not.toContain('scale');
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 250, button: 0 });
    fireEvent.click(stage);
    expect(engine.paused).toBe(true);
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();

    fireEvent.pointerDown(stage, { clientX: 500, clientY: 250, button: 0 });
    await act(() => vi.advanceTimersByTimeAsync(HOLD_TO_ZOOM_MS + 20));
    expect(layer.style.transform).toBe('scale(2.5)');
    expect(layer.style.transformOrigin).toBe('50% 50%');
    fireEvent.pointerUp(stage, { clientX: 500, clientY: 250, button: 0 });
  });

  it.each(['invalid-film', 'unsupported-version', 'network', 'no-playable-audio'])(
    'a film that fails with %s shows the video error panel and its Reload button',
    async (code) => {
      const { chunks } = await setup({ failWith: code });
      expect(screen.getByTestId(T.videoError)).toHaveTextContent(copy.player.videoError);
      expect(screen.getByTestId(T.videoReload)).toBeInTheDocument();
      expect(screen.queryByTestId(T.videoLoading)).toBeNull();
      expect(screen.queryByTestId(T.listening)).toBeNull();
      expect(chunks).toHaveLength(0);
    }
  );

  it('a mount that fails shows the video error panel', async () => {
    const up = fakeUploader();
    const mountTalkie: MountTalkie = async () => {
      throw new Error('chunk failed to load');
    };
    render(
      <Harness
        uploader={up.uploader}
        stream={fakeStream().stream}
        mediaKind="talkie"
        mountTalkie={mountTalkie}
      />
    );
    await settle();
    expect(screen.getByTestId(T.videoError)).toBeInTheDocument();
    expect(screen.queryByTestId(T.videoLoading)).toBeNull();
  });

  it('a play() the browser refuses goes back to paused without a comment', async () => {
    const { engine } = await setup();
    engine.refusePlay = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    playPause();
    await settle();
    expect(screen.getByTestId(T.playPause)).toHaveAccessibleName('Play');
    expect(screen.queryByTestId(T.videoError)).toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('a scene warning during a comment is logged in it, and playback is not interrupted', async () => {
    const { engine, events } = await setup();
    playPause();
    engine.advanceTo(1);
    playPause();
    await settle();
    act(() => engine.warn('s02'));
    expect(screen.queryByTestId(T.videoError)).toBeNull();
    playPause();
    await settle();
    expect(engine.paused).toBe(false);
    expect(events().filter((e) => e.type === 'sceneWarning')).toMatchObject([
      { type: 'sceneWarning', sceneId: 's02' },
    ]);
  });

  it('a scene warning during playback is logged once, in the next comment', async () => {
    const { engine, events } = await setup();
    playPause();
    act(() => engine.warn('s02'));
    act(() => engine.warn('s02'));
    engine.advanceTo(2.5);
    playPause();
    await settle();
    playPause();
    await settle();
    expect(events().filter((e) => e.type === 'sceneWarning')).toMatchObject([
      { type: 'sceneWarning', sceneId: 's02' },
    ]);

    // Told once: the comment after that does not repeat it.
    playPause();
    await settle();
    playPause();
    await settle();
    expect(events().filter((e) => e.type === 'sceneWarning')).toHaveLength(1);
  });

  it('the end of the film shows the end screen', async () => {
    const { engine } = await setup();
    playPause();
    act(() => engine.finish());
    expect(screen.getByTestId('screen')).toHaveTextContent('end');
    expect(screen.queryByTestId(T.listening)).toBeNull();
  });

  it('the volume slider drives the engine', async () => {
    const { engine } = await setup();
    const thumb = screen.getByTestId(T.volume).querySelector('[role="slider"]') as HTMLElement;
    thumb.focus();
    fireEvent.keyDown(thumb, { key: 'Home' });
    expect(engine.volume).toBe(0);
    expect(engine.muted).toBe(true);
  });

  it('shows no timecode anywhere, playing or paused', async () => {
    const { engine } = await setup();
    const check = () => {
      expect(document.body.textContent).not.toMatch(/\d+:\d{2}/);
      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        expect(el.getAttribute('title')).toBeNull();
        expect(el.getAttribute('aria-valuetext') ?? '').not.toMatch(/\d+:\d{2}/);
      }
    };
    check();
    playPause();
    act(() => engine.advanceTo(2.5));
    check();
    playPause();
    await settle();
    check();
  });

  it('leaving destroys the engine and stops listening to it', async () => {
    const { engine, unmount } = await setup();
    const remove = vi.spyOn(engine, 'removeEventListener');
    unmount();
    expect(engine.destroyed).toBe(true);
    expect(remove).toHaveBeenCalled();
  });

  it('an engine that arrives after the player has gone is destroyed at once', async () => {
    const up = fakeUploader();
    const engine = new FakeEngine(film, CUES);
    let finish!: (adapter: TalkieAdapter) => void;
    const mountTalkie: MountTalkie = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const { unmount } = render(
      <Harness
        uploader={up.uploader}
        stream={fakeStream().stream}
        mediaKind="talkie"
        mountTalkie={mountTalkie}
      />
    );
    await settle();
    expect(screen.getByTestId(T.videoLoading)).toBeInTheDocument();
    unmount();
    finish(new TalkieAdapter(engine, { filmUrl: '/film/', sceneJson: async () => ({}) }));
    await settle();
    expect(engine.destroyed).toBe(true);
    expect(engine.loaded).toEqual([]);
  });

  it('an mp4 has a video element, no engine, no caption plate and no captions toggle', async () => {
    const { mountTalkie, stage } = await setup({ mediaKind: 'mp4' });
    expect(mountTalkie).not.toHaveBeenCalled();
    expect(screen.getByTestId(T.video).tagName).toBe('VIDEO');
    expect(stage).not.toHaveAttribute('data-media-kind', 'talkie');
    expect(screen.queryByTestId(T.captionPlate)).toBeNull();
    expect(screen.queryByTestId(T.captionsToggle)).toBeNull();
  });
});

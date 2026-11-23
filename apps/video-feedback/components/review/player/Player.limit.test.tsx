import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TalkieFilm } from '@talkie/format';
import { useEffect, useReducer, useState } from 'react';
import { COMMENT_MAX_MS, COMMENT_SILENCE_END_MS, COMMENT_WARN_BEFORE_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { initialState, type ReviewState, reducer } from '@/lib/review/machine';
import { T } from '@/lib/testids';
import type { MediaKind } from '@/lib/types';
import { FakeMediaRecorder, fakeStream, stubMediaPlayback } from '@/test/helpers/fakeMedia';
import { act, fireEvent, render, screen } from '@/test/helpers/render';
import { FakeEngine } from '../media/fakes';
import { TalkieAdapter } from '../media/TalkieAdapter';
import { type MountTalkie, Player, type PlayerUploader } from './Player';

// The level the comment limit hears. jsdom has no audio, so the test sets it, and the
// components re-render as they would on a live level.
const mic = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  return {
    level: 0,
    set(v: number) {
      this.level = v;
      for (const l of listeners) l();
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
});
vi.mock('../hooks/useMicLevel', () => ({ useMicLevel: () => useLevel() }));

function useLevel(): number {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => mic.subscribe(rerender), []);
  return mic.level;
}

const FIXTURE = join(process.cwd(), 'test/fixtures/talkie-mini');
const readFixture = (path: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURE, path), 'utf8'));
const film = readFixture('talkie.json') as TalkieFilm;

const practiceState: ReviewState = {
  ...initialState,
  screen: 'player',
  name: 'Sarah',
  sessionId: 'sid',
  version: 2,
  practice: null,
};

function Harness(props: {
  uploader: PlayerUploader;
  mediaKind: MediaKind;
  mountTalkie?: MountTalkie;
  initial: ReviewState;
}) {
  const [state, dispatch] = useReducer(reducer, props.initial);
  // One stream for the whole test: a new one means the microphone was reconnected.
  const [stream] = useState(() => fakeStream().stream);
  return (
    <>
      <output data-testid="held">{state.held ?? 'none'}</output>
      <Player
        token="tok"
        frameDuration={0.04}
        mediaKind={props.mediaKind}
        mountTalkie={props.mountTalkie}
        state={state}
        dispatch={dispatch}
        stream={stream}
        uploader={props.uploader}
        trouble={false}
        onReconnectMic={() => {}}
        onDone={() => {}}
      />
    </>
  );
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(5));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const playPause = () => fireEvent.click(screen.getByTestId(T.playPause));
const isPlaying = () => screen.getByTestId(T.playPause).getAttribute('aria-label') === 'Pause';

/** Mounts a player of either kind and returns how to read and move its playhead. */
async function setup(kind: MediaKind, initial: ReviewState = practiceState) {
  const uploader: PlayerUploader = {
    enqueue: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
  };
  const engine = new FakeEngine(film, []);
  const mountTalkie: MountTalkie = vi.fn(
    async (_container, filmUrl) =>
      new TalkieAdapter(engine, { filmUrl, sceneJson: async (src) => readFixture(src) })
  );
  render(
    <Harness uploader={uploader} mediaKind={kind} mountTalkie={mountTalkie} initial={initial} />
  );
  screen.getByTestId(T.videoStage).getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
  let time = 0;
  if (kind === 'mp4') {
    const video = screen.getByTestId(T.video) as HTMLVideoElement;
    // A picture size: with none the picture rectangle is not a number.
    Object.defineProperty(video, 'videoWidth', { configurable: true, value: 2000 });
    Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1000 });
    Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => time,
      set: (v: number) => {
        time = v;
      },
    });
    fireEvent.loadedMetadata(video);
  }
  await settle();
  return {
    uploader,
    getTime: () => (kind === 'mp4' ? time : engine.currentTime),
    moveTo: (t: number) => {
      if (kind === 'mp4') time = t;
      else engine.advanceTo(t);
    },
  };
}

beforeEach(() => {
  mic.level = 0;
  // The default fakes include performance.now(), which times the comment.
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

describe.each(['mp4', 'talkie'] as const)('a comment that runs on (%s)', (kind) => {
  it('ends after a long quiet, stays paused, and talking again starts a new comment', async () => {
    const { uploader } = await setup(kind);
    playPause(); // play
    await advance(500);
    playPause(); // pause: a comment
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    act(() => mic.set(0.5));
    await advance(2000);
    act(() => mic.set(0));
    await advance(COMMENT_SILENCE_END_MS - 500);
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    await advance(1000);
    expect(screen.queryByTestId(T.listening)).toBeNull();
    expect(screen.getByTestId(T.commentHeld)).toHaveTextContent(copy.player.heldSilenceTitle);
    expect(screen.getByTestId('held')).toHaveTextContent('silence');
    expect(isPlaying()).toBe(false);
    await settle();
    expect(uploader.complete).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    // Talking again: a new comment, recording.
    act(() => mic.set(0.5));
    await advance(600);
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(screen.queryByTestId(T.commentHeld)).toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(2);
  });

  it('warns in the last minute and ends at the longest a comment may be, even mid-speech', async () => {
    const { uploader } = await setup(kind);
    playPause();
    await advance(500);
    playPause();
    act(() => mic.set(0.5));
    await advance(COMMENT_MAX_MS - COMMENT_WARN_BEFORE_MS - 1000);
    expect(screen.queryByTestId(T.commentLimitWarning)).toBeNull();
    await advance(2000);
    expect(screen.getByTestId(T.commentLimitWarning)).toHaveTextContent('Less than a minute');
    await advance(COMMENT_WARN_BEFORE_MS);
    expect(screen.getByTestId(T.commentHeld)).toHaveTextContent(copy.player.heldCapTitle);
    await settle();
    expect(uploader.complete).toHaveBeenCalledTimes(1);

    // Still talking (the room, say): nothing records until they ask.
    await advance(10_000);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    fireEvent.click(screen.getByTestId(T.sayMore));
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(2);
  });

  it('play from there watches on, as usual', async () => {
    await setup(kind);
    playPause();
    await advance(500);
    playPause();
    await advance(COMMENT_SILENCE_END_MS + 500);
    expect(screen.getByTestId(T.commentHeld)).toBeInTheDocument();
    playPause();
    await settle();
    expect(isPlaying()).toBe(true);
    expect(screen.queryByTestId(T.commentHeld)).toBeNull();
    expect(screen.getByTestId('held')).toHaveTextContent('none');
  });
});

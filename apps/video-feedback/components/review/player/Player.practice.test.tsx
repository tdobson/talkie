import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TalkieFilm } from '@talkie/format';
import { useEffect, useReducer, useState } from 'react';
import {
  FEEDBACK_HINT_AFTER_MS,
  FEEDBACK_HINT_SHOW_MS,
  PRACTICE_GOT_THAT_MS,
  PRACTICE_SILENCE_MS,
  PRACTICE_SPEECH_MS,
} from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import { initialState, type ReviewState, reducer } from '@/lib/review/machine';
import { T } from '@/lib/testids';
import type { MediaKind } from '@/lib/types';
import { FakeMediaRecorder, fakeStream, stubMediaPlayback } from '@/test/helpers/fakeMedia';
import { act, fireEvent, render, screen } from '@/test/helpers/render';
import { FakeEngine } from '../media/fakes';
import { TalkieAdapter } from '../media/TalkieAdapter';
import { type MountTalkie, Player, type PlayerUploader } from './Player';

// The level the practice pause hears. jsdom has no audio, so the test sets it, and the
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
  practice: 'intro',
};

function Harness(props: {
  uploader: PlayerUploader;
  mediaKind: MediaKind;
  mountTalkie?: MountTalkie;
  initial: ReviewState;
  src?: string;
  autoPlay?: boolean;
}) {
  const [state, dispatch] = useReducer(reducer, props.initial);
  // One stream for the whole test: a new one means the microphone was reconnected.
  const [stream] = useState(() => fakeStream().stream);
  return (
    <>
      <output data-testid="practice">{state.practice ?? 'none'}</output>
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
        src={props.src}
        autoPlay={props.autoPlay}
      />
    </>
  );
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(5));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const playPause = () => fireEvent.click(screen.getByTestId(T.playPause));
const begin = () => fireEvent.click(screen.getByTestId(T.practiceStart));
const isPlaying = () => screen.getByTestId(T.playPause).getAttribute('aria-label') === 'Pause';

/** Mounts a player of either kind and returns how to read and move its playhead. */
async function setup(
  kind: MediaKind,
  initial: ReviewState = practiceState,
  extra: { src?: string; autoPlay?: boolean } = {}
) {
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
    <Harness
      uploader={uploader}
      mediaKind={kind}
      mountTalkie={mountTalkie}
      initial={initial}
      {...extra}
    />
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

/** Speaks for a little over the practice minimum, then goes quiet until it is heard. */
async function talkThenStop() {
  act(() => mic.set(0.5));
  await advance(PRACTICE_SPEECH_MS + 200);
  act(() => mic.set(0));
  await advance(PRACTICE_SILENCE_MS + 100);
}

let media: ReturnType<typeof stubMediaPlayback>;
beforeEach(() => {
  mic.level = 0;
  // The default fakes include performance.now(), which times the practice speech.
  vi.useFakeTimers();
  FakeMediaRecorder.instances = [];
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  media = stubMediaPlayback();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each(['mp4', 'talkie'] as const)('practice run (%s)', (kind) => {
  it('says it is a practice and how feedback works before anything plays', async () => {
    await setup(kind);
    expect(isPlaying()).toBe(false);
    const intro = screen.getByTestId(T.practiceIntro);
    expect(intro).toHaveTextContent(copy.practice.introTitle);
    expect(intro).toHaveTextContent('pause it and talk');
    expect(screen.getByTestId(T.practiceBanner)).toHaveTextContent(copy.practice.banner);
    expect(screen.getByTestId(T.practiceStart)).toBeEnabled();
  });

  it('Start practice plays the film, with a coach mark on Pause and the banner still up', async () => {
    const { getTime } = await setup(kind);
    begin();
    await settle();
    expect(isPlaying()).toBe(true);
    expect(getTime()).toBe(0);
    expect(screen.queryByTestId(T.practiceIntro)).toBeNull();
    expect(screen.getByTestId(T.coachMark)).toHaveTextContent(copy.practice.coachKeys);
    expect(screen.getByTestId(T.practiceBanner)).toBeInTheDocument();
    expect(screen.getByTestId(T.giveFeedback)).toBeEnabled();
    // The click on the card did not count as a pause on the picture.
    expect(screen.queryByTestId(T.practiceListening)).toBeNull();
  });

  it('play, instead of Start practice, starts the practice too', async () => {
    await setup(kind);
    playPause();
    await settle();
    expect(isPlaying()).toBe(true);
    expect(screen.getByTestId('practice')).toHaveTextContent('coach');
  });

  it('a practice pause listens, says Got that as soon as they speak, then hands on to the real film; nothing is saved', async () => {
    const { uploader, moveTo } = await setup(kind);
    begin();
    await settle();
    moveTo(1.5);
    playPause();
    expect(isPlaying()).toBe(false);
    expect(screen.getByTestId(T.practiceListening)).toHaveTextContent(copy.practice.listening);
    expect(screen.queryByTestId(T.listening)).toBeNull();
    expect(screen.queryByTestId(T.coachMark)).toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    await talkThenStop();
    expect(screen.getByTestId(T.practiceGotThat)).toHaveTextContent(copy.practice.gotThat);
    expect(isPlaying()).toBe(false);

    // The practice is over: the page swaps this player for one on the real film.
    await advance(PRACTICE_GOT_THAT_MS);
    expect(screen.getByTestId('practice')).toHaveTextContent('none');
    expect(isPlaying()).toBe(false);
    expect(screen.queryByTestId(T.practiceGotThat)).toBeNull();
    expect(screen.queryByTestId(T.practiceBanner)).toBeNull();

    // Never recorded, never uploaded.
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(uploader.enqueue).not.toHaveBeenCalled();
    expect(uploader.complete).not.toHaveBeenCalled();
  });

  it('Give feedback pauses just as Pause does', async () => {
    await setup(kind);
    begin();
    await settle();
    fireEvent.click(screen.getByTestId(T.giveFeedback));
    expect(screen.getByTestId(T.practiceListening)).toBeInTheDocument();
    expect(screen.getByTestId(T.giveFeedback)).toBeDisabled();
  });

  it('pressing play during the practice pause skips straight on to the real film', async () => {
    const { moveTo } = await setup(kind);
    begin();
    await settle();
    moveTo(2);
    playPause();
    playPause();
    expect(screen.getByTestId('practice')).toHaveTextContent('none');
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('silence never ends the practice pause on its own', async () => {
    await setup(kind);
    begin();
    await settle();
    playPause();
    await advance(30_000);
    expect(screen.getByTestId(T.practiceListening)).toBeInTheDocument();
  });
});

describe('the practice clip', () => {
  it('plays the clip it is given, round and round, and offers no Done', async () => {
    await setup('mp4', practiceState, { src: '/practice/clip.mp4' });
    const video = screen.getByTestId(T.video) as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/practice/clip.mp4');
    expect(video.loop).toBe(true);
    expect(screen.queryByTestId(T.doneButton)).toBeNull();
  });

  it('the real film, straight after the practice, plays by itself once it has loaded', async () => {
    await setup('mp4', { ...practiceState, practice: null }, { autoPlay: true });
    const video = screen.getByTestId(T.video) as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('/api/r/tok/video?version=2');
    expect(video.loop).toBe(false);
    expect(isPlaying()).toBe(true);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it('a film plays by itself too, once its engine is ready', async () => {
    await setup('talkie', { ...practiceState, practice: null }, { autoPlay: true });
    expect(isPlaying()).toBe(true);
  });

  it('without autoPlay the film waits for play', async () => {
    await setup('mp4', { ...practiceState, practice: null });
    expect(isPlaying()).toBe(false);
    expect(screen.getByTestId(T.doneButton)).toBeInTheDocument();
  });
});

describe('practice run, refused playback', () => {
  it('asks for play when the browser will not start it', async () => {
    media.play.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }));
    await setup('mp4');
    begin();
    await settle();
    expect(isPlaying()).toBe(false);
    expect(screen.getByTestId(T.coachMark)).toHaveTextContent(copy.practice.coachPlay);
  });
});

describe('the hint to pause', () => {
  it('fades in after a long stretch of playing, and only while playing', async () => {
    await setup('mp4', { ...practiceState, practice: null });
    expect(screen.queryByTestId(T.coachMark)).toBeNull();
    playPause();
    await advance(FEEDBACK_HINT_AFTER_MS - 10);
    expect(screen.queryByTestId(T.feedbackHint)).toBeNull();
    await advance(500);
    expect(screen.getByTestId(T.feedbackHint)).toHaveTextContent(copy.player.idleHint);
    await advance(FEEDBACK_HINT_SHOW_MS + 1000);
    expect(screen.queryByTestId(T.feedbackHint)).toBeNull();
  });

  it('is not shown during the practice run', async () => {
    await setup('mp4');
    begin();
    await advance(FEEDBACK_HINT_AFTER_MS + 500);
    expect(screen.queryByTestId(T.feedbackHint)).toBeNull();
  });
});

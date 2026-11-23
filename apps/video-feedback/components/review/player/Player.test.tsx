import { type Dispatch, useReducer } from 'react';
import { HOLD_TO_ZOOM_MS } from '@/lib/constants';
import type { PendingChunk } from '@/lib/capture/uploader';
import { copy } from '@/lib/review/copy';
import { initialState, type ReviewAction, type ReviewState, reducer } from '@/lib/review/machine';
import { T } from '@/lib/testids';
import type { CaptureEvent, CompleteBody } from '@/lib/types';
import { FakeMediaRecorder, fakeStream, stubMediaPlayback } from '@/test/helpers/fakeMedia';
import { act, fireEvent, render, screen } from '@/test/helpers/render';
import { Player, type PlayerUploader } from './Player';

const FRAME = 0.04;
const playerState: ReviewState = {
  ...initialState,
  screen: 'player',
  name: 'Sarah',
  sessionId: 'sid',
  version: 2,
};

type Chunk = Omit<PendingChunk, 'key' | 'token'>;

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (e: Error) => void;
}
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeUploader() {
  const chunks: Chunk[] = [];
  const completes: Array<{ sid: string; cid: string; body: CompleteBody; done: Deferred }> = [];
  const uploader: PlayerUploader = {
    enqueue: vi.fn(async (chunk: Chunk) => {
      chunks.push(chunk);
    }),
    complete: vi.fn((sid: string, cid: string, body: CompleteBody) => {
      const done = deferred();
      completes.push({ sid, cid, body, done });
      return done.promise;
    }),
  };
  const events = (): CaptureEvent[] => chunks.flatMap((c) => c.events);
  return { uploader, chunks, completes, events };
}

function Harness(props: {
  uploader: PlayerUploader;
  stream: MediaStream;
  initial?: ReviewState;
  onDone?: () => void;
  onReconnectMic?: () => void;
  trouble?: boolean;
  reconnecting?: boolean;
  reconnectFailed?: boolean;
  /** Gives the test the machine's dispatch, to play the part of ReviewApp. */
  dispatchRef?: { current: Dispatch<ReviewAction> | null };
}) {
  const [state, dispatch] = useReducer(reducer, props.initial ?? playerState);
  if (props.dispatchRef) props.dispatchRef.current = dispatch;
  return (
    <>
      <output data-testid="screen">{state.screen}</output>
      <Player
        token="tok"
        frameDuration={FRAME}
        state={state}
        dispatch={dispatch}
        stream={props.stream}
        uploader={props.uploader}
        trouble={props.trouble ?? false}
        reconnecting={props.reconnecting}
        reconnectFailed={props.reconnectFailed}
        onReconnectMic={props.onReconnectMic ?? (() => {})}
        onDone={props.onDone ?? (() => {})}
      />
    </>
  );
}

/** Shows the open comment id, so a test can refuse exactly that comment. */
function HarnessWithRefusal(props: {
  uploader: PlayerUploader;
  stream: MediaStream;
  refused: string | null;
}) {
  const [state, dispatch] = useReducer(reducer, playerState);
  return (
    <>
      <output data-testid="cid">{state.commentId ?? ''}</output>
      <Player
        token="tok"
        frameDuration={FRAME}
        state={state}
        dispatch={dispatch}
        stream={props.stream}
        uploader={props.uploader}
        trouble={false}
        refusedCommentId={props.refused}
        onReconnectMic={() => {}}
        onDone={() => {}}
      />
    </>
  );
}

let media: ReturnType<typeof stubMediaPlayback>;

/** Gives the stage a 1000x500 box and the video a 2:1 picture, so the picture fills the stage. */
function layOut(duration = 10) {
  const stage = screen.getByTestId(T.videoStage);
  stage.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 500);
  const video = screen.getByTestId(T.video) as HTMLVideoElement;
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: 2000 });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: 1000 });
  Object.defineProperty(video, 'duration', { configurable: true, value: duration });
  let time = 0;
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => time,
    set: (v: number) => {
      time = v;
    },
  });
  fireEvent.loadedMetadata(video);
  return { stage, video, layer: video.parentElement as HTMLElement };
}

function setup(opts: Partial<Parameters<typeof Harness>[0]> = {}) {
  const up = fakeUploader();
  const stream = opts.stream ?? fakeStream().stream;
  render(<Harness uploader={up.uploader} {...opts} stream={stream} />);
  return { ...up, ...layOut() };
}

const playPause = () => fireEvent.click(screen.getByTestId(T.playPause));
/** Lets the fake recorder's zero-delay timers and any promise chains run. */
const settle = () => act(() => vi.advanceTimersByTimeAsync(5));

beforeEach(() => {
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

describe('Player', () => {
  it('pausing opens a comment and shows the listening overlay; play completes it and shows Saved', async () => {
    const { chunks, completes, video } = setup();
    expect(screen.queryByTestId(T.listening)).toBeNull();

    playPause();
    expect(media.play).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    video.currentTime = 3.2;
    playPause();
    expect(media.pause).toHaveBeenCalled();
    const overlay = screen.getByTestId(T.listening);
    expect(overlay).toHaveAttribute('role', 'status');
    expect(overlay).toHaveAttribute('aria-live', 'polite');
    expect(overlay).toHaveTextContent(copy.player.listening);
    expect(overlay).toHaveTextContent(copy.player.listeningHelp);
    expect(overlay).toHaveTextContent(copy.player.listeningTips);
    expect(screen.getByTestId(T.listeningLevel)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    await settle();

    playPause();
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(T.listening)).toBeNull();
    await settle();

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ sid: 'sid', seq: 0 });
    expect(chunks[0].meta).toMatchObject({
      commentId: chunks[0].cid,
      sessionId: 'sid',
      version: 2,
      kind: 'moment',
      pausedAtVideoTime: 3.2,
      audioMime: 'audio/webm;codecs=opus',
      player: { containerWidth: 1000, containerHeight: 500, videoWidth: 2000, videoHeight: 1000 },
    });
    expect(completes).toHaveLength(1);
    expect(completes[0]).toMatchObject({ sid: 'sid', cid: chunks[0].cid });
    expect(completes[0].body).toMatchObject({ totalChunks: 1 });
    expect(completes[0].body.micLost).toBeUndefined();
    expect(screen.getByTestId(T.savingToast)).toHaveTextContent(copy.player.saving);
    expect(screen.queryByTestId(T.savedToast)).toBeNull();

    completes[0].done.resolve();
    await settle();
    expect(screen.getByTestId(T.savedToast)).toHaveTextContent(copy.player.saved);
    expect(screen.queryByTestId(T.savingToast)).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(screen.queryByTestId(T.savedToast)).toBeNull();
  });

  it('sends a chunk every two seconds with the events since the last one', async () => {
    const { chunks, stage } = setup();
    playPause();
    playPause();
    await settle();
    fireEvent.pointerMove(stage, { clientX: 500, clientY: 250 });
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].meta).toBeDefined();
    expect(chunks[0].events).toContainEqual(
      expect.objectContaining({ type: 'pointer', x: 0.5, y: 0.5, inside: true })
    );
    fireEvent.pointerMove(stage, { clientX: 100, clientY: 250 });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(chunks).toHaveLength(2);
    expect(chunks[1]).toMatchObject({ seq: 1 });
    expect(chunks[1].meta).toBeUndefined();
    expect(chunks[1].events).toEqual([expect.objectContaining({ type: 'pointer', x: 0.1 })]);
  });

  it('records nothing during playback', async () => {
    const { chunks, stage } = setup();
    playPause();
    fireEvent.pointerMove(stage, { clientX: 500, clientY: 250 });
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(chunks).toHaveLength(0);
  });

  it('a short click while paused logs a click and does not resume playback', async () => {
    const { events, stage } = setup();
    playPause();
    playPause();
    await settle();
    expect(media.play).toHaveBeenCalledTimes(1);

    fireEvent.pointerDown(stage, { clientX: 600, clientY: 350, button: 0 });
    await act(() => vi.advanceTimersByTimeAsync(80));
    fireEvent.pointerUp(stage, { clientX: 600, clientY: 350, button: 0 });
    fireEvent.click(stage);
    await settle();

    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(media.play).toHaveBeenCalledTimes(1);

    playPause();
    await settle();
    const clicks = events().filter((e) => e.type === 'click');
    expect(clicks).toHaveLength(1);
    expect(clicks[0]).toMatchObject({ x: 0.6, y: 0.7, inside: true, button: 0 });
    expect(events().some((e) => e.type === 'zoom')).toBe(false);
  });

  it('clicking the picture while playing pauses and starts a comment', async () => {
    const { stage } = setup();
    playPause();
    fireEvent.pointerDown(stage, { clientX: 600, clientY: 350, button: 0 });
    fireEvent.pointerUp(stage, { clientX: 600, clientY: 350, button: 0 });
    fireEvent.click(stage);
    expect(media.pause).toHaveBeenCalled();
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it('holding for 250ms zooms and releasing unzooms, logging zoom events', async () => {
    const { events, stage, layer } = setup();
    playPause();
    playPause();
    await settle();

    fireEvent.pointerDown(stage, { clientX: 300, clientY: 150, button: 0 });
    await act(() => vi.advanceTimersByTimeAsync(HOLD_TO_ZOOM_MS - 10));
    expect(layer.style.transform).not.toContain('scale');

    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(layer.style.transform).toBe('scale(2.5)');
    expect(layer.style.transformOrigin).toBe('30% 30%');
    expect(stage).toHaveAttribute('data-zoomed', 'true');

    fireEvent.pointerMove(stage, { clientX: 400, clientY: 200 });
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(layer.style.transformOrigin).toBe('40% 40%');

    fireEvent.pointerUp(stage, { clientX: 400, clientY: 200, button: 0 });
    fireEvent.click(stage);
    await settle();
    expect(layer.style.transform).not.toContain('scale');
    expect(stage).not.toHaveAttribute('data-zoomed');
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();

    playPause();
    await settle();
    const all = events();
    const zooms = all.filter((e) => e.type === 'zoom');
    expect(zooms).toEqual([
      expect.objectContaining({ state: 'start', scale: 2.5, originX: 0.3, originY: 0.3 }),
      expect.objectContaining({ state: 'end', scale: 2.5, originX: 0.4, originY: 0.4 }),
    ]);
    expect(all).toContainEqual(
      expect.objectContaining({ type: 'zoomPan', originX: 0.4, originY: 0.4 })
    );
    // Pointer positions stay in full-frame coordinates and are flagged while zoomed.
    expect(all).toContainEqual(
      expect.objectContaining({ type: 'pointer', x: 0.4, y: 0.4, zoomed: true })
    );
    // A hold is not a click.
    expect(all.some((e) => e.type === 'click')).toBe(false);
  });

  it('does not zoom during playback', async () => {
    const { stage, layer } = setup();
    playPause();
    fireEvent.pointerDown(stage, { clientX: 300, clientY: 150, button: 0 });
    await act(() => vi.advanceTimersByTimeAsync(HOLD_TO_ZOOM_MS + 50));
    expect(layer.style.transform).not.toContain('scale');
  });

  it('arrow keys step frames while paused and log each as a seek', async () => {
    const { events, video } = setup();
    playPause();
    video.currentTime = 2;
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(2);

    playPause();
    await settle();
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(video.currentTime).toBeCloseTo(2 - FRAME, 6);
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(video.currentTime).toBeCloseTo(3 - FRAME, 6);

    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    await settle();
    expect(media.play).toHaveBeenCalledTimes(2);
    const seeks = events().filter((e) => e.type === 'seek');
    expect(seeks).toHaveLength(2);
    expect(seeks[0]).toMatchObject({ via: 'key', from: 2 });
    expect(seeks[1]).toMatchObject({ via: 'key' });
  });

  it('the back and forward buttons jump 10 and 5 seconds, logged as seeks only while paused', async () => {
    const { events, video } = setup();
    playPause();
    video.currentTime = 8;
    fireEvent.click(screen.getByTestId(T.skipBack));
    expect(video.currentTime).toBe(0);
    fireEvent.click(screen.getByTestId(T.skipForward));
    expect(video.currentTime).toBe(5);
    expect(screen.queryByTestId(T.listening)).toBeNull();

    playPause();
    await settle();
    fireEvent.click(screen.getByTestId(T.skipForward));
    expect(video.currentTime).toBe(10);
    fireEvent.click(screen.getByTestId(T.skipBack));
    expect(video.currentTime).toBe(0);
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    await settle();
    const seeks = events().filter((e) => e.type === 'seek');
    expect(seeks).toEqual([
      expect.objectContaining({ via: 'button', from: 5, to: 10 }),
      expect.objectContaining({ via: 'button', from: 10, to: 0 }),
    ]);
  });

  it('never steps past the ends of the video', async () => {
    const { video } = setup();
    playPause();
    video.currentTime = 9.99;
    playPause();
    await settle();
    fireEvent.keyDown(document.body, { key: 'ArrowRight', shiftKey: true });
    expect(video.currentTime).toBe(10);
    video.currentTime = 0.01;
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', shiftKey: true });
    expect(video.currentTime).toBe(0);
  });

  it('shows the end screen when the video ends, with one Done button', async () => {
    const { video } = setup();
    playPause();
    fireEvent.ended(video);
    expect(screen.getByTestId(T.endScreen)).toBeInTheDocument();
    expect(screen.getAllByTestId(T.doneButton)).toHaveLength(1);
    expect(screen.getByTestId('screen')).toHaveTextContent('end');
    // The controls stay usable.
    expect(screen.getByTestId(T.scrollBar)).toBeInTheDocument();
  });

  it('records a general comment that space cannot end', async () => {
    const { chunks, completes } = setup({ initial: { ...playerState, screen: 'end' } });
    fireEvent.click(screen.getByTestId(T.shareMore));
    expect(screen.getByTestId(T.generalComment)).toHaveTextContent(copy.general.prompt1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    await settle();

    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    await settle();
    expect(screen.getByTestId(T.generalComment)).toBeInTheDocument();
    expect(media.play).not.toHaveBeenCalled();
    expect(completes).toHaveLength(0);

    fireEvent.click(screen.getByTestId(T.generalFinished));
    await settle();
    expect(screen.queryByTestId(T.generalComment)).toBeNull();
    expect(screen.getByTestId(T.endScreen)).toBeInTheDocument();
    expect(chunks[0].meta).toMatchObject({ kind: 'general', pausedAtVideoTime: null });
    expect(completes).toHaveLength(1);
  });

  it('Done saves the open comment before it reports done', async () => {
    const onDone = vi.fn();
    const { completes } = setup({ onDone });
    playPause();
    playPause();
    await settle();

    fireEvent.click(screen.getByTestId(T.doneButton));
    await settle();
    expect(completes).toHaveLength(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId(T.doneButton)).toBeDisabled();

    completes[0].done.resolve();
    await settle();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Done with nothing open reports done straight away', async () => {
    const onDone = vi.fn();
    setup({ onDone });
    fireEvent.click(screen.getByTestId(T.doneButton));
    await settle();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a lost microphone shows Reconnect and still uploads the events, flagged micLost', async () => {
    const onReconnectMic = vi.fn();
    const mic = fakeStream('ended');
    const { chunks, completes, stage } = setup({
      stream: mic.stream,
      initial: { ...playerState, micLost: true },
      onReconnectMic,
    });
    playPause();
    playPause();
    await settle();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(screen.getByTestId(T.micLost)).toHaveTextContent(copy.player.micLost);
    fireEvent.click(screen.getByTestId(T.micReconnect));
    expect(onReconnectMic).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(stage, { clientX: 500, clientY: 250 });
    await act(() => vi.advanceTimersByTimeAsync(40));
    playPause();
    await settle();

    expect(chunks).toHaveLength(1);
    expect(chunks[0].audio.size).toBe(0);
    expect(chunks[0].meta).toMatchObject({ kind: 'moment' });
    expect(chunks[0].events).toContainEqual(expect.objectContaining({ type: 'pointer' }));
    expect(completes[0].body).toMatchObject({ totalChunks: 1, micLost: true });
  });

  it('a microphone lost mid-comment and reconnected flags that comment and records a new one', async () => {
    const up = fakeUploader();
    const first = fakeStream();
    const dispatchRef: { current: Dispatch<ReviewAction> | null } = { current: null };
    const ui = (stream: MediaStream) => (
      <Harness uploader={up.uploader} stream={stream} dispatchRef={dispatchRef} />
    );
    const { rerender } = render(ui(first.stream));
    layOut();
    playPause();
    playPause();
    await settle();
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();

    // The track ends: the browser stops the recorder itself, and ReviewApp reports the loss.
    first.track.readyState = 'ended';
    FakeMediaRecorder.instances[0].stop();
    act(() => dispatchRef.current?.({ type: 'micLost' }));
    await settle();
    expect(screen.getByTestId(T.micLost)).toBeInTheDocument();
    expect(screen.queryByTestId(T.listening)).toBeNull();

    // Reconnect: a new stream arrives, then the machine hears about it.
    const second = fakeStream();
    rerender(ui(second.stream));
    act(() => dispatchRef.current?.({ type: 'micReconnected' }));
    await settle();

    // The interrupted comment is closed and flagged; Listening is backed by a live recorder.
    expect(up.completes).toHaveLength(1);
    expect(up.completes[0].body).toMatchObject({ micLost: true });
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(2);
    expect(FakeMediaRecorder.instances[1].stream).toBe(second.stream);
    expect(FakeMediaRecorder.instances[1].state).toBe('recording');

    playPause();
    await settle();
    expect(up.completes).toHaveLength(2);
    expect(up.completes[1].cid).not.toBe(up.completes[0].cid);
    expect(up.completes[1].body.micLost).toBeUndefined();
    const audio = up.chunks.filter((c) => c.cid === up.completes[1].cid && c.audio.size > 0);
    expect(audio.length).toBeGreaterThan(0);
  });

  it('a microphone lost mid-comment and never reconnected is flagged micLost', async () => {
    const mic = fakeStream();
    const dispatchRef: { current: Dispatch<ReviewAction> | null } = { current: null };
    const { completes } = setup({ stream: mic.stream, dispatchRef });
    playPause();
    playPause();
    await settle();
    mic.track.readyState = 'ended';
    FakeMediaRecorder.instances[0].stop();
    act(() => dispatchRef.current?.({ type: 'micLost' }));
    await settle();
    playPause();
    await settle();
    expect(completes).toHaveLength(1);
    expect(completes[0].body).toMatchObject({ micLost: true });
  });

  it('shows the trouble banner while uploads are failing', () => {
    setup({ trouble: true });
    expect(screen.getByTestId(T.saveTroubleBanner)).toHaveTextContent(copy.player.trouble);
  });

  it('a comment that cannot be saved shows the banner instead of Saved', async () => {
    const { completes } = setup();
    expect(screen.queryByTestId(T.saveTroubleBanner)).toBeNull();
    playPause();
    playPause();
    await settle();
    playPause();
    await settle();
    completes[0].done.reject(new Error('HTTP 413'));
    await settle();
    expect(screen.queryByTestId(T.savedToast)).toBeNull();
    expect(screen.queryByTestId(T.savingToast)).toBeNull();
    expect(screen.getByTestId(T.saveTroubleBanner)).toBeInTheDocument();
  });

  it('never shows a timecode', async () => {
    const { video } = setup();
    video.currentTime = 754;
    fireEvent.timeUpdate(video);
    playPause();
    playPause();
    await settle();
    expect(document.body.textContent).not.toMatch(/\d+:\d{2}/);
  });

  it('asks the player container, not the video, to go fullscreen', async () => {
    setup();
    const container = screen.getByTestId(T.player);
    const request = vi.fn().mockResolvedValue(undefined);
    container.requestFullscreen = request;
    fireEvent.click(screen.getByTestId(T.fullscreen));
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('loads the video for the session version, with no browser controls', () => {
    const { video } = setup();
    expect(video.getAttribute('src')).toBe('/api/r/tok/video?version=2');
    expect(video).not.toHaveAttribute('controls');
  });
});

describe('Player hardening', () => {
  const rejectingPlay = (name: string) => {
    const err = Object.assign(new Error(name), { name });
    media.play.mockRejectedValue(err);
  };

  it('a general comment makes the stage and controls inert, and Done under it does nothing', async () => {
    const onDone = vi.fn();
    const { completes } = setup({ initial: { ...playerState, screen: 'end' }, onDone });
    fireEvent.click(screen.getByTestId(T.shareMore));
    await settle();

    for (const id of [T.doneButton, T.playPause, T.scrollBar, T.fullscreen, T.videoStage]) {
      expect(screen.getByTestId(id).closest('[inert]')).not.toBeNull();
    }
    expect(screen.getByTestId(T.generalFinished).closest('[inert]')).toBeNull();

    // jsdom does not enforce inert, so this is the click a browser would never deliver.
    fireEvent.click(screen.getByTestId(T.doneButton));
    await settle();
    expect(onDone).not.toHaveBeenCalled();
    expect(completes).toHaveLength(0);
    expect(screen.getByTestId(T.generalComment)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances[0].state).toBe('recording');
  });

  it('nothing is inert outside a general comment', () => {
    setup();
    expect(screen.getByTestId(T.doneButton).closest('[inert]')).toBeNull();
  });

  it('a video that fails to load shows an error, not a comment', async () => {
    const { video, chunks } = setup();
    rejectingPlay('NotSupportedError');
    playPause();
    await settle();
    expect(screen.getByTestId(T.videoError)).toHaveTextContent(copy.player.videoError);
    expect(screen.queryByTestId(T.listening)).toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(chunks).toHaveLength(0);
    expect(screen.getByTestId(T.playPause)).toHaveAccessibleName('Play');
    expect(video).toBeInTheDocument();
  });

  it('a play() that is refused for another reason goes back to paused without a comment', async () => {
    setup();
    rejectingPlay('NotAllowedError');
    playPause();
    await settle();
    expect(screen.queryByTestId(T.videoError)).toBeNull();
    expect(screen.queryByTestId(T.listening)).toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(screen.getByTestId(T.playPause)).toHaveAccessibleName('Play');
  });

  it('the video error event shows the error and stops playback without a comment', async () => {
    const { video } = setup();
    playPause();
    fireEvent.error(video);
    await settle();
    expect(screen.getByTestId(T.videoError)).toBeInTheDocument();
    expect(screen.queryByTestId(T.listening)).toBeNull();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it('shows a loading indicator while the video is buffering', () => {
    const { video } = setup();
    expect(screen.queryByTestId(T.videoLoading)).toBeNull();
    fireEvent.waiting(video);
    expect(screen.getByTestId(T.videoLoading)).toBeInTheDocument();
    fireEvent.playing(video);
    expect(screen.queryByTestId(T.videoLoading)).toBeNull();
  });

  it('scrolling back from the end screen starts listening at the frame it lands on', async () => {
    const { video, chunks, completes, events } = setup();
    playPause();
    video.currentTime = 10;
    fireEvent.timeUpdate(video);
    fireEvent.ended(video);
    expect(screen.getByTestId(T.endScreen)).toBeInTheDocument();

    // One drag of the scroll bar: a few ticks, settling at the start. (Up, Down and Home are
    // the slider's own keys; the page-level handler only owns Left and Right.)
    const thumb = () =>
      screen.getByTestId(T.scrollBar).querySelector('[role="slider"]') as HTMLElement;
    fireEvent.keyDown(thumb(), { key: 'ArrowDown' });
    fireEvent.keyDown(thumb(), { key: 'ArrowDown' });
    fireEvent.keyDown(thumb(), { key: 'Home' });
    expect(video.currentTime).toBe(0);
    await settle();
    expect(screen.getByTestId('screen')).toHaveTextContent('player');
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    playPause();
    await settle();
    expect(completes).toHaveLength(1);
    expect(chunks[0].meta).toMatchObject({ kind: 'moment' });
    expect(chunks[0].meta?.pausedAtVideoTime).toBe(0);
    // The ticks of the scroll back are where the comment starts, not seeks within it.
    expect(events().filter((e) => e.type === 'seek')).toHaveLength(0);
  });

  it('a refused comment stops listening at once and shows the banner', async () => {
    const up = fakeUploader();
    const stream = fakeStream().stream;
    const ui = (refused: string | null) => (
      <HarnessWithRefusal uploader={up.uploader} stream={stream} refused={refused} />
    );
    const { rerender } = render(ui(null));
    layOut();
    playPause();
    playPause();
    await settle();
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
    expect(screen.queryByTestId(T.saveTroubleBanner)).toBeNull();
    const cid = screen.getByTestId('cid').textContent ?? '';
    expect(cid).not.toBe('');

    rerender(ui(cid));
    await settle();
    expect(screen.queryByTestId(T.listening)).toBeNull();
    expect(screen.getByTestId(T.commentStopped)).toHaveTextContent(copy.player.stopped);
    expect(screen.getByTestId(T.saveTroubleBanner)).toBeInTheDocument();
    expect(FakeMediaRecorder.instances[0].state).toBe('inactive');

    // A refusal of some other comment changes nothing.
    rerender(ui('someone-else'));
    expect(screen.getByTestId(T.listening)).toBeInTheDocument();
  });

  it('the fullscreen button says what it will do', () => {
    setup();
    const button = screen.getByTestId(T.fullscreen);
    expect(button).toHaveAccessibleName('Full screen');
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: screen.getByTestId(T.player),
    });
    fireEvent(document, new Event('fullscreenchange'));
    expect(screen.getByTestId(T.fullscreen)).toHaveAccessibleName('Exit full screen');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    fireEvent(document, new Event('fullscreenchange'));
    expect(screen.getByTestId(T.fullscreen)).toHaveAccessibleName('Full screen');
  });

  it('Reconnect shows it is working, and says so when it did not work', () => {
    const up = fakeUploader();
    const mic = fakeStream('ended');
    const ui = (reconnecting: boolean, reconnectFailed: boolean) => (
      <Harness
        uploader={up.uploader}
        stream={mic.stream}
        initial={{ ...playerState, micLost: true }}
        reconnecting={reconnecting}
        reconnectFailed={reconnectFailed}
      />
    );
    const { rerender } = render(ui(false, false));
    layOut();
    playPause();
    playPause();
    expect(screen.getByTestId(T.micReconnect)).not.toHaveAttribute('data-loading');
    rerender(ui(true, false));
    expect(screen.getByTestId(T.micReconnect)).toHaveAttribute('data-loading', 'true');
    rerender(ui(false, true));
    expect(screen.getByTestId(T.micStillLost)).toHaveTextContent(copy.player.micStillLost);
  });
});

import { copy } from '@/lib/review/copy';
import { T } from '@/lib/testids';
import { fakeStream, stubMediaPlayback } from '@/test/helpers/fakeMedia';
import { fireEvent, render, screen, userEvent, waitFor } from '@/test/helpers/render';
import { ReviewApp, type ReviewUploader } from './ReviewApp';

// The level meter needs real audio; the screen itself is covered by MicCheck.test.tsx.
vi.mock('./screens/MicCheck', () => ({
  MicCheck: (props: { onStart: () => void }) => (
    <button type="button" data-testid="start-watching" onClick={props.onStart}>
      Start watching
    </button>
  ),
}));

const KEY = 'vf:tok';
const SID = '0b0f7f0a-58a3-4a53-9d0c-3f2f3a6f6f10';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let uploader: ReviewUploader & { resumePending: ReturnType<typeof vi.fn> };

function setMatchMedia(matching: string[]) {
  vi.mocked(window.matchMedia).mockImplementation(
    (query: string) =>
      ({
        matches: matching.includes(query),
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList
  );
}

function renderApp() {
  return render(
    <ReviewApp
      token="tok"
      title="Launch film"
      latestVersion={2}
      frameDuration={0.04}
      createUploader={() => uploader}
    />
  );
}

beforeEach(() => {
  localStorage.clear();
  setMatchMedia([]);
  stubMediaPlayback();
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/r/tok/sessions' && init?.method === 'POST') {
      return json({ sessionId: SID, version: 2 });
    }
    if (url === `/api/r/tok/sessions/${SID}/done`) return json({ ok: true });
    if (url === `/api/r/tok/sessions/${SID}`) {
      return json({ sessionId: SID, version: 1, reviewerName: 'Sarah', done: false });
    }
    return json({ error: 'not found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  getUserMedia = vi.fn(async () => fakeStream().stream);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  uploader = {
    enqueue: vi.fn(async () => {}),
    complete: vi.fn(async () => {}),
    resumePending: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ReviewApp', () => {
  it('walks a new reviewer from the welcome screen to the player and on to thanks', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));

    await user.click(await screen.findByTestId(T.micContinue));
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    await user.click(await screen.findByTestId(T.startWatching));
    expect(await screen.findByTestId(T.player)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/r/tok/sessions');
    expect(JSON.parse(post?.[1].body)).toEqual({
      reviewerName: 'Sarah',
      userAgent: navigator.userAgent,
    });
    expect(localStorage.getItem(KEY)).toBe(SID);
    expect(screen.getByTestId(T.video)).toHaveAttribute('src', '/api/r/tok/video?version=2');

    await user.click(screen.getByTestId(T.doneButton));
    expect(await screen.findByTestId(T.thanks)).toHaveTextContent('Thanks, Sarah.');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/r/tok/sessions/${SID}/done`,
      expect.objectContaining({ method: 'POST' })
    );
    // The link still resumes the same session afterwards.
    expect(localStorage.getItem(KEY)).toBe(SID);
  });

  it('resumes a stored session: no name screen, but still the mic check, on its own version', async () => {
    localStorage.setItem(KEY, SID);
    const user = userEvent.setup();
    renderApp();
    await user.click(await screen.findByTestId(T.micContinue));
    expect(screen.queryByTestId(T.welcome)).toBeNull();
    await user.click(await screen.findByTestId(T.startWatching));
    expect(await screen.findByTestId(T.video)).toHaveAttribute('src', '/api/r/tok/video?version=1');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('forgets a stored session the server no longer knows', async () => {
    localStorage.setItem(KEY, 'gone');
    renderApp();
    expect(await screen.findByTestId(T.welcome)).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps a stored session when the check fails for another reason', async () => {
    localStorage.setItem(KEY, SID);
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    renderApp();
    expect(await screen.findByTestId(T.welcome)).toBeInTheDocument();
    expect(localStorage.getItem(KEY)).toBe(SID);
  });

  it('sends anything left over from an earlier visit', async () => {
    renderApp();
    await screen.findByTestId(T.welcome);
    expect(uploader.resumePending).toHaveBeenCalledTimes(1);
  });

  it('shows the computer notice on a phone, and never the player', async () => {
    setMatchMedia(['(pointer: coarse)']);
    renderApp();
    expect(await screen.findByTestId(T.mobileBlock)).toBeInTheDocument();
    expect(screen.queryByTestId(T.welcome)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets a touch laptop with a mouse through', async () => {
    setMatchMedia(['(pointer: coarse)', '(any-pointer: fine)']);
    renderApp();
    expect(await screen.findByTestId(T.welcome)).toBeInTheDocument();
  });

  it('shows how to unblock a denied microphone and tries again', async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));
    await user.click(await screen.findByTestId(T.micContinue));
    expect(await screen.findByTestId(T.micDenied)).toHaveTextContent(copy.micDenied.title);

    await user.click(screen.getByTestId(T.micRetry));
    expect(await screen.findByTestId(T.startWatching)).toBeInTheDocument();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('stays on the mic check if the session cannot be started, so it can be retried', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));
    await user.click(await screen.findByTestId(T.micContinue));
    fetchMock.mockRejectedValueOnce(new TypeError('offline'));
    await user.click(await screen.findByTestId(T.startWatching));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByTestId(T.player)).toBeNull();
    await user.click(screen.getByTestId(T.startWatching));
    expect(await screen.findByTestId(T.player)).toBeInTheDocument();
  });

  it('notices when the microphone goes away', async () => {
    const user = userEvent.setup();
    const mic = fakeStream();
    getUserMedia.mockResolvedValueOnce(mic.stream);
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));
    await user.click(await screen.findByTestId(T.micContinue));
    await user.click(await screen.findByTestId(T.startWatching));
    await screen.findByTestId(T.player);

    mic.track.readyState = 'ended';
    mic.track.dispatchEvent(new Event('ended'));
    fireEvent.click(screen.getByTestId(T.playPause));
    fireEvent.click(screen.getByTestId(T.playPause));
    expect(await screen.findByTestId(T.micLost)).toBeInTheDocument();

    await user.click(screen.getByTestId(T.micReconnect));
    await waitFor(() => expect(screen.queryByTestId(T.micLost)).toBeNull());
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});

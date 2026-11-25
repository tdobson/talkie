import { copy } from '@/lib/review/copy';
import { PROFILE_KEY, readProfile } from '@/lib/review/profile';
import { T } from '@/lib/testids';
import { PRACTICE_CLIP } from '@/lib/constants';
import { fakeStream, stubMediaPlayback } from '@/test/helpers/fakeMedia';
import { fireEvent, render, screen, userEvent, waitFor } from '@/test/helpers/render';
import { ReviewApp, type ReviewAppProps, type ReviewUploader } from './ReviewApp';

// The level meter needs real audio; the screen itself is covered by MicCheck.test.tsx.
vi.mock('./screens/MicCheck', () => ({
  // Stands in for the screen starting by itself once it has heard the reviewer.
  MicCheck: (props: { onStart: (practice: boolean) => void; startFailed?: boolean }) => (
    <>
      <button type="button" data-testid="start-watching" onClick={() => props.onStart(true)}>
        Start watching
      </button>
      <button type="button" data-testid="start-no-practice" onClick={() => props.onStart(false)}>
        Carry on anyway
      </button>
      {props.startFailed && <p role="alert">start failed</p>}
    </>
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

function renderApp(props: Partial<ReviewAppProps> = {}) {
  return render(
    <ReviewApp
      token="tok"
      title="Launch film"
      latestVersion={2}
      frameDuration={0.04}
      createUploader={() => uploader}
      {...props}
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
    // A new reviewer starts on the practice card, under the practice banner, and the practice
    // plays a short clip of its own, never the film under review.
    expect(screen.getByTestId(T.practiceIntro)).toBeInTheDocument();
    expect(screen.getByTestId(T.practiceBanner)).toBeInTheDocument();
    expect(screen.getByTestId(T.video)).toHaveAttribute('src', PRACTICE_CLIP);
    expect(screen.queryByTestId(T.doneButton)).toBeNull();
    // This browser now knows their name, for every film.
    expect(readProfile().name).toBe('Sarah');

    // Play, pause, then play again instead of talking: on to the real film.
    await user.click(screen.getByTestId(T.playPause));
    await user.click(screen.getByTestId(T.playPause));
    expect(await screen.findByTestId(T.practiceListening)).toBeInTheDocument();
    await user.click(screen.getByTestId(T.playPause));
    expect(screen.queryByTestId(T.practiceBanner)).toBeNull();
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

  it('resumes a stored session on the latest version: no name screen and no hello', async () => {
    localStorage.setItem(KEY, SID);
    const user = userEvent.setup();
    renderApp({ latestVersion: 1 });
    await user.click(await screen.findByTestId(T.micContinue));
    expect(screen.queryByTestId(T.welcome)).toBeNull();
    expect(await screen.findByTestId(T.video)).toHaveAttribute('src', '/api/r/tok/video?version=1');
    expect(screen.queryByTestId(T.startWatching)).toBeNull();
    // They had the practice run the first time.
    expect(screen.queryByTestId(T.practiceIntro)).toBeNull();
    expect(screen.queryByTestId(T.coachMark)).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('starts a new session on the latest version when the stored one is on an older cut', async () => {
    // The stored session is on version 1 and version 2 has been imported since.
    localStorage.setItem(KEY, 'old-sid');
    fetchMock.mockImplementationOnce(async (url: string) => {
      expect(url).toBe('/api/r/tok/sessions/old-sid');
      return json({ sessionId: 'old-sid', version: 1, reviewerName: 'Sarah', done: false });
    });
    const user = userEvent.setup();
    renderApp({ latestVersion: 2 });

    expect(await screen.findByTestId(T.newerVersion)).toHaveTextContent(
      "There's a new version of this film since you last looked. You're now reviewing version 2. Your comments on version 1 are kept."
    );
    expect(screen.queryByTestId(T.welcome)).toBeNull();
    await user.click(screen.getByTestId(T.micContinue));

    expect(await screen.findByTestId(T.video)).toHaveAttribute('src', '/api/r/tok/video?version=2');
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post?.[1].body)).toEqual({
      reviewerName: 'Sarah',
      userAgent: navigator.userAgent,
    });
    expect(localStorage.getItem(KEY)).toBe(SID);
    // They had the practice run the first time.
    expect(screen.queryByTestId(T.coachMark)).toBeNull();
  });

  it('a browser that has reviewed before, on a new link: no name to type, no hello, no practice', async () => {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ name: 'Tim', micChecked: true, practised: true })
    );
    const user = userEvent.setup();
    renderApp();
    expect(await screen.findByTestId(T.welcomeBack)).toHaveTextContent('Welcome back, Tim.');
    expect(screen.queryByTestId(T.nameInput)).toBeNull();
    await user.click(screen.getByTestId(T.startButton));
    // The browser has not said it allows the microphone, so it is explained first.
    await user.click(await screen.findByTestId(T.micContinue));
    expect(await screen.findByTestId(T.video)).toBeInTheDocument();
    expect(screen.queryByTestId(T.startWatching)).toBeNull();
    expect(screen.queryByTestId(T.practiceIntro)).toBeNull();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(post?.[1].body).reviewerName).toBe('Tim');
  });

  it('does not explain the microphone when the browser already allows it', async () => {
    localStorage.setItem(
      PROFILE_KEY,
      JSON.stringify({ name: 'Tim', micChecked: true, practised: true })
    );
    const query = vi.fn(async () => ({ state: 'granted' }));
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } });
    try {
      const user = userEvent.setup();
      renderApp();
      await user.click(await screen.findByTestId(T.startButton));
      expect(await screen.findByTestId(T.video)).toBeInTheDocument();
      expect(query).toHaveBeenCalledWith({ name: 'microphone' });
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(screen.queryByTestId(T.micExplain)).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    }
  });

  it('still shows the new-version notice when the browser already allows the microphone', async () => {
    localStorage.setItem(KEY, 'old-sid');
    fetchMock.mockImplementationOnce(async () =>
      json({ sessionId: 'old-sid', version: 1, reviewerName: 'Sarah', done: false })
    );
    const query = vi.fn(async () => ({ state: 'granted' }));
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } });
    try {
      renderApp({ latestVersion: 2 });
      expect(await screen.findByTestId(T.newerVersion)).toBeInTheDocument();
      expect(getUserMedia).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    }
  });

  it('a first-time browser that already allows the microphone still says hello once', async () => {
    const query = vi.fn(async () => ({ state: 'granted' }));
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query } });
    try {
      const user = userEvent.setup();
      renderApp();
      await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
      await user.click(screen.getByTestId(T.startButton));
      // Straight to the hello check: nothing to explain.
      expect(await screen.findByTestId(T.startWatching)).toBeInTheDocument();
      expect(screen.queryByTestId(T.micContinue)).toBeNull();
    } finally {
      Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    }
  });

  it('says which version is up once there is more than one', async () => {
    renderApp({ latestVersion: 3 });
    expect(await screen.findByTestId(T.versionLabel)).toHaveTextContent('Version 3');
  });

  it('shows no version number while there is only one', async () => {
    renderApp({ latestVersion: 1 });
    await screen.findByTestId(T.welcome);
    expect(screen.queryByTestId(T.versionLabel)).toBeNull();
  });

  it('shows the poster of the latest version on the welcome screen', async () => {
    const posterUrls = { 1: '/api/r/tok/film/1/poster.png', 2: '/api/r/tok/film/2/poster.png' };
    renderApp({ latestVersion: 2, posterUrls });
    const welcome = await screen.findByTestId(T.welcome);
    expect(welcome.querySelector('img')).toHaveAttribute('src', posterUrls[2]);
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
    expect(await screen.findByRole('alert')).toHaveTextContent('start failed');
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
    // Past the practice run, which records nothing.
    await user.click(await screen.findByTestId('start-no-practice'));
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

  it('says so when Reconnect could not get a microphone', async () => {
    const user = userEvent.setup();
    const mic = fakeStream();
    getUserMedia.mockResolvedValueOnce(mic.stream);
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));
    await user.click(await screen.findByTestId(T.micContinue));
    // Past the practice run, which records nothing.
    await user.click(await screen.findByTestId('start-no-practice'));
    await screen.findByTestId(T.player);

    mic.track.readyState = 'ended';
    mic.track.dispatchEvent(new Event('ended'));
    fireEvent.click(screen.getByTestId(T.playPause));
    fireEvent.click(screen.getByTestId(T.playPause));
    await screen.findByTestId(T.micLost);
    expect(screen.queryByTestId(T.micStillLost)).toBeNull();

    getUserMedia.mockRejectedValueOnce(new DOMException('gone', 'NotFoundError'));
    await user.click(screen.getByTestId(T.micReconnect));
    expect(await screen.findByTestId(T.micStillLost)).toHaveTextContent(copy.player.micStillLost);
    expect(screen.getByTestId(T.micReconnect)).toBeEnabled();

    await user.click(screen.getByTestId(T.micReconnect));
    await waitFor(() => expect(screen.queryByTestId(T.micLost)).toBeNull());
  });

  it('says there is no microphone, rather than a blocked one, when none is found', async () => {
    const user = userEvent.setup();
    getUserMedia.mockRejectedValueOnce(new DOMException('none', 'NotFoundError'));
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));
    await user.click(await screen.findByTestId(T.micContinue));
    expect(await screen.findByTestId(T.micNoDevice)).toHaveTextContent(copy.micDenied.noDevice);
    expect(screen.getByTestId(T.micDenied)).not.toHaveTextContent(copy.micDenied.body);
    expect(screen.getByTestId(T.micRetry)).toBeInTheDocument();
  });

  it('a microphone that goes away during the mic check is not a dead end', async () => {
    const user = userEvent.setup();
    const mic = fakeStream();
    getUserMedia.mockResolvedValueOnce(mic.stream);
    renderApp();
    await user.type(await screen.findByTestId(T.nameInput), 'Sarah');
    await user.click(screen.getByTestId(T.startButton));
    await user.click(await screen.findByTestId(T.micContinue));
    await screen.findByTestId(T.startWatching);

    mic.track.readyState = 'ended';
    fireEvent(mic.track as unknown as EventTarget as Element, new Event('ended'));
    expect(await screen.findByTestId(T.micDenied)).toBeInTheDocument();
    await user.click(screen.getByTestId(T.micRetry));
    expect(await screen.findByTestId(T.startWatching)).toBeInTheDocument();
  });
});

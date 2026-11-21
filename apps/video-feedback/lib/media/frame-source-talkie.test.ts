import { STILL_MAX_WIDTH, ZOOM_SCALE } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import {
  ChromiumMissingError,
  TALKIE_MAX_RENDER_WIDTH,
  type TalkieBrowser,
  talkieFrameSource,
} from './frame-source-talkie';

const SIZE = { width: 320, height: 180 };

interface Call {
  vt: number;
  width: number;
  height: number;
}

/** A browser whose renders are finished by hand, so the tests decide the order of events. */
function fakeBrowser() {
  const calls: Call[] = [];
  const pending: Array<{ resolve: (png: Buffer) => void; reject: (e: Error) => void }> = [];
  let running = 0;
  const state = { maxRunning: 0, killed: 0, closed: 0 };
  const browser: TalkieBrowser = {
    render(vt, width, height) {
      calls.push({ vt, width, height });
      running += 1;
      state.maxRunning = Math.max(state.maxRunning, running);
      return new Promise<Buffer>((resolve, reject) => {
        pending.push({ resolve, reject });
      }).finally(() => {
        running -= 1;
      });
    },
    async kill() {
      state.killed += 1;
    },
    async close() {
      state.closed += 1;
    },
  };
  return { browser, calls, pending, state };
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('talkieFrameSource', () => {
  it('does not start a browser until the first frame is asked for', async () => {
    const open = vi.fn();
    const source = talkieFrameSource('/film', SIZE, { open });
    expect(open).not.toHaveBeenCalled();
    await source.close();
    expect(open).not.toHaveBeenCalled();
  });

  it('draws at the width asked for and keeps the aspect of the film', async () => {
    const fake = fakeBrowser();
    const open = vi.fn(async () => fake.browser);
    const source = talkieFrameSource('/film', SIZE, { open });
    const first = source.frame(1, 1920);
    await tick();
    fake.pending[0].resolve(Buffer.from('one'));
    expect((await first).toString()).toBe('one');
    const second = source.frame(1.5, 4800.4);
    await tick();
    fake.pending[1].resolve(Buffer.from('two'));
    await second;
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('/film', expect.any(AbortSignal));
    expect(fake.calls).toEqual([
      { vt: 1, width: 1920, height: 1080 },
      { vt: 1.5, width: 4800, height: 2700 },
    ]);
    await source.close();
  });

  it('never draws wider than the limit, and never at zero', async () => {
    const fake = fakeBrowser();
    const source = talkieFrameSource('/film', SIZE, { open: async () => fake.browser });
    const wide = source.frame(0, 1_000_000);
    await tick();
    fake.pending[0].resolve(Buffer.alloc(0));
    await wide;
    const none = source.frame(0, 0);
    await tick();
    fake.pending[1].resolve(Buffer.alloc(0));
    await none;
    expect(fake.calls[0].width).toBe(TALKIE_MAX_RENDER_WIDTH);
    // The widest picture the product needs is the normal zoom crop of a full still. Memory
    // grows with the square of the width, so the limit is that and no more.
    expect(TALKIE_MAX_RENDER_WIDTH).toBe(Math.ceil(STILL_MAX_WIDTH * ZOOM_SCALE));
    expect(TALKIE_MAX_RENDER_WIDTH).toBe(4800);
    expect(fake.calls[1]).toMatchObject({ width: 1, height: 1 });
    await source.close();
  });

  it('runs one call at a time, in the order asked', async () => {
    const fake = fakeBrowser();
    const source = talkieFrameSource('/film', SIZE, { open: async () => fake.browser });
    const results = [source.frame(1, 100), source.frame(2, 100), source.frame(3, 100)];
    await tick();
    expect(fake.calls.map((c) => c.vt)).toEqual([1]);
    fake.pending[0].resolve(Buffer.from('a'));
    await tick();
    expect(fake.calls.map((c) => c.vt)).toEqual([1, 2]);
    fake.pending[1].resolve(Buffer.from('b'));
    await tick();
    fake.pending[2].resolve(Buffer.from('c'));
    expect((await Promise.all(results)).map(String)).toEqual(['a', 'b', 'c']);
    expect(fake.state.maxRunning).toBe(1);
    await source.close();
  });

  it('kills the browser when a frame passes its time limit, then starts a new one', async () => {
    vi.useFakeTimers();
    const first = fakeBrowser();
    const second = fakeBrowser();
    const open = vi.fn().mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    const source = talkieFrameSource('/film', SIZE, { open, frameTimeoutMs: 30_000 });
    const hung = source.frame(1, 100);
    const outcome = hung.catch((e: Error) => e);
    const next = source.frame(2, 100);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(first.state.killed).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    const error = await outcome;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/time limit of 30s/);
    expect(first.state.killed).toBe(1);
    // The call behind it is not lost: it gets a fresh browser.
    await vi.advanceTimersByTimeAsync(0);
    expect(open).toHaveBeenCalledTimes(2);
    second.pending[0].resolve(Buffer.from('ok'));
    expect((await next).toString()).toBe('ok');
    await source.close();
    expect(second.state.closed).toBe(1);
  });

  it('kills a browser that only finishes starting after the time limit', async () => {
    vi.useFakeTimers();
    const late = fakeBrowser();
    let arrive: (b: TalkieBrowser) => void = () => {};
    const open = vi.fn(
      () =>
        new Promise<TalkieBrowser>((resolve) => {
          arrive = resolve;
        })
    );
    const source = talkieFrameSource('/film', SIZE, { open, frameTimeoutMs: 1000 });
    const outcome = source.frame(1, 100).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(((await outcome) as Error).message).toMatch(/time limit/);
    arrive(late.browser);
    await vi.advanceTimersByTimeAsync(0);
    expect(late.state.killed).toBe(1);
    expect(late.calls).toEqual([]);
    await source.close();
  });

  it('tells a browser that never finishes starting to stop, at the time limit', async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const second = fakeBrowser();
    const open = vi
      .fn()
      .mockImplementationOnce((_dir: string, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<TalkieBrowser>(() => {}); // a stuck film load: this never settles
      })
      .mockImplementationOnce(async (_dir: string, signal: AbortSignal) => {
        signals.push(signal);
        return second.browser;
      });
    const source = talkieFrameSource('/film', SIZE, { open, frameTimeoutMs: 4000 });
    const outcome = source.frame(1, 100).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(3999);
    expect(signals[0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(((await outcome) as Error).message).toMatch(/time limit of 4s/);
    // Nothing waits for the start to settle: the stop is asked for there and then.
    expect(signals[0].aborted).toBe(true);
    // The next frame gets a browser of its own, with a signal of its own.
    const next = source.frame(2, 100);
    await vi.advanceTimersByTimeAsync(0);
    expect(signals[1].aborted).toBe(false);
    second.pending[0].resolve(Buffer.from('ok'));
    expect((await next).toString()).toBe('ok');
    await source.close();
    expect(second.state.closed).toBe(1);
    expect(signals[1].aborted).toBe(false);
  });

  it('close returns when the browser never finishes starting', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const open = vi.fn((_dir: string, s: AbortSignal) => {
      signal = s;
      return new Promise<TalkieBrowser>(() => {});
    });
    const source = talkieFrameSource('/film', SIZE, { open, frameTimeoutMs: 1000 });
    const outcome = source.frame(1, 100).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(0);
    let closed = false;
    const closing = source.close().then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(1000);
    await closing;
    expect(closed).toBe(true);
    expect(signal?.aborted).toBe(true);
    expect(await outcome).toBeInstanceOf(Error);
  });

  it('does not reuse a browser after a render failed', async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    const open = vi.fn().mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    const source = talkieFrameSource('/film', SIZE, { open });
    const bad = source.frame(1, 100);
    await tick();
    first.pending[0].reject(new Error('scene s01 could not be drawn'));
    await expect(bad).rejects.toThrow('scene s01 could not be drawn');
    expect(first.state.killed).toBe(1);
    const good = source.frame(1, 100);
    await tick();
    second.pending[0].resolve(Buffer.from('ok'));
    await good;
    expect(open).toHaveBeenCalledTimes(2);
    await source.close();
  });

  it('closes the browser after the idle time, and starts again when needed', async () => {
    vi.useFakeTimers();
    const first = fakeBrowser();
    const second = fakeBrowser();
    const open = vi.fn().mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
    const source = talkieFrameSource('/film', SIZE, { open, idleMs: 120_000 });
    const a = source.frame(1, 100);
    await vi.advanceTimersByTimeAsync(0);
    first.pending[0].resolve(Buffer.from('a'));
    await a;
    await vi.advanceTimersByTimeAsync(119_999);
    expect(first.state.closed).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(first.state.closed).toBe(1);
    const b = source.frame(2, 100);
    await vi.advanceTimersByTimeAsync(0);
    second.pending[0].resolve(Buffer.from('b'));
    await b;
    expect(open).toHaveBeenCalledTimes(2);
    await source.close();
  });

  it('does not count a busy browser as idle', async () => {
    vi.useFakeTimers();
    const fake = fakeBrowser();
    const source = talkieFrameSource('/film', SIZE, {
      open: async () => fake.browser,
      idleMs: 1000,
      frameTimeoutMs: 60_000,
    });
    const a = source.frame(1, 100);
    await vi.advanceTimersByTimeAsync(0);
    fake.pending[0].resolve(Buffer.from('a'));
    await a;
    await vi.advanceTimersByTimeAsync(900);
    const b = source.frame(2, 100); // 5 s of work, started just before the idle time
    await vi.advanceTimersByTimeAsync(5000);
    expect(fake.state.closed).toBe(0);
    fake.pending[1].resolve(Buffer.from('b'));
    await b;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fake.state.closed).toBe(1);
    await source.close();
    expect(fake.state.closed).toBe(1);
  });

  it('close is safe to call twice, waits for the frame in hand and refuses later frames', async () => {
    const fake = fakeBrowser();
    const source = talkieFrameSource('/film', SIZE, { open: async () => fake.browser });
    const inHand = source.frame(1, 100);
    const queued = source.frame(2, 100);
    const queuedOutcome = queued.catch((e: Error) => e);
    await tick();
    const closing = source.close();
    await tick();
    expect(fake.state.closed).toBe(0);
    fake.pending[0].resolve(Buffer.from('a'));
    expect((await inHand).toString()).toBe('a');
    await closing;
    expect(((await queuedOutcome) as Error).message).toMatch(/closed/);
    expect(fake.state.closed).toBe(1);
    await source.close();
    expect(fake.state.closed).toBe(1);
    expect(fake.calls).toHaveLength(1);
    await expect(source.frame(3, 100)).rejects.toThrow(/closed/);
  });

  it('says Chromium is not installed when it is missing', async () => {
    const source = talkieFrameSource('/film', SIZE, {
      open: async () => {
        throw new ChromiumMissingError();
      },
    });
    await expect(source.frame(1, 100)).rejects.toThrow(copy.admin.chromiumMissing);
    await source.close();
  });

  it("maps Playwright's own missing-browser error to the same message", async () => {
    const source = talkieFrameSource('/film', SIZE, {
      open: async () => {
        throw new Error(
          "browserType.launch: Executable doesn't exist at /home/x/.cache/ms-playwright/chromium-1/chrome"
        );
      },
    });
    await expect(source.frame(1, 100)).rejects.toThrow(copy.admin.chromiumMissing);
    await source.close();
  });

  it('passes other start-up failures on as they are, and tries again next time', async () => {
    const fake = fakeBrowser();
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('The Talkie render page is not built'))
      .mockResolvedValueOnce(fake.browser);
    const source = talkieFrameSource('/film', SIZE, { open });
    await expect(source.frame(1, 100)).rejects.toThrow('The Talkie render page is not built');
    const again = source.frame(1, 100);
    await tick();
    fake.pending[0].resolve(Buffer.from('ok'));
    await again;
    await source.close();
  });
});

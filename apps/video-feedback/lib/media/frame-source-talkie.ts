import { TALKIE_BROWSER_IDLE_MS, TALKIE_FRAME_TIMEOUT_MS } from '@/lib/constants';
import { copy } from '@/lib/review/copy';
import type { FrameSource } from './frame-source';

/**
 * The widest picture one call may draw. A 2.5x zoom crop of a 1920 still asks for 4800; this
 * leaves room above that while keeping one canvas well under 200 MB on the 9 GB host.
 */
export const TALKIE_MAX_RENDER_WIDTH = 7680;

/** What the frame source needs from a headless browser that has the film open. */
export interface TalkieBrowser {
  /** PNG of the film at time `vt` (seconds), drawn at exactly `width` by `height` pixels. */
  render(vt: number, width: number, height: number): Promise<Buffer>;
  /** Stops the browser at once. Used when it hangs or a render fails. Never rejects. */
  kill(): Promise<void>;
  /** Closes the browser and its local server in the normal way. Never rejects. */
  close(): Promise<void>;
}

export type OpenTalkieBrowser = (filmDir: string) => Promise<TalkieBrowser>;

export interface TalkieFrameSourceOptions {
  /** Starts the browser. The default is headless Chromium at low priority. */
  open?: OpenTalkieBrowser;
  frameTimeoutMs?: number;
  idleMs?: number;
}

/** Thrown when there is no Chromium for `playwright-core` on this machine. */
export class ChromiumMissingError extends Error {
  constructor() {
    super(copy.admin.chromiumMissing);
    this.name = 'ChromiumMissingError';
  }
}

function isChromiumMissing(e: unknown): boolean {
  if (e instanceof ChromiumMissingError) return true;
  return e instanceof Error && /Executable doesn't exist/i.test(e.message);
}

// Imported only when the first frame is asked for, so nothing loads playwright-core until then.
const openChromium: OpenTalkieBrowser = async (filmDir) => {
  const { openTalkieBrowser } = await import('./talkie-browser');
  return openTalkieBrowser(filmDir);
};

/**
 * Frames of a Talkie film (the unpacked folder `filmDir`), drawn by one headless browser.
 *
 * The browser starts on the first call. Calls run one at a time, in order. Each has a time
 * limit that covers starting the browser and drawing; when it passes, the browser is killed and
 * the call fails, and the next call starts a new browser. The browser is closed after `idleMs`
 * without work and by `close()`.
 */
export function talkieFrameSource(
  filmDir: string,
  size: { width: number; height: number },
  opts: TalkieFrameSourceOptions = {}
): FrameSource {
  const open = opts.open ?? openChromium;
  const frameTimeoutMs = opts.frameTimeoutMs ?? TALKIE_FRAME_TIMEOUT_MS;
  const idleMs = opts.idleMs ?? TALKIE_BROWSER_IDLE_MS;

  let browser: Promise<TalkieBrowser> | null = null;
  let tail: Promise<unknown> = Promise.resolve();
  let idle: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  const closeBrowser = async (): Promise<void> => {
    const current = browser;
    browser = null;
    if (!current) return;
    await current.then(
      (b) => b.close(),
      () => {}
    );
  };

  const one = async (vt: number, width: number, height: number): Promise<Buffer> => {
    if (closed) throw new Error('The Talkie frame source is closed.');
    clearTimeout(idle);
    browser ??= open(filmDir);
    const current = browser;
    let abandoned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `The Talkie still passed its time limit of ${Math.round(frameTimeoutMs / 1000)}s and the browser was stopped.`
          )
        );
      }, frameTimeoutMs);
    });
    const drawn = current.then((b) => {
      if (abandoned) throw new Error('The Talkie still was abandoned.');
      return b.render(vt, width, height);
    });
    drawn.catch(() => {}); // the race below reports it; this only stops an unhandled rejection
    try {
      return await Promise.race([drawn, expired]);
    } catch (e) {
      // Whatever went wrong, this browser is not used again. It may still be starting, so the
      // kill is not awaited: it runs as soon as there is something to kill.
      abandoned = true;
      if (browser === current) browser = null;
      void current.then(
        (b) => b.kill(),
        () => {}
      );
      throw isChromiumMissing(e) ? new ChromiumMissingError() : e;
    } finally {
      clearTimeout(timer);
      if (!closed && browser) {
        idle = setTimeout(() => {
          void closeBrowser();
        }, idleMs);
        idle.unref?.();
      }
    }
  };

  return {
    frame(vt, maxWidth) {
      const width = Math.max(1, Math.min(TALKIE_MAX_RENDER_WIDTH, Math.floor(maxWidth)));
      const height = Math.max(1, Math.round((width * size.height) / size.width));
      const run = tail.then(() => one(vt, width, height));
      tail = run.catch(() => {});
      return run;
    },
    async close() {
      closed = true;
      clearTimeout(idle);
      // The frame in hand finishes (or passes its limit) first; frames behind it are refused.
      await tail;
      await closeBrowser();
    },
  };
}

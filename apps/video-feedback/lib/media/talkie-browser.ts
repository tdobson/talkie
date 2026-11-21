import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, chromium } from 'playwright-core';
import { ChromiumMissingError, type TalkieBrowser } from './frame-source-talkie';
import { serveRenderPage } from './talkie-render-server';

// The real browser behind `talkieFrameSource`: headless Chromium from playwright-core, started
// at nice 19 and IO level 7, showing the render page for one film.

const LAUNCH_TIMEOUT_MS = 30_000;
/** How long a normal close may take before the process is killed instead. */
const CLOSE_GRACE_MS = 5_000;

/**
 * The built render page (see `talkie-render-page/build.ts`). The server runs from the app
 * folder in development and from `.next/standalone/apps/video-feedback` in production, so a
 * deployment either copies `dist` to the same relative path or sets `TALKIE_RENDER_PAGE_DIR`.
 */
export function renderPageDir(): string {
  return (
    process.env.TALKIE_RENDER_PAGE_DIR ??
    join(process.cwd(), 'lib', 'media', 'talkie-render-page', 'dist')
  );
}

/** The Chromium to run: `TALKIE_CHROMIUM_PATH`, or the one installed for playwright-core. */
export function chromiumPath(): string {
  return process.env.TALKIE_CHROMIUM_PATH || chromium.executablePath();
}

export interface OpenTalkieBrowserOptions {
  pageDir?: string;
  executablePath?: string;
}

export interface ChromiumTalkieBrowser extends TalkieBrowser {
  /** The Chromium process, when the browser reported it. Tests check its priority. */
  pid: number | null;
}

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });

async function browserPid(browser: Browser): Promise<number | null> {
  try {
    const session = await browser.newBrowserCDPSession();
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    await session.detach();
    return processInfo.find((p) => p.type === 'browser')?.id ?? null;
  } catch {
    return null;
  }
}

/** SIGKILL to the browser and, as playwright-core starts it in a group of its own, its helpers. */
function killProcess(pid: number | null): void {
  if (pid === null) return;
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, 'SIGKILL');
    } catch {
      // already gone, or not a group leader
    }
  }
}

/**
 * Starts Chromium and opens the film in `filmDir` on the render page. The caller owns the
 * result and must `close()` or `kill()` it: both also stop the local server.
 */
export async function openTalkieBrowser(
  filmDir: string,
  opts: OpenTalkieBrowserOptions = {}
): Promise<ChromiumTalkieBrowser> {
  const executable = opts.executablePath ?? chromiumPath();
  if (!existsSync(executable)) throw new ChromiumMissingError();
  const pageDir = opts.pageDir ?? renderPageDir();

  const server = await serveRenderPage(filmDir, pageDir);
  let browser: Browser | null = null;
  let pid: number | null = null;
  let done = false;

  const stop = async (how: 'close' | 'kill'): Promise<void> => {
    if (done) return;
    done = true;
    const b = browser;
    if (b) {
      if (how === 'kill') killProcess(pid);
      const closed = b.close().then(
        () => true,
        () => true
      );
      // A browser that does not answer is killed: nothing is left running either way.
      if (!(await Promise.race([closed, wait(CLOSE_GRACE_MS).then(() => false)]))) {
        killProcess(pid);
        await Promise.race([closed, wait(CLOSE_GRACE_MS)]);
      }
    }
    await server.close();
  };

  try {
    browser = await chromium.launch({
      // The wrapper execs ionice, nice and then Chromium, so this is still one process.
      executablePath: join(pageDir, 'chromium-lowprio.sh'),
      env: { ...process.env, TALKIE_CHROMIUM_BIN: executable } as Record<string, string>,
      headless: true,
      timeout: LAUNCH_TIMEOUT_MS,
      args: [
        '--disable-gpu',
        '--mute-audio',
        // One renderer and no /dev/shm use: the host has 2 cores and little shared memory.
        '--renderer-process-limit=1',
        '--disable-dev-shm-usage',
      ],
    });
    pid = await browserPid(browser);

    const context = await browser.newContext({
      viewport: { width: 320, height: 180 },
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
    });
    // A film is data from outside: nothing in it may make the server fetch another address.
    await context.route('**/*', (route) =>
      route.request().url().startsWith(server.url) ? route.continue() : route.abort()
    );
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(server.url, { timeout: LAUNCH_TIMEOUT_MS });
    const problem = await page.evaluate(
      () => window.talkieReady ?? 'the render page did not start'
    );
    if (problem !== null) {
      const detail = pageErrors.length > 0 ? ` (${pageErrors.join('; ')})` : '';
      throw new Error(`The film could not be opened for stills: ${problem}${detail}`);
    }

    return {
      get pid() {
        return pid;
      },
      async render(vt, width, height) {
        await page.setViewportSize({ width, height });
        await page.evaluate(
          ([t, w, h]) => {
            if (!window.renderAt) throw new Error('the render page did not start');
            return window.renderAt(t, w, h);
          },
          [vt, width, height] as const
        );
        return page.locator('#stage').screenshot({ type: 'png', scale: 'css' });
      },
      kill: () => stop('kill'),
      close: () => stop('close'),
    };
  } catch (e) {
    await stop('kill');
    throw e;
  }
}

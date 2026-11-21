import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test as base, expect, type Locator, type Page } from '@playwright/test';
import type { TalkieFilm } from '@talkie/format';
import type { TalkiePlayerElement } from '../packages/player/src/element';
import { FILM_DIR, startServer, WASM_FILE, type StaticServer } from './serve';
import { silence } from './silence';

// The standalone page, examples/watch.html, played in every Playwright project.
//
// Build first, from the repo root: yarn build && yarn sample

const test = base.extend<object, { site: StaticServer }>({
  site: [
    // Playwright reads the fixture's needs from this pattern, so it has to be written this way.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const site = await startServer();
      await use(site);
      await site.close();
    },
    { scope: 'worker' },
  ],
});

const film = JSON.parse(readFileSync(join(FILM_DIR, 'talkie.json'), 'utf8')) as TalkieFilm;

type Ready = 'ready' | 'loading' | `error:${string}`;

const player = (page: Page): Locator => page.locator('talkie-player');
const part = (page: Page, selector: string): Locator => player(page).locator(selector);

const currentTime = (page: Page): Promise<number> =>
  player(page).evaluate((el: TalkiePlayerElement) => el.currentTime);

const paused = (page: Page): Promise<boolean> =>
  player(page).evaluate((el: TalkiePlayerElement) => el.paused);

const seek = (page: Page, time: number): Promise<void> =>
  player(page).evaluate((el: TalkiePlayerElement, t) => {
    el.currentTime = t;
  }, time);

/** What the player is showing: still loading, ready to play, or an error panel with its code. */
const readiness = (page: Page): Promise<Ready> =>
  player(page).evaluate((el: TalkiePlayerElement): Ready => {
    const root = el.shadowRoot!;
    const error = root.querySelector<HTMLElement>('.error')!;
    if (!error.hidden) {
      return `error:${error.dataset.code ?? ''}`;
    }
    const spinner = root.querySelector<HTMLElement>('.spinner')!;
    return Number.isFinite(el.duration) && spinner.hidden ? 'ready' : 'loading';
  });

/**
 * Open watch.html and wait for the film to load. The page is served as it is in the repo. The
 * drawing engine's .wasm, which the page takes from a public CDN, is answered from node_modules
 * so the tests need no internet.
 */
async function open(
  page: Page,
  site: StaticServer,
  opts: { debug?: boolean } = {}
): Promise<Ready> {
  await page.route(/^https:\/\/(cdn\.jsdelivr\.net|unpkg\.com)\/.*\.wasm$/, (route) =>
    route.fulfill({ path: WASM_FILE, contentType: 'application/wasm' })
  );
  await silence(page);
  await page.goto(`${site.url}/watch.html`);
  if (opts.debug) {
    // The element reads "debug" when it joins the page, so take it out and put it back.
    await player(page).evaluate((el) => {
      const parent = el.parentElement!;
      el.remove();
      el.setAttribute('debug', '');
      parent.append(el);
    });
  }
  let state: Ready = 'loading';
  await expect
    .poll(async () => (state = await readiness(page)), { timeout: 20_000 })
    .not.toBe('loading');
  return state;
}

/** Open the page and expect a film that can play. */
async function openReady(page: Page, site: StaticServer, opts: { debug?: boolean } = {}) {
  expect(await open(page, site, opts)).toBe('ready');
}

/** Press the big play button and wait until the film is moving. */
async function start(page: Page): Promise<void> {
  await part(page, '.big-play').click();
  await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(0.1);
}

/** Pause, and wait for the last frame of playback to be drawn. */
async function pause(page: Page): Promise<void> {
  await player(page).evaluate((el: TalkiePlayerElement) => el.pause());
  await expect.poll(() => paused(page)).toBe(true);
  await page.waitForTimeout(300);
}

test('shows the poster and the play button before the first play', async ({ page, site }) => {
  await openReady(page, site);
  await expect(part(page, '.poster')).toBeVisible();
  await expect(part(page, '.poster')).toHaveAttribute('src', /\/film\/poster\.png$/);
  await expect(part(page, '.big-play')).toBeVisible();
  expect(await paused(page)).toBe(true);
  expect(await player(page).evaluate((el: TalkiePlayerElement) => el.duration)).toBeCloseTo(
    film.duration,
    3
  );
});

test('plays after a click on the play button', async ({ page, site }) => {
  await openReady(page, site);
  await part(page, '.big-play').click();
  await expect.poll(() => currentTime(page), { timeout: 5000 }).toBeGreaterThan(1);
  await expect(part(page, '.poster')).toBeHidden();
  await expect(part(page, '.big-play')).toBeHidden();
  expect(await paused(page)).toBe(false);
});

test('pause holds the frame', async ({ page, site }) => {
  await openReady(page, site);
  await start(page);
  await expect.poll(() => currentTime(page)).toBeGreaterThan(2);
  await pause(page);
  const time = await currentTime(page);
  const first = await player(page).screenshot();
  await page.waitForTimeout(700);
  const second = await player(page).screenshot();
  expect(second.equals(first)).toBe(true);
  expect(await currentTime(page)).toBe(time);
});

test('the l key seeks forward 10 seconds', async ({ page, site }) => {
  await openReady(page, site);
  await start(page);
  await pause(page);
  const before = await currentTime(page);
  await player(page).focus();
  await page.keyboard.press('l');
  await expect.poll(() => currentTime(page)).toBeGreaterThan(before + 9.9);
  expect(await currentTime(page)).toBeLessThan(before + 10.1);
});

test('a click on the scrub bar lands within half a second of the target', async ({
  page,
  site,
}) => {
  await openReady(page, site);
  await start(page);
  await pause(page);
  const scrubber = part(page, '.scrubber');
  const box = (await scrubber.boundingBox())!;
  const fraction = 0.6;
  const target = fraction * film.duration;
  await scrubber.click({ position: { x: box.width * fraction, y: box.height / 2 } });
  await expect.poll(async () => Math.abs((await currentTime(page)) - target)).toBeLessThan(0.5);
});

test('speed 1.5 sets the playback rate', async ({ page, site }) => {
  await openReady(page, site);
  await start(page);
  await pause(page);
  await part(page, '.settings').click();
  await expect(part(page, '.settings-menu')).toBeVisible();
  await part(page, '.settings-menu button[data-value="1.5"]').click();
  await expect(part(page, '.settings-menu')).toBeHidden();
  expect(await player(page).evaluate((el: TalkiePlayerElement) => el.playbackRate)).toBe(1.5);
  await expect(part(page, '.settings-menu button[data-value="1.5"]')).toHaveAttribute(
    'aria-checked',
    'true'
  );

  // The rate is real: 2 s of wall time moves the film by about 3 s.
  await part(page, '.play').click();
  const from = await currentTime(page);
  await page.waitForTimeout(2000);
  const moved = (await currentTime(page)) - from;
  expect(moved).toBeGreaterThan(2.4);
  expect(moved).toBeLessThan(3.6);
});

test('the c key toggles a caption plate with text', async ({ page, site }) => {
  await openReady(page, site);
  await start(page);
  await pause(page);
  // 3 s is inside the first caption, which runs from 1.4 s to 7.8 s.
  await seek(page, 3);
  await expect(part(page, '.captions')).toBeHidden();
  await player(page).focus();
  await page.keyboard.press('c');
  await expect(part(page, '.captions')).toBeVisible();
  await expect(part(page, '.plate')).toHaveText(/bare rafters/);
  await expect(part(page, '.captions-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('c');
  await expect(part(page, '.captions')).toBeHidden();
});

test('the chapter menu jumps to chapter 2', async ({ page, site }) => {
  await openReady(page, site);
  await start(page);
  await pause(page);
  const chapter = film.chapters[1]!;
  await part(page, '.chapters').click();
  const items = part(page, '.chapters-menu button');
  await expect(items).toHaveCount(film.chapters.length);
  await expect(items.nth(1)).toContainText(chapter.title);
  await items.nth(1).click();
  await expect
    .poll(async () => Math.abs((await currentTime(page)) - chapter.start))
    .toBeLessThan(0.1);
  await expect(items.nth(1)).toHaveAttribute('aria-checked', 'true');
});

test('a scene that will not load shows the poster while the film carries on', async ({
  page,
  site,
}) => {
  const scene = film.scenes[1]!;
  await page.route(`**/film/${scene.src}`, (route) =>
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
  );
  await openReady(page, site);
  await start(page);
  await expect(part(page, '.poster')).toBeHidden();

  // Into the broken scene: the poster covers it and the sound keeps going.
  await seek(page, scene.start + 1);
  await expect(part(page, '.poster')).toBeVisible();
  await expect(part(page, '.error')).toBeHidden();
  const from = await currentTime(page);
  await expect.poll(() => currentTime(page), { timeout: 5000 }).toBeGreaterThan(from + 1);
  expect(await paused(page)).toBe(false);
  await expect(part(page, '.poster')).toBeVisible();

  // Past it: the picture is back.
  await seek(page, scene.end + 1);
  await expect(part(page, '.poster')).toBeHidden();
  await expect.poll(() => currentTime(page), { timeout: 5000 }).toBeGreaterThan(scene.end + 2);
});

test('with every film request failing, the retry panel shows and retry loads the film', async ({
  page,
  site,
}) => {
  await page.route('**/film/**', (route) => route.abort('internetdisconnected'));
  expect(await open(page, site)).toBe('error:network');
  await expect(part(page, '.error-text')).toContainText('Check your connection');
  await expect(part(page, '.retry')).toBeVisible();
  await expect(part(page, '.big-play')).toBeHidden();

  await page.unroute('**/film/**');
  await part(page, '.retry').click();
  await expect.poll(() => readiness(page), { timeout: 20_000 }).toBe('ready');
  await expect(part(page, '.error')).toBeHidden();
  await part(page, '.big-play').click();
  await expect.poll(() => currentTime(page), { timeout: 5000 }).toBeGreaterThan(1);
});

test('the Try again button is clear of the control bar', async ({ page, site }) => {
  await page.route('**/film/**', (route) => route.abort('internetdisconnected'));
  expect(await open(page, site)).toBe('error:network');
  await expect(part(page, '.retry')).toBeVisible();
  const hit = await player(page).evaluate((el: TalkiePlayerElement) => {
    const root = el.shadowRoot!;
    const box = root.querySelector('.retry')!.getBoundingClientRect();
    const at = root.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return at?.className ?? '';
  });
  expect(hit).toBe('retry');
});

test('a connection lost part way through shows the retry panel, and retry resumes', async ({
  page,
  browserName,
}) => {
  // Playwright's WebKit on Linux plays sound through GStreamer, which treats a stream that is
  // cut short as the end of the film: it jumps to the end and sends no error. That is not
  // Safari's media stack, so this case can only be checked on a real iPhone or Mac.
  test.skip(browserName === 'webkit', 'GStreamer ends a cut stream without an error');
  // Chromium tries the sound again for about 30 s before it gives up.
  test.setTimeout(150_000);

  // A slow link, so most of the sound is still to come when the connection goes.
  const slow = await startServer({ audioBytesPerSecond: 16_000 });
  try {
    expect(await open(page, slow)).toBe('ready');
    await start(page);
    await expect.poll(() => currentTime(page), { timeout: 10_000 }).toBeGreaterThan(1);

    slow.down();
    await expect(part(page, '.error')).toBeVisible({ timeout: 90_000 });
    await expect(part(page, '.error')).toHaveAttribute('data-code', 'network');
    await expect(part(page, '.retry')).toBeVisible();
    const stopped = await currentTime(page);
    expect(stopped).toBeGreaterThan(1);
    expect(stopped).toBeLessThan(film.duration - 5);

    slow.up();
    await part(page, '.retry').click();
    await expect(part(page, '.error')).toBeHidden();
    // It carries on from where it stopped, not from the start.
    await expect.poll(() => currentTime(page), { timeout: 30_000 }).toBeGreaterThan(stopped + 1);
    expect(await currentTime(page)).toBeLessThan(stopped + 15);
    expect(await paused(page)).toBe(false);
    await expect(part(page, '.error')).toBeHidden();
  } finally {
    await slow.close();
  }
});

test('the picture stays in step with the sound', async ({ page, site }, testInfo) => {
  test.setTimeout(90_000);
  await openReady(page, site, { debug: true });
  type Probe = TalkiePlayerElement & { frames: Array<[number, number]> };
  await player(page).evaluate((el: Probe) => {
    el.frames = [];
    el.addEventListener('frame', (event) => {
      const { filmTime, audioTime } = (
        event as CustomEvent<{ filmTime: number; audioTime: number }>
      ).detail;
      el.frames.push([filmTime, audioTime]);
    });
  });
  await part(page, '.big-play').click();
  // Every frame from the press of play counts, the start of the sound output included: the
  // picture must not run ahead while the browser is still starting its sound.
  const seconds = 10;
  await expect.poll(() => currentTime(page), { timeout: 40_000 }).toBeGreaterThanOrEqual(seconds);
  const frames = await player(page).evaluate((el: Probe) => el.frames);

  const stats = (from: number, to: number) => {
    const drift = frames
      .filter(([, audioTime]) => audioTime >= from && audioTime < to)
      .map(([filmTime, audioTime]) => Math.abs(filmTime - audioTime))
      .sort((a, b) => a - b);
    return {
      frames: drift.length,
      p99: drift[Math.ceil(drift.length * 0.99) - 1] ?? 0,
      max: drift[drift.length - 1] ?? 0,
    };
  };
  const all = stats(0, seconds);
  // Printed only, to show where the drift is. The limits below apply to the whole run.
  const startUp = stats(0, 1);
  const ms = (s: number) => `${(s * 1000).toFixed(1)} ms`;
  const report =
    `sync ${testInfo.project.name}: ${all.frames} frames over ${seconds} s from play, ` +
    `p99 ${ms(all.p99)}, max ${ms(all.max)}; ` +
    `first second: ${startUp.frames} frames, p99 ${ms(startUp.p99)}, max ${ms(startUp.max)}`;
  await testInfo.attach('sync', { contentType: 'text/plain', body: report });
  process.stdout.write(`${report}\n`);

  // Firefox moves currentTime in 40.2 ms steps, so the clock's own running on between steps
  // counts as drift on this measure. See spike/REPORT.md, "Clock probe on a quiet machine".
  const limit = testInfo.project.name === 'firefox' ? 0.07 : 0.04;
  expect(all.frames).toBeGreaterThan(100);
  expect(all.p99).toBeLessThanOrEqual(limit);
  // 0.25 is the clock's cap. Reaching it means the sound stalled.
  expect(all.max).toBeLessThan(0.25);
});

test.describe('paused frames', () => {
  for (const time of [5, 20, 40]) {
    test(`looks right at ${time} s`, async ({ page, site }, testInfo) => {
      test.skip(testInfo.project.name !== 'chromium', 'screenshots are compared in chromium only');
      await openReady(page, site);
      await start(page);
      await pause(page);
      await seek(page, time);
      await expect.poll(() => currentTime(page)).toBe(time);
      await page.mouse.move(0, 0);
      await expect(player(page)).toHaveScreenshot(`paused-${String(time).padStart(2, '0')}s.png`, {
        maxDiffPixelRatio: 0.002,
      });
    });
  }
});

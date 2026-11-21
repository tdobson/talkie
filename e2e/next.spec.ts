import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import type { TalkieFilm } from '@talkie/format';
import type { TalkiePlayerElement } from '../packages/player/src/element';
import { FILM_DIR, REPO } from './serve';

// The Next.js and Mantine example: a production build, started on a free port.
//
// Build first, from the repo root: yarn build && yarn sample

const run = promisify(execFile);
const WORKSPACE = '@talkie/example-next-mantine';

// One build and one server for the file, whichever order the tests run in.
test.describe.configure({ mode: 'serial' });

let app: ChildProcess | null = null;
let url = '';
let log = '';

/** A port nothing is listening on, found by asking the system for one and letting it go. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });
}

async function answers(address: string): Promise<boolean> {
  try {
    return (await fetch(address)).ok;
  } catch {
    return false;
  }
}

// eslint-disable-next-line no-empty-pattern
test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== 'chromium') {
    return;
  }
  test.setTimeout(900_000);
  // The yarn scripts run next through scripts/low, so the build stays at low priority.
  await run('yarn', ['workspace', WORKSPACE, 'build'], { cwd: REPO, maxBuffer: 64 * 1024 * 1024 });

  const port = await freePort();
  url = `http://127.0.0.1:${port}`;
  // Its own process group, so the whole tree (yarn, nice, next) can be stopped together.
  app = spawn(
    'yarn',
    ['workspace', WORKSPACE, 'start', '--hostname', '127.0.0.1', '--port', String(port)],
    { cwd: REPO, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  app.stdout?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  app.stderr?.on('data', (chunk: Buffer) => (log += chunk.toString()));
  try {
    await expect.poll(() => answers(`${url}/watch`), { timeout: 120_000 }).toBe(true);
  } catch {
    throw new Error(`The Next.js app did not start on ${url}. Its output:\n${log}`);
  }
});

test.afterAll(() => {
  if (app?.pid !== undefined) {
    try {
      process.kill(-app.pid, 'SIGTERM');
    } catch {
      // It had already stopped.
    }
  }
  app = null;
});

test('/watch shows the film title and plays, with a clean console', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'the Next.js example is checked in chromium');
  const film = JSON.parse(readFileSync(join(FILM_DIR, 'talkie.json'), 'utf8')) as TalkieFilm;

  const errors: string[] = [];
  const hydration: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/hydrat/i.test(text)) {
      hydration.push(text);
    }
    if (message.type() === 'error') {
      errors.push(text);
    }
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  const failed: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failed.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(`${url}/watch`);

  // The title is a Mantine Title, drawn on the server from the film's talkie.json.
  const title = page.getByRole('heading', { level: 1, name: film.title });
  await expect(title).toBeVisible();
  await expect(title).toHaveClass(/mantine-Title-root/);
  for (const chapter of film.chapters) {
    await expect(page.getByRole('listitem').filter({ hasText: chapter.title })).toBeVisible();
  }

  const player = page.locator('talkie-player');
  const currentTime = () => player.evaluate((el: TalkiePlayerElement) => el.currentTime);
  await expect(player.locator('.big-play')).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => player.evaluate((el: TalkiePlayerElement) => el.duration), { timeout: 20_000 })
    .toBeCloseTo(film.duration, 3);
  await player.locator('.big-play').click();
  await expect.poll(currentTime, { timeout: 5000 }).toBeGreaterThan(1);
  await expect(player.locator('.poster')).toBeHidden();
  await expect(player.locator('.error')).toBeHidden();

  expect(hydration).toEqual([]);
  expect(errors).toEqual([]);
  expect(failed).toEqual([]);
});

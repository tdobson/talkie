import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { devices, expect, test } from '@playwright/test';
import { cliImport, parseImport, uniqueCopy } from './global-setup';
import {
  doPractice,
  giveComment,
  readSessionComments,
  startReview,
  state,
  T,
  waitForState,
} from './helpers';

test('invalid token shows the friendly page with 404', async ({ page }) => {
  const response = await page.goto('/r/not-a-real-token-at-all');
  expect(response?.status()).toBe(404);
  await expect(page.getByTestId(T.invalidLink)).toBeVisible();
  await expect(page.getByTestId(T.welcome)).toHaveCount(0);
});

test('mobile devices get the computer notice', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  await page.goto(state().reviewUrl);
  await expect(page.getByTestId(T.mobileBlock)).toBeVisible();
  await expect(page.getByTestId(T.player)).toHaveCount(0);
  await expect(page.getByTestId(T.welcome)).toHaveCount(0);
  await context.close();
});

test('denied microphone shows recovery steps @nomic', async ({ page }) => {
  await page.goto(state().reviewUrl);
  await page.getByTestId(T.nameInput).fill('Dee Denied');
  await page.getByTestId(T.startButton).click();
  await page.getByTestId(T.micContinue).click();
  await expect(page.getByTestId(T.micDenied)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(T.micRetry)).toBeVisible();
  await expect(page.getByTestId(T.player)).toHaveCount(0);
});

test('silent pause is stored but marked empty @silence', async ({ page }) => {
  await page.goto(state().reviewUrl);
  await page.getByTestId(T.nameInput).fill('Sid Silent');
  await page.getByTestId(T.startButton).click();
  await page.getByTestId(T.micContinue).click();
  // The fake mic says hello, so the check passes, and is silent from then on.
  await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(T.micMeter)).toHaveAttribute('data-lit', '0');
  await expect(page.getByTestId(T.player)).toBeVisible();
  // The practice pause never hears anything, so the reviewer presses play to carry on.
  await doPractice(page, { talk: false });
  await giveComment(page);
  await expect.poll(async () => (await readSessionComments('Sid Silent')).length).toBe(1);
  const [comment] = await readSessionComments('Sid Silent');
  const done = await waitForState(comment.ref, 'empty');
  expect(done.files.some((f) => /^chunks?\//.test(f) || /^audio\./.test(f))).toBe(true);
});

test('a new version mid-session keeps the session on its version', async ({ page, browser }) => {
  const created = parseImport(
    cliImport(uniqueCopy('h264.mp4', 'e2e-versions'), { title: 'E2E versions' })
  );
  const v2 = parseImport(
    cliImport(uniqueCopy('h264.mp4', 'e2e-versions'), { video: created.videoId })
  );
  expect(v2.version).toBe(2);

  await startReview(page, 'Vera Version', created.reviewUrl);
  await giveComment(page);
  const v3 = parseImport(
    cliImport(uniqueCopy('h264.mp4', 'e2e-versions'), { video: created.videoId })
  );
  expect(v3.version).toBe(3);
  // The four-second video plays on after the first comment and ends while v3 is imported, or
  // soon after: carry on from the end screen, which plays it again from the start.
  await expect(page.getByTestId(T.endScreen)).toBeVisible({ timeout: 10_000 });
  await giveComment(page);

  const sessionFile = (name: string) => {
    const dir = join(state().dataDir, 'videos', created.videoId, 'sessions');
    return readdirSync(dir)
      .map((sid) => JSON.parse(readFileSync(join(dir, sid, 'session.json'), 'utf8')))
      .find((s: { reviewerName: string }) => s.reviewerName === name) as { version: number };
  };
  expect(sessionFile('Vera Version').version).toBe(2);
  const comments = await readSessionComments('Vera Version');
  expect(comments.map((c) => c.meta.version)).toEqual([2, 2]);

  const other = await browser.newContext({ permissions: ['microphone'] });
  const page2 = await other.newPage();
  await startReview(page2, 'Newt Newer', created.reviewUrl);
  await expect.poll(() => sessionFile('Newt Newer')?.version).toBe(3);
  await other.close();
});

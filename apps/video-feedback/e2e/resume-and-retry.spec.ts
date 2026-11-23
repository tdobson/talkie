import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import {
  findSessions,
  giveComment,
  passMicCheck,
  readSessionComments,
  startReview,
  state,
  T,
} from './helpers';

test('a reload mid-review resumes the same session', async ({ page }) => {
  await startReview(page, 'Rita Reload');
  await giveComment(page);
  await page.reload();
  await expect(page.getByTestId(T.nameInput)).toHaveCount(0);
  await passMicCheck(page, { practice: false }); // done once already
  await giveComment(page);
  expect(findSessions('Rita Reload')).toHaveLength(1);
  await expect.poll(async () => (await readSessionComments('Rita Reload')).length).toBe(2);
});

test('a reviewer back after a new version is imported reviews the new one, not the old', async ({
  page,
}) => {
  // This browser reviewed version 1 earlier; version 2 has been imported since.
  const { dataDir, videoId, token, version, reviewUrl } = state();
  expect(version).toBeGreaterThan(1);
  const oldSid = '0e2e0000-0000-4000-8000-00000000c0de';
  const dir = join(dataDir, 'videos', videoId, 'sessions', oldSid);
  mkdirSync(join(dir, 'comments'), { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({
      sessionId: oldSid,
      videoId,
      version: 1,
      reviewerName: 'Nina Newcut',
      userAgent: 'e2e',
      startedAt: '2026-11-20T10:00:00.000Z',
      doneAt: null,
    })
  );
  await page.addInitScript(
    ([key, sid]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, sid);
        sessionStorage.setItem('seeded', '1');
      }
    },
    [`vf:${token}`, oldSid]
  );

  await page.goto(reviewUrl);
  await expect(page.getByTestId(T.newerVersion)).toContainText(`reviewing version ${version}`);
  await expect(page.getByTestId(T.nameInput)).toHaveCount(0);
  await passMicCheck(page, { practice: false }); // they had the practice on version 1
  await expect(page.getByTestId(T.video)).toHaveAttribute('src', new RegExp(`version=${version}`));
  await giveComment(page);

  const sessions = findSessions('Nina Newcut');
  expect(sessions.map((s) => s.version).sort()).toEqual([1, version]);
  await expect.poll(async () => (await readSessionComments('Nina Newcut')).length).toBe(1);
});

test('going offline shows the trouble banner and recovers', async ({ page, context }) => {
  await startReview(page, 'Otto Offline'); // leaves the film playing
  await page.waitForTimeout(800);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.listening)).toBeVisible();
  await context.setOffline(true);
  // NEXT_PUBLIC_E2E_FAST_TIMERS=1 makes the banner show after 2s instead of 20s.
  await page.waitForTimeout(3500);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.saveTroubleBanner)).toBeVisible({ timeout: 15_000 });
  await context.setOffline(false);
  await expect(page.getByTestId(T.savedToast)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId(T.saveTroubleBanner)).toBeHidden();
  await expect
    .poll(async () => {
      const [c] = await readSessionComments('Otto Offline');
      return c?.status?.state;
    })
    .not.toBe('receiving');
  const [comment] = await readSessionComments('Otto Offline');
  expect(comment.meta.totalChunks).toBeGreaterThan(0);
});

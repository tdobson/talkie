import { expect, test } from '@playwright/test';
import {
  findSessions,
  giveComment,
  passMicCheck,
  readSessionComments,
  startReview,
  T,
} from './helpers';

test('a reload mid-review resumes the same session', async ({ page }) => {
  await startReview(page, 'Rita Reload');
  await giveComment(page);
  await page.reload();
  await expect(page.getByTestId(T.nameInput)).toHaveCount(0);
  await passMicCheck(page);
  await giveComment(page);
  expect(findSessions('Rita Reload')).toHaveLength(1);
  await expect.poll(async () => (await readSessionComments('Rita Reload')).length).toBe(2);
});

test('going offline shows the trouble banner and recovers', async ({ page, context }) => {
  await startReview(page, 'Otto Offline');
  await page.getByTestId(T.playPause).click();
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

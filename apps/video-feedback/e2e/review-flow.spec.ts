import { expect, test } from '@playwright/test';
import { passMicCheck, readSessionComments, state, T, waitForState } from './helpers';

test('reviewer gives a moment comment and a general comment', async ({ page }) => {
  await page.goto(state().reviewUrl);
  await expect(page.getByTestId(T.welcome)).toContainText("as if I'm sat right next to you");
  await expect(page.getByTestId(T.startButton)).toBeDisabled();
  await page.getByTestId(T.nameInput).fill('Playwright Pat');
  await page.getByTestId(T.startButton).click();
  await passMicCheck(page); // and the practice run, which leaves the film playing
  await page.waitForTimeout(1200);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.listening)).toBeVisible();
  const stage = await page.getByTestId(T.videoStage).boundingBox();
  if (!stage) throw new Error('no stage box');
  await page.mouse.move(stage.x + stage.width * 0.2, stage.y + stage.height * 0.2, { steps: 10 });
  await page.waitForTimeout(600); // dwell
  await page.mouse.click(stage.x + stage.width * 0.6, stage.y + stage.height * 0.7);
  await expect(page.getByTestId(T.listening)).toBeVisible(); // click did not resume
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.savedToast)).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/\b\d+:\d{2}\b/); // no timecode anywhere
  await page.getByTestId(T.video).evaluate((v: HTMLVideoElement) => {
    v.currentTime = v.duration - 0.1;
    void v.play();
  });
  await expect(page.getByTestId(T.endScreen)).toBeVisible();
  await page.getByTestId(T.shareMore).click();
  await expect(page.getByTestId(T.generalComment)).toContainText('Was there anything missing?');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Space'); // must not end the general comment
  await expect(page.getByTestId(T.generalComment)).toBeVisible();
  await page.getByTestId(T.generalFinished).click();
  await expect(page.getByTestId(T.endScreen)).toBeVisible();
  await page.getByTestId(T.endScreen).getByTestId(T.doneButton).click();
  await expect(page.getByTestId(T.thanks)).toContainText('Thanks, Playwright Pat.');

  // Server side.
  await expect
    .poll(async () => (await readSessionComments('Playwright Pat')).map((c) => c.meta.kind).sort())
    .toEqual(['general', 'moment']);
  const comments = await readSessionComments('Playwright Pat');
  const moment = comments.find((c) => c.meta.kind === 'moment');
  if (!moment) throw new Error('no moment comment');
  const done = await waitForState(moment.ref, 'done');
  expect(done.events.some((e) => e.type === 'click')).toBe(true);
  expect(done.files).toEqual(
    expect.arrayContaining(['render/overview.jpg', 'render/moment-01.jpg'])
  );
});

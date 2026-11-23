import { expect, type Page, test } from '@playwright/test';
import { readSessionComments, startReview, T } from './helpers';

// Leaving the tab mid-comment stops the recording (with a falling sound), and coming back
// starts a new comment on the same frame (with a rising one).

/** What the browser reports when the reviewer switches to another tab or app, and back. */
async function setFocus(page: Page, on: boolean): Promise<void> {
  await page.evaluate((visible) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (visible ? 'visible' : 'hidden'),
    });
    window.dispatchEvent(new Event(visible ? 'focus' : 'blur'));
    document.dispatchEvent(new Event('visibilitychange'));
  }, on);
}

test('losing focus mid-comment stops recording; coming back starts a new comment', async ({
  page,
}) => {
  const name = 'Fran Focus';
  await startReview(page, name); // leaves the film playing
  await page.waitForTimeout(800);
  await page.keyboard.press('Space'); // pause: a comment
  await expect(page.getByTestId(T.listening)).toBeVisible();
  await page.waitForTimeout(1500);

  await setFocus(page, false);
  await expect(page.getByTestId(T.commentHeld)).toContainText('Stopped: this tab lost focus');
  await expect(page.getByTestId(T.listening)).toHaveCount(0);
  await expect(page.getByTestId(T.playPause)).toHaveAttribute('aria-label', 'Play');
  await expect.poll(async () => (await readSessionComments(name)).length).toBe(1);

  await setFocus(page, true);
  await expect(page.getByTestId(T.listening)).toBeVisible();
  await expect(page.getByTestId(T.commentHeld)).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space'); // play: ends the second comment
  await expect.poll(async () => (await readSessionComments(name)).length).toBe(2);
});

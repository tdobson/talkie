import { expect, test } from '@playwright/test';
import { state, T } from './helpers';

test('welcome renders and the video plays and pauses', async ({ page, browserName }) => {
  const { reviewUrl, token } = state();
  await page.goto(reviewUrl);
  await expect(page.getByTestId(T.welcome)).toBeVisible();
  await page.getByTestId(T.nameInput).fill(`Cross ${browserName}`);
  await page.getByTestId(T.startButton).click();
  await expect(page.getByTestId(T.micExplain)).toBeVisible();

  // No microphone needed: load the review video on its own and check it plays and pauses.
  // Same origin as the app, so the token URL is relative.
  await page.goto('/');
  await page.setContent(
    `<video id="v" muted playsinline preload="auto" src="/api/r/${token}/video"></video>`
  );
  const played = await page.evaluate(async () => {
    const v = document.getElementById('v') as HTMLVideoElement;
    await new Promise<void>((resolve, reject) => {
      if (v.readyState >= 2) return resolve();
      v.addEventListener('loadeddata', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error('video error')), { once: true });
    });
    await v.play();
    await new Promise((r) => setTimeout(r, 500));
    v.pause();
    return { time: v.currentTime, paused: v.paused };
  });
  expect(played.paused).toBe(true);
  expect(played.time).toBeGreaterThan(0);
});

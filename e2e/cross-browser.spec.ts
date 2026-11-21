import { expect, test } from '@playwright/test';
import { state, T } from './helpers';

test('welcome renders and the video plays and pauses', async ({ page, browserName }) => {
  const { reviewUrl, token, version } = state();
  await page.goto(reviewUrl);
  await expect(page.getByTestId(T.welcome)).toBeVisible();
  await page.getByTestId(T.nameInput).fill(`Cross ${browserName}`);
  await page.getByTestId(T.startButton).click();
  await expect(page.getByTestId(T.micExplain)).toBeVisible();

  // No microphone needed: load the review video on its own, on the review page itself (same
  // origin), and check it plays and pauses. The video route needs the version. Like the real
  // player it is not muted: typing the name and clicking Start allow sound. (A muted video
  // also stalls at 0 in Linux WebKit once the page has had keyboard focus.)
  const src = `/api/r/${token}/video?version=${version}`;
  const played = await page.evaluate(async (url) => {
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    const loaded = new Promise<void>((resolve, reject) => {
      v.addEventListener('loadeddata', () => resolve(), { once: true });
      v.addEventListener('error', () => reject(new Error(`video error ${v.error?.code}`)), {
        once: true,
      });
    });
    v.src = url;
    document.body.append(v);
    await loaded;
    await v.play();
    await new Promise<void>((resolve) => {
      const check = () => {
        if (v.currentTime <= 0) return;
        v.removeEventListener('timeupdate', check);
        resolve();
      };
      v.addEventListener('timeupdate', check);
      check();
    });
    v.pause();
    return { time: v.currentTime, paused: v.paused };
  }, src);
  expect(played.paused).toBe(true);
  expect(played.time).toBeGreaterThan(0);
});

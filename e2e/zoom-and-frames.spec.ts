import { expect, test } from '@playwright/test';
import { readSessionComments, stageBox, startReview, T, waitForState } from './helpers';

const FRAME = 1 / 25; // h264.mp4 is 25 fps

test('arrow keys step frames only while paused and hold-to-zoom logs zoom events', async ({
  page,
}) => {
  await startReview(page, 'Zoe Zoom');
  const video = page.getByTestId(T.video);
  const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);

  // Play 1s, pause (this opens a comment), step frames.
  await page.getByTestId(T.playPause).click();
  await page.waitForTimeout(1000);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.listening)).toBeVisible();
  const t0 = await time();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
  await expect.poll(time).toBeCloseTo(t0 - 3 * FRAME, 2);
  const t1 = await time();
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(time).toBeCloseTo(t1 + 1, 1);

  // Hold to zoom, pan, release.
  const box = await stageBox(page);
  const stage = page.getByTestId(T.videoStage);
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await expect(stage).toHaveAttribute('data-zoomed', 'true');
  const scale = () =>
    stage.evaluate((el) => {
      const layer = el.firstElementChild as HTMLElement;
      const m = new DOMMatrix(getComputedStyle(layer).transform);
      return m.a;
    });
  await expect.poll(scale).toBeCloseTo(2.5, 2);
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4, { steps: 5 });
  await page.mouse.up();
  await expect(stage).not.toHaveAttribute('data-zoomed', 'true');
  await expect.poll(scale).toBeCloseTo(1, 2);

  // End the comment, then ArrowRight while playing does nothing beyond playback drift.
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.savedToast)).toBeVisible();
  const before = await time();
  const wall = Date.now();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  const elapsed = (Date.now() - wall) / 1000;
  const after = await time();
  expect(after - before).toBeLessThanOrEqual(elapsed + 0.25);
  await page.keyboard.press('Space');

  // Server side.
  const comments = await readSessionComments('Zoe Zoom');
  const first = comments.find((c) => c.meta.kind === 'moment');
  if (!first) throw new Error('no moment comment');
  const done = await waitForState(first.ref, 'done');
  expect(done.events.some((e) => e.type === 'seek' && e.via === 'key')).toBe(true);
  expect(done.events.some((e) => e.type === 'zoom' && e.state === 'start')).toBe(true);
  expect(done.events.some((e) => e.type === 'zoom' && e.state === 'end')).toBe(true);
  expect(done.events.some((e) => e.type === 'zoomPan')).toBe(true);
  expect(done.files.some((f) => /^render\/moment-\d{2}-zoom\.jpg$/.test(f))).toBe(true);
});

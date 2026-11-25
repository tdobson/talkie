import { expect, test } from '@playwright/test';
import type { ExportModel } from '@/lib/export/model';
import {
  centrePixel,
  continueMic,
  exportWhenReady,
  passMicCheck,
  stageBox,
  state,
  T,
} from './helpers';

const NAME = 'Talkie Tess';

// The screenshots are for a person to look over (caption plate, error panel). They land in
// test-results/ and nothing compares them.

test('reviewer comments on a Talkie film and the export maps it to a scene', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(240_000);
  const film = state().talkie;
  // A reviewer's browser talks to this site only: the renderer's WebAssembly included.
  const elsewhere: string[] = [];
  const home = new URL(film.reviewUrl).origin;
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (/^https?:$/.test(url.protocol) && url.origin !== home) elsewhere.push(req.url());
  });
  await page.goto(film.reviewUrl);
  // The film's poster is on the welcome screen, and it loaded.
  const poster = page.getByTestId(T.welcome).locator('img');
  await expect(poster).toBeVisible();
  await expect
    .poll(() => poster.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('talkie-welcome.png') });
  await page.getByTestId(T.nameInput).fill(NAME);
  await page.getByTestId(T.startButton).click();
  await passMicCheck(page);

  // The practice run leaves the film playing from the start.
  await expect(page.getByTestId(T.captionPlate)).toHaveText('Red scene.', { timeout: 10_000 });
  // The picture is up: one of the engine's two canvases has been shown.
  const shown = page.getByTestId(T.video).locator('canvas[style*="visibility: visible"]');
  await expect(shown).toHaveCount(1, { timeout: 15_000 });
  await page.screenshot({ path: testInfo.outputPath('talkie-playing-caption.png') });
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.listening)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('talkie-paused-listening.png') });
  await expect(page.locator('body')).not.toContainText(/\d+:\d\d/); // no timecode anywhere

  const box = await stageBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId(T.listening)).toBeVisible(); // the click did not resume
  await page.waitForTimeout(2500); // the fake mic talks

  // Still paused: step forward a second at a time across the scene boundary at 2 s.
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId(T.captionPlate)).toHaveText('Blue scene.');

  await page.keyboard.press('Space'); // resume, ending the comment
  await expect(page.getByTestId(T.savedToast)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.endScreen)).toBeVisible({ timeout: 15_000 });
  await page.getByTestId(T.endScreen).getByTestId(T.doneButton).click();
  await expect(page.getByTestId(T.thanks)).toContainText(`Thanks, ${NAME}.`);
  expect(elsewhere).toEqual([]);

  const files = await exportWhenReady(request, film.videoId);
  const feedback = JSON.parse(
    files.get('feedback.json')?.toString('utf8') ?? 'null'
  ) as ExportModel;
  const moments = feedback.comments.filter(
    (c) =>
      c.kind === 'moment' &&
      feedback.sessions.some((s) => s.sessionId === c.sessionId && s.reviewerName === NAME)
  );
  expect(moments).toHaveLength(1);
  const [comment] = moments;
  expect(comment.moments.length).toBeGreaterThan(0);
  const first = comment.moments[0];
  expect(first.talkie?.sceneId).toBe('s01');
  expect(first.image).toMatch(new RegExp(`${comment.commentId}/moment-01\\.`));
  const still = files.get(first.image);
  expect(still, `${first.image} in the zip`).toBeDefined();
  const [r, g, b] = await centrePixel(still as Buffer);
  expect(r).toBeGreaterThan(180);
  expect(g).toBeLessThan(80);
  expect(b).toBeLessThan(80);
  expect(files.has('media/talkie.json')).toBe(true);
});

test('a Talkie film that will not load shows the error panel and a Reload button', async ({
  page,
}, testInfo) => {
  const film = state().talkie;
  await page.route(/\/film\/.*talkie\.json(\?.*)?$/, (route) =>
    route.fulfill({ status: 500, body: 'boom' })
  );
  await page.goto(film.reviewUrl);
  await page.getByTestId(T.nameInput).fill('Broken Bo');
  await page.getByTestId(T.startButton).click();
  await continueMic(page);
  await expect(page.getByTestId(T.micHeard)).toBeVisible({ timeout: 10_000 });
  // The practice runs on its own clip, which loads: skip it with play to reach the film.
  await expect(page.getByTestId(T.practiceStart)).toBeEnabled({ timeout: 20_000 });
  await page.getByTestId(T.practiceStart).click();
  await expect(page.getByTestId(T.coachMark)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.practiceListening)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId(T.videoError)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(T.videoReload)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('talkie-load-failure.png') });
});

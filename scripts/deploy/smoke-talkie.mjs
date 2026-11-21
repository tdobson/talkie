// Live smoke test of Talkie review on the deployed site: a fake reviewer leaves one comment on a
// Talkie film, then the export is checked for a still of that moment (drawn by headless Chromium
// on the server). Uses the admin service token for the export.
//
//   node scripts/deploy/smoke-talkie.mjs <review-url> <videoId>
//
// Needs CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET in the environment
// (. ~/.config/video-feedback/service-token.env), and `yarn vf test:fixtures`-made audio in
// apps/video-feedback/test/fixtures/generated/e2e-voice.wav. The comment it leaves is real: it
// shows up on the video's admin page under the reviewer name "Smoke test".
import { createRequire } from 'node:module';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright-core');

const [reviewUrl, videoId] = process.argv.slice(2);
if (!reviewUrl || !videoId) {
  console.error('usage: node scripts/deploy/smoke-talkie.mjs <review-url> <videoId>');
  process.exit(2);
}
const { CF_ACCESS_CLIENT_ID: id, CF_ACCESS_CLIENT_SECRET: secret } = process.env;
if (!id || !secret) {
  console.error('CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be set');
  process.exit(2);
}
const base = new URL(reviewUrl).origin;
const wav = join(root, 'apps/video-feedback/test/fixtures/generated/e2e-voice.wav');
const tid = (t) => `[data-testid="${t}"]`;

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
try {
  const page = await browser.newPage();
  await page.goto(reviewUrl);
  await page.fill(tid('name-input'), 'Smoke test');
  await page.click(tid('start-button'));
  await page.click(tid('mic-continue'));
  await page.waitForSelector(tid('mic-heard'), { timeout: 15_000 });
  await page.click(tid('start-watching'));
  // Play, wait until it really plays, then pause at once: the film can be short.
  await page.click(tid('play-pause'));
  await page.waitForSelector(`${tid('play-pause')}[aria-label="Pause"]`, { timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.keyboard.press('Space');
  await page.waitForSelector(tid('listening-overlay'), { timeout: 10_000 }).catch(async (e) => {
    await page.screenshot({ path: '/tmp/smoke-talkie-fail.png' });
    throw e;
  });
  const box = await page.locator(tid('video-stage')).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
  await page.waitForTimeout(3000);
  await page.keyboard.press('Space');
  await page.waitForSelector(tid('saved-toast'), { timeout: 30_000 });
  console.log('comment saved');
  await page.waitForSelector(tid('end-screen'), { timeout: 20_000 });
  await page.click(`${tid('end-screen')} ${tid('done-button')}`);
  await page.waitForSelector(tid('thanks'));
  console.log('session finished');
} finally {
  await browser.close();
}

// Wait for processing (transcription, stills), then look for the still in the export.
const headers = { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret };
for (let i = 0; i < 40; i++) {
  const res = await fetch(`${base}/api/admin/videos/${videoId}/export.json?version=latest`, {
    headers,
  });
  if (res.status === 200) {
    const model = await res.json();
    const mine = model.comments.filter((c) =>
      model.sessions.some((s) => s.sessionId === c.sessionId && s.reviewerName === 'Smoke test')
    );
    const last = mine.at(-1);
    const moment = last?.moments?.[0];
    console.log(
      JSON.stringify({ transcript: last?.transcript?.text, scene: moment?.talkie, image: moment?.image })
    );
    if (moment?.image) {
      console.log('SMOKE OK: Talkie still drawn on the server');
      process.exit(0);
    }
    console.error('SMOKE FAILED: the comment has no still');
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
console.error('SMOKE FAILED: processing did not finish in 10 minutes');
process.exit(1);

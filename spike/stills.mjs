// The five comparison stills for check 1 (style).
// For each time: capture the Lottie canvas (dotlottie-web in headless Chromium, 1920 x 1080),
// pull the same frame out of the chapter MP4 with ffmpeg, and put the pair side by side in
// out/compare-<t>.png (MP4 on the left, Lottie on the right).
// ffmpeg runs at the lowest CPU and IO priority. Start this script the same way:
//   nice -n19 ionice -c2 -n7 node stills.mjs [--mp4 media/g01.mp4] [--start 23.88] [--scene g01-s01] [--times 3,9.5,12.6,18.2,23]
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromiumPath } from './proto/chromium.mjs';
import { serve } from './proto/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MP4 = path.resolve(here, arg('mp4', 'media/g01.mp4'));
const START = parseFloat(arg('start', '23.88'));          // scene start inside the chapter MP4 (ident 3.48 + card 3.00 + g01-s00 17.40)
const SCENE = arg('scene', 'g01-s01');
// dimmed left half; tiles lifting off; the system arriving; the label and rain; the water drops
const TIMES = arg('times', '3,9.5,12.6,18.2,23').split(',').map(Number);
const VIDEO_FPS = 25;
const OUT = path.join(here, 'out');
const TMP = path.join(OUT, 'tmp');
fs.mkdirSync(TMP, { recursive: true });
if (!fs.existsSync(MP4)) throw new Error(`stills: ${MP4} is missing. Copy the chapter MP4 there (see README).`);
const low = (cmd, args) => execFileSync('nice', ['-n19', 'ionice', '-c2', '-n7', cmd, ...args], { stdio: ['ignore', 'inherit', 'inherit'] });

const { server, port } = await serve(0);
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
await page.goto(`http://localhost:${port}/compare.html?still=1&scene=${SCENE}`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });

for (const t of TIMES) {
  const tag = t.toFixed(2);
  const lottiePng = path.join(TMP, `lottie-${tag}.png`), mp4Png = path.join(TMP, `mp4-${tag}.png`);
  // the MP4 holds each frame for 1/25 s: use the start of the frame that covers t on both sides
  const frameTime = Math.floor(t * VIDEO_FPS + 1e-6) / VIDEO_FPS;
  await page.evaluate((s) => window.__compare.seek(s), frameTime);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.locator('#canvas').screenshot({ path: lottiePng });
  low('ffmpeg', ['-v', 'error', '-y', '-ss', (START + frameTime + 0.5 / VIDEO_FPS).toFixed(3), '-i', MP4, '-frames:v', '1', mp4Png]);
  low('ffmpeg', ['-v', 'error', '-y', '-i', mp4Png, '-i', lottiePng, '-filter_complex', '[0:v]scale=1920:1080[a];[1:v]scale=1920:1080[b];[a][b]hstack=inputs=2', '-frames:v', '1', path.join(OUT, `compare-${tag}.png`)]);
  console.log(`out/compare-${tag}.png  (scene time ${frameTime.toFixed(2)} s, MP4 time ${(START + frameTime).toFixed(2)} s)`);
}
await browser.close();
server.close();
if (problems.length) { console.error('page errors:\n' + problems.join('\n')); process.exit(1); }

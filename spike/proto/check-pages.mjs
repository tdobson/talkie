// Smoke check: compare.html (both scene variants) and sync.html load in headless Chromium with no
// console errors, the Lottie canvas is not blank, and the sync harness records samples for a few
// seconds of playback. Not the check 2 measurement (that is Task S2); just proof the pages work.
// Usage: nice -n19 ionice -c2 -n7 node proto/check-pages.mjs
import { chromium } from 'playwright-core';
import { chromiumPath } from './chromium.mjs';
import { serve } from './serve.mjs';

const { server, port } = await serve(0);
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const open = async (url) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => problems.push(`${url}: ${e}`));
  // the headless shell has no H.264 decoder, so the MP4 pane cannot load here; that one message is expected
  page.on('console', (m) => { if (m.type() === 'error' && !/media\/g01\.mp4|Failed to load resource/.test(m.text() + m.location().url)) problems.push(`${url}: ${m.text()}`); });
  page.on('requestfailed', (r) => { if (!r.url().endsWith('.mp4')) problems.push(`${url}: request failed ${r.url()}`); });
  await page.goto(`http://localhost:${port}/${url}`);
  await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
  return page;
};
const inked = (page) => page.evaluate(async () => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c = document.getElementById('canvas');
  const probe = document.createElement('canvas');
  probe.width = 160; probe.height = 90;
  const g = probe.getContext('2d');
  g.drawImage(c, 0, 0, 160, 90);
  const d = g.getImageData(0, 0, 160, 90).data;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3) + ',' + d[i + 3]);
  return seen.size;
});

for (const scene of ['g01-s01', 'g01-s01-camera']) {
  const page = await open(`compare.html?scene=${scene}&t=2`);
  const frame = await page.evaluate(() => window.__compare.seek(2));
  const colours = await inked(page);
  console.log(`compare.html ${scene}: frame ${frame}, ${colours} distinct colours on the canvas`);
  if (frame !== 120 || colours < 8) problems.push(`compare.html ${scene}: canvas looks blank or the frame is wrong`);
  await page.close();
}
for (const audio of ['webm', 'ogg', 'm4a']) {
  const page = await open(`sync.html?audio=${audio}`);
  const info = await page.evaluate(() => window.__sync.info);
  let line = `sync.html ${audio}: canPlayType "${info.canPlayType[info.type]}"`;
  if (info.canPlayType[info.type]) {
    await page.evaluate(async () => { await window.__sync.play(); await new Promise((r) => setTimeout(r, 4000)); await window.__sync.seek(100); await new Promise((r) => setTimeout(r, 2000)); window.__sync.pause(); });
    const s = await page.evaluate(() => ({ ...window.__sync.stats(), time: window.__sync.time, duration: window.__sync.duration }));
    line += `, ${s.n} samples, p50 ${s.p50} ms, p99 ${s.p99} ms, max ${s.max} ms, at ${s.time.toFixed(1)} of ${s.duration.toFixed(1)} s`;
    if (!s.n || s.time < 100) problems.push(`sync.html ${audio}: playback or seek did not work`);
  } else line += ' (this browser build cannot play it, skipped)';
  console.log(line);
  await page.close();
}
await browser.close();
server.close();
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log('pages load with no console errors');

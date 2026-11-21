// Diagnostic for check 2: how each browser reports audio.currentTime. Per animation frame it logs the
// wall clock, currentTime, seeking and readyState: during plain playback, after a seek, and at 2x.
// Usage: nice -n19 ionice -c2 -n7 node proto/probe-clock.mjs chromium|firefox|webkit [webm|ogg|m4a]
import * as pw from 'playwright-core';
import { serve } from './serve.mjs';
const name = process.argv[2] || 'chromium', track = process.argv[3] || 'webm';
const { server, port } = await serve(0);
const opts = name === 'chromium' ? { args: ['--autoplay-policy=no-user-gesture-required'] } : name === 'firefox' ? { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.volume_scale': '0.0' } } : {};
const browser = await pw[name].launch(opts);
const page = await browser.newPage();
await page.goto(`http://localhost:${port}/sync.html?repeats=24&audio=${track}`);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1');
await page.evaluate(() => { document.getElementById('audio').volume = 0; });   // headless Firefox and WebKit are audible otherwise
await page.click('#play');
await page.waitForFunction(() => window.__sync.time > 0.5);
const watch = (ms) => page.evaluate((ms) => new Promise((done) => {
  const a = document.getElementById('audio'), rows = [], t0 = performance.now();
  const f = () => { rows.push([performance.now() - t0, a.currentTime, a.seeking, a.readyState, a.paused]); if (performance.now() - t0 < ms) requestAnimationFrame(f); else done(rows); };
  requestAnimationFrame(f);
}), ms);
const report = (label, rows) => {
  const steps = []; let last = rows[0], stuck = 0;
  for (const r of rows.slice(1)) { if (r[1] !== last[1]) { steps.push({ wall: r[0] - last[0], media: (r[1] - last[1]) * 1000 }); last = r; } else stuck++; }
  const w = steps.map((s) => s.wall).sort((a, b) => a - b), m = steps.map((s) => s.media).sort((a, b) => a - b);
  const q = (a, x) => a.length ? Math.round(a[Math.floor(a.length * x)] * 10) / 10 : null;
  const count = (i) => { const c = {}; for (const r of rows) c[r[i]] = (c[r[i]] || 0) + 1; return c; };
  console.log(`${name} ${track} ${label}: ${rows.length} frames, currentTime changed on ${steps.length}, unchanged on ${stuck}; step size ms p50 ${q(m, 0.5)} p95 ${q(m, 0.95)} max ${q(m, 0.999)}; wall between changes ms p50 ${q(w, 0.5)} max ${q(w, 0.999)}; seeking ${JSON.stringify(count(2))} readyState ${JSON.stringify(count(3))} paused ${JSON.stringify(count(4))}`);
};
report('play', await watch(3000));
await page.evaluate(() => window.__sync.seek(300));
report('after seek', await watch(3000));
await page.evaluate(() => { window.__sync.rate(2); });
report('at 2x', await watch(3000));
await browser.close(); server.close();

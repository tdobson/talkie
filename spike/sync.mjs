// Check 2 (sync): drive sync.html in one browser and measure how far the picture is from the sound.
// For each narration track (Opus in WebM, Opus in Ogg, AAC in MP4) it runs three phases:
//   1. play:  --minutes of straight playback from the start (10 by default)
//   2. seeks: --seeks random seeks (20 by default, seeded so every browser gets the same ones),
//             with --seek-seconds of playback after each
//   3. rates: --rate-seconds (60 by default) each at 0.5x, 1.5x and 2x
// Drift is what sync.html records: |film time on the canvas - audio.currentTime|, read straight after
// setFrame, once per animation frame. Pass is p99 at or under 40 ms over all three phases.
// Each summary also carries "estimated": the same samples measured against an estimate of where the
// sound really is (see estimatedDrift). It is a diagnostic; the verdict uses the plain reading.
// Results go to out/sync-<browser>.json. Start it at the lowest priority:
//   nice -n19 ionice -c2 -n7 node sync.mjs --browser chromium|firefox|webkit [--tracks webm,ogg,m4a]
import { chromium, firefox, webkit } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './proto/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const BROWSER = arg('browser', 'chromium');
const TRACKS = arg('tracks', 'webm,ogg,m4a').split(',');
const REPEATS = parseInt(arg('repeats', '24'), 10);
const PLAY_SECONDS = parseFloat(arg('minutes', '10')) * 60;
const SEEKS = parseInt(arg('seeks', '20'), 10);
const SEEK_SECONDS = parseFloat(arg('seek-seconds', '3'));
const RATE_SECONDS = parseFloat(arg('rate-seconds', '60'));
const RATES = [0.5, 1.5, 2];
const PASS_MS = 40;
const OUT = arg('out', path.join(here, 'out', `sync-${BROWSER}.json`));

const launchers = {
  chromium: () => chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }),
  firefox: () => firefox.launch({ firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0, 'media.autoplay.block-webaudio': false, 'media.volume_scale': '0.0' } }),
  webkit: () => webkit.launch(),
};
if (!launchers[BROWSER]) throw new Error(`sync: unknown browser ${BROWSER}`);

// a small seeded generator (mulberry32), so the 20 seek targets are the same in every browser
function rng(seed) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r2 = (x) => Math.round(x * 100) / 100;
// A second reading of the same samples. audio.currentTime is a stale reading of where the sound is:
// browsers refresh it every 10 to 40 ms, so it is always at or behind the truth. Within a run of
// steady playback, the best estimate of the true position at a given instant is therefore the
// highest of the recent readings, each carried forward at the playback rate. Returns, per sample,
// |film time on the canvas - that estimate| in ms. A run ends at a seek or a speed change.
function estimatedDrift(samples, windowSeconds = 1) {
  const out = [];
  let start = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i], prev = samples[i - 1];
    if (prev && (s.rate !== prev.rate || Math.abs(s.audio - prev.audio - (s.wall - prev.wall) * s.rate) > 0.4)) start = i;
    let best = -Infinity;
    for (let j = i; j >= start && s.wall - samples[j].wall <= windowSeconds; j--) best = Math.max(best, samples[j].audio + (s.wall - samples[j].wall) * s.rate);
    out.push(Math.abs(s.film - best) * 1000);
  }
  return out;
}
function quantiles(values) {
  if (!values.length) return { n: 0 };
  const d = [...values].sort((a, b) => a - b);
  const p = (x) => d[Math.min(d.length - 1, Math.floor(d.length * x))];
  return { n: d.length, p50: r2(p(0.5)), p95: r2(p(0.95)), p99: r2(p(0.99)), max: r2(d[d.length - 1]), over40: d.filter((x) => x > PASS_MS).length };
}
function summarise(rows) {
  // rows: [drift ms, render ms, signed ms]
  if (!rows.length) return { n: 0 };
  const d = rows.map((r) => r[0]).sort((a, b) => a - b);
  const p = (x) => d[Math.min(d.length - 1, Math.floor(d.length * x))];
  const render = rows.map((r) => r[1]).sort((a, b) => a - b);
  return {
    n: d.length, p50: r2(p(0.5)), p95: r2(p(0.95)), p99: r2(p(0.99)), max: r2(d[d.length - 1]),
    over40: d.filter((x) => x > PASS_MS).length,
    meanSigned: r2(rows.reduce((a, r) => a + r[2], 0) / rows.length),   // negative: the picture is behind the sound
    renderP50: r2(render[Math.floor(render.length * 0.5)]), renderP99: r2(render[Math.floor(render.length * 0.99)]),
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${BROWSER}]`, ...a);

const { server, port } = await serve(0);
const browser = await launchers[BROWSER]();
const result = {
  browser: BROWSER, version: browser.version(), startedAt: new Date().toISOString(), passMs: PASS_MS,
  plan: { repeats: REPEATS, playSeconds: PLAY_SECONDS, seeks: SEEKS, seekSeconds: SEEK_SECONDS, rateSeconds: RATE_SECONDS, rates: RATES },
  canPlayType: null, userAgent: null, cpus: os.cpus().length, tracks: {},
};
const save = () => fs.writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');

for (const key of TRACKS) {
  // the machine's load average is kept with each track: these runs are niced on a shared desktop
  const out = (result.tracks[key] = { ran: false, errors: [], loadAtStart: os.loadavg().map(r2) });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => out.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text()); });
  try {
    await page.goto(`http://localhost:${port}/sync.html?repeats=${REPEATS}&audio=${key}`);
    await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 60000 });
    const info = await page.evaluate(() => window.__sync.info);
    result.canPlayType = info.canPlayType; result.userAgent = info.userAgent;
    out.type = info.type; out.canPlayType = info.canPlayType[info.type];

    // Silence. Headless Firefox and WebKit play through the desktop's speakers otherwise (Playwright
    // only mutes Chromium). Volume 0 keeps the audio pipeline, and so the clock, running as normal.
    await page.evaluate(() => { document.getElementById('audio').volume = 0; });
    // a real click on Play, so the browser sees a user gesture; then wait for the sound to move
    await page.click('#play');
    await page.waitForFunction(() => window.__sync.time > 0.5 && window.__sync.samples.length > 10, null, { timeout: 30000 });
    out.duration = r2(await page.evaluate(() => window.__sync.duration));
    if (!(out.duration >= PLAY_SECONDS + 5)) throw new Error(`the track is ${out.duration} s, shorter than the ${PLAY_SECONDS} s play phase`);

    const all = [], allEstimated = [];
    // collect what was recorded since the last reset
    const take = async (name, extra = {}) => {
      const got = await page.evaluate(() => ({ samples: window.__sync.samples.map((s) => ({ wall: s.wall, audio: s.audio, film: s.film, rate: s.rate, render: s.render })), time: window.__sync.time }));
      got.rows = got.samples.map((s) => [Math.abs(s.film - s.audio) * 1000, s.render, (s.film - s.audio) * 1000]);
      const est = estimatedDrift(got.samples);
      for (const r of got.rows) all.push(r);
      for (const e of est) allEstimated.push(e);
      const s = { ...summarise(got.rows), estimated: quantiles(est), ...extra, audioTimeAtEnd: r2(got.time) };
      log(key, name, JSON.stringify(s));
      return { s, rows: got.rows };
    };

    // ---- phase 1: straight playback
    await page.evaluate(() => { window.__sync.reset(); });
    const t0 = await page.evaluate(() => window.__sync.time);
    const w0 = Date.now();
    await sleep(PLAY_SECONDS * 1000);
    const wall = (Date.now() - w0) / 1000;
    const played = await take('play', { wallSeconds: r2(wall) });
    played.s.audioAdvanced = r2(played.s.audioTimeAtEnd - t0);
    played.s.framesPerSecond = r2(played.s.n / wall);
    // the last 30 s on their own: this is "after 10 minutes of playback"
    const tailRows = played.rows.slice(-Math.round(played.s.framesPerSecond * 30));
    out.play = played.s;
    out.playLast30s = summarise(tailRows);
    save();

    // ---- phase 2: random seeks, playing on after each
    await page.evaluate(() => { window.__sync.reset(); });
    const rand = rng(20261121);
    const targets = [];
    for (let i = 0; i < SEEKS; i++) {
      const t = r2(rand() * (out.duration - 30));
      targets.push(t);
      await page.evaluate((x) => window.__sync.seek(x), t);
      await sleep(SEEK_SECONDS * 1000);
    }
    out.seeks = (await take('seeks', { targets })).s;
    save();

    // ---- phase 3: other speeds
    out.rates = {};
    for (const rate of RATES) {
      await page.evaluate((x) => window.__sync.seek(x), 5);
      await page.evaluate((x) => { window.__sync.rate(x); }, rate);
      await sleep(1000);                                    // let the speed change settle before measuring
      await page.evaluate(() => { window.__sync.reset(); });
      const a0 = await page.evaluate(() => window.__sync.time);
      const r0 = Date.now();
      await sleep(RATE_SECONDS * 1000);
      const got = await take(`rate ${rate}x`);
      got.s.wallSeconds = r2((Date.now() - r0) / 1000);
      got.s.audioAdvanced = r2(got.s.audioTimeAtEnd - a0);
      got.s.measuredRate = r2(got.s.audioAdvanced / got.s.wallSeconds);
      out.rates[`${rate}x`] = got.s;
      save();
    }
    await page.evaluate(() => { window.__sync.rate(1); window.__sync.pause(); });

    out.overall = { ...summarise(all), estimated: quantiles(allEstimated) };
    out.ran = true;
    out.loadAtEnd = os.loadavg().map(r2);
    out.pass = out.overall.p99 <= PASS_MS;
    log(key, 'overall', JSON.stringify(out.overall), out.pass ? 'PASS' : 'FAIL');
  } catch (e) {
    out.errors.push(String(e && e.message ? e.message : e));
    log(key, 'did not run:', out.errors[out.errors.length - 1]);
  }
  save();
  await page.close();
}
result.finishedAt = new Date().toISOString();
save();
await browser.close();
server.close();
log('wrote', path.relative(here, OUT));

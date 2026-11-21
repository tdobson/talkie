// Check 4 (compatibility): pack the scene as a dotLottie v2 file with Talkie's extras in it, then
// open it with stock dotlottie-web (compat.html has no Talkie code) and look at frame 120.
//   out/scene.lottie:  manifest.json, talkie.json, a/g01-s01.json, u/n.webm, u/n.m4a
// Pass: no load error, no console error, and the canvas is not blank at frame 120.
// Usage: nice -n19 ionice -c2 -n7 node pack.mjs          (writes out/scene.lottie and out/check4.json)
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './proto/serve.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ID = 'g01-s01';
const read = (p) => new Uint8Array(fs.readFileSync(path.join(here, p)));
const animation = JSON.parse(fs.readFileSync(path.join(here, 'scene', `${ID}.json`), 'utf8'));
const seconds = 27.24;

// the dotLottie v2 manifest: version "2", a generator, and the list of animations by id (a/<id>.json)
const manifest = { version: '2', generator: 'talkie-spike 0.0.0', animations: [{ id: ID }] };
// Talkie's own file, as in section 4.2 of the design spec
const talkie = {
  talkie: 1,
  title: 'In the roof, not on it',
  duration: seconds,
  size: [animation.w, animation.h],
  audio: [
    { src: 'u/n.webm', type: 'audio/webm; codecs=opus' },
    { src: 'u/n.m4a', type: 'audio/mp4; codecs=mp4a.40.2' },
  ],
  scenes: [{ id: ID, src: `a/${ID}.json`, start: 0, end: seconds }],
  chapters: [{ title: 'How it works', start: 0 }],
  captions: [],
};
const json = (o) => strToU8(JSON.stringify(o));
const files = {
  'manifest.json': [json(manifest), { level: 9 }],
  'talkie.json': [json(talkie), { level: 9 }],
  [`a/${ID}.json`]: [json(animation), { level: 9 }],
  'u/n.webm': [read('audio/n.webm'), { level: 0 }],   // audio is already compressed: stored, not deflated
  'u/n.m4a': [read('audio/n.m4a'), { level: 0 }],
};
const zip = zipSync(files);
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
fs.writeFileSync(path.join(here, 'out', 'scene.lottie'), zip);
const entries = Object.entries(unzipSync(zip)).map(([name, data]) => ({ name, bytes: data.length }));

const { server, port } = await serve(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://localhost:${port}/compat.html`);
await page.waitForFunction(() => window.__compat && window.__compat.done, null, { timeout: 60000 });
const got = await page.evaluate(() => window.__compat);
await page.screenshot({ path: path.join(here, 'out', 'check4-frame120.png') });
const result = {
  file: 'out/scene.lottie', bytes: zip.length, entries, browser: `chromium ${browser.version()}`,
  loaded: got.loaded, loadError: got.loadError, frame: got.frame, totalFrames: got.totalFrames, manifest: got.manifest,
  distinctColours: got.colours, errors,
  pass: got.loaded && !got.loadError && errors.length === 0 && got.frame === 120 && got.colours >= 8,
};
await browser.close();
server.close();
fs.writeFileSync(path.join(here, 'out', 'check4.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log(result.pass ? 'check 4: PASS' : 'check 4: FAIL');

// Runs real headless Chromium, so it is left out of `yarn check`. Run it with
// `yarn test:chromium` (TEST_CHROMIUM=1, see vitest.config.ts).
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { renderMomentStill } from '@/lib/render/stills';
import type { Moment, ProbeInfo } from '@/lib/types';
import type { FrameSource } from './frame-source';
import { talkieFrameSource } from './frame-source-talkie';
import { openTalkieBrowser } from './talkie-browser';
import { buildRenderPage } from './talkie-render-page/build';

const run = promisify(execFile);
const FIXTURE_FILM = fileURLToPath(new URL('../../test/fixtures/talkie-mini', import.meta.url));
const SIZE = { width: 320, height: 180 };
const probe: ProbeInfo = {
  width: 320,
  height: 180,
  fps: 30,
  frameDuration: 1 / 30,
  duration: 4,
  codec: 'talkie',
  pixFmt: 'vector',
  hasAudio: true,
};

let tmp: string;
let pageDir: string;
let filmDir: string;
let edgeFilmDir: string;

const source = (dir: string): FrameSource =>
  talkieFrameSource(dir, SIZE, { open: (d) => openTalkieBrowser(d, { pageDir }) });

/** Field 19 of /proc/<pid>/stat. The name in field 2 may hold spaces, so count from its end. */
async function niceOf(pid: number): Promise<number> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[16]);
}

async function descendants(pid: number): Promise<number[]> {
  const { stdout } = await run('ps', ['-e', '-o', 'pid=,ppid=']);
  const rows = stdout
    .trim()
    .split('\n')
    .map((l) => l.trim().split(/\s+/).map(Number) as [number, number]);
  const found: number[] = [];
  const walk = (parent: number): void => {
    for (const [child, ppid] of rows) {
      if (ppid === parent) {
        found.push(child);
        walk(child);
      }
    }
  };
  walk(pid);
  return found;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pids: number[]): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    if (!pids.some(alive)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** How many pixels are neither background nor shape: the width of the blur along an edge. */
async function softPixels(image: Buffer): Promise<number> {
  const { data } = await sharp(image)
    .extractChannel('red')
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (const v of data) if (v > 48 && v < 208) n += 1;
  return n;
}

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'vf-talkie-chromium-'));
  pageDir = await buildRenderPage(join(tmp, 'page'));
  filmDir = join(tmp, 'film');
  await cp(FIXTURE_FILM, filmDir, { recursive: true });
  // The fixture is two flat colours. A copy whose red scene is a triangle gives a diagonal
  // edge through the middle of the frame, which is what sharpness is measured on.
  edgeFilmDir = join(tmp, 'edge-film');
  await cp(FIXTURE_FILM, edgeFilmDir, { recursive: true });
  const scene = await readFile(join(edgeFilmDir, 'a', 's01.json'), 'utf8');
  const square = '"v":[[0,0],[320,0],[320,180],[0,180]],"i":[[0,0],[0,0],[0,0],[0,0]]';
  const triangle = '"v":[[0,0],[320,0],[0,180],[0,180]],"i":[[0,0],[0,0],[0,0],[0,0]]';
  if (!scene.includes(square)) throw new Error('the fixture scene has changed shape');
  await writeFile(join(edgeFilmDir, 'a', 's01.json'), scene.replace(square, triangle));
}, 120_000);

afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('talkieFrameSource @chromium', () => {
  it('draws the red scene at t=1 and the blue scene at t=3', async () => {
    const s = source(filmDir);
    try {
      const red = await s.frame(1, 320);
      const meta = await sharp(red).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual(['png', 320, 180]);
      const r = await sharp(red).stats();
      expect(r.dominant.r).toBeGreaterThan(200);
      expect(r.dominant.b).toBeLessThan(50);
      expect(r.channels[0].mean).toBeGreaterThan(200);
      expect(r.channels[2].mean).toBeLessThan(50);

      const blue = await sharp(await s.frame(3, 320)).stats();
      expect(blue.dominant.b).toBeGreaterThan(200);
      expect(blue.dominant.r).toBeLessThan(50);
      expect(blue.channels[2].mean).toBeGreaterThan(200);
      expect(blue.channels[0].mean).toBeLessThan(50);

      // Back to the first scene, and at another size: the same browser, still the right frame.
      const wide = await s.frame(1.5, 640);
      const wm = await sharp(wide).metadata();
      expect([wm.width, wm.height]).toEqual([640, 360]);
      const w = await sharp(wide).stats();
      expect(w.channels[0].mean).toBeGreaterThan(200);
      expect(w.channels[2].mean).toBeLessThan(50);
    } finally {
      await s.close();
    }
  }, 120_000);

  it('runs Chromium at nice 19 and IO level 7, and leaves nothing running', async () => {
    const browser = await openTalkieBrowser(filmDir, { pageDir });
    const pid = browser.pid;
    let all: number[] = [];
    try {
      expect(pid).not.toBeNull();
      await browser.render(1, 320, 180);
      const children = await descendants(pid as number);
      expect(children.length).toBeGreaterThan(0); // renderer and helper processes
      all = [pid as number, ...children];
      for (const p of all) {
        if (alive(p)) expect(await niceOf(p), `nice of ${p}`).toBe(19);
      }
      const { stdout } = await run('ionice', ['-p', String(pid)]);
      expect(stdout.trim()).toBe('best-effort: prio 7');
    } finally {
      await browser.close();
    }
    expect(await gone(all)).toBe(true);
    await browser.close(); // safe to call twice
  }, 120_000);

  it('kill stops the browser and every helper process at once', async () => {
    const browser = await openTalkieBrowser(filmDir, { pageDir });
    const pid = browser.pid as number;
    await browser.render(1, 320, 180);
    const all = [pid, ...(await descendants(pid))];
    await browser.kill();
    expect(await gone(all)).toBe(true);
    await expect(browser.render(1, 320, 180)).rejects.toThrow();
  }, 120_000);

  describe('with a film that never finishes loading', () => {
    let stuckPageDir: string;

    /** Chromium processes started by this test process and still running. */
    const browsersLeft = async (): Promise<number[]> =>
      (await descendants(process.pid)).filter(alive);

    const noneLeft = async (before: number[]): Promise<boolean> => {
      for (let i = 0; i < 80; i++) {
        const extra = (await browsersLeft()).filter((p) => !before.includes(p));
        if (extra.length === 0) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };

    beforeAll(async () => {
      stuckPageDir = join(tmp, 'stuck-page');
      await cp(pageDir, stuckPageDir, { recursive: true });
      await writeFile(join(stuckPageDir, 'main.js'), 'window.talkieReady = new Promise(() => {});');
    });

    it('stops the browser when the frame passes its time limit, though it never opened', async () => {
      const before = await browsersLeft();
      // The wait for the film is longer than the frame limit, so the frame limit is what acts.
      const s = talkieFrameSource(filmDir, SIZE, {
        open: (d, signal) =>
          openTalkieBrowser(d, { pageDir: stuckPageDir, signal, openTimeoutMs: 60_000 }),
        frameTimeoutMs: 4000,
      });
      await expect(s.frame(1, 320)).rejects.toThrow(/time limit of 4s/);
      await s.close();
      expect(await noneLeft(before)).toBe(true);
    }, 120_000);

    it('gives up on its own when the film does not load in time', async () => {
      const before = await browsersLeft();
      await expect(
        openTalkieBrowser(filmDir, { pageDir: stuckPageDir, openTimeoutMs: 2000 })
      ).rejects.toThrow(/did not open within 2s/);
      expect(await noneLeft(before)).toBe(true);
    }, 120_000);

    it('does not start drawing when it is told to stop before it starts', async () => {
      const before = await browsersLeft();
      const stopped = new AbortController();
      stopped.abort();
      await expect(
        openTalkieBrowser(filmDir, { pageDir: stuckPageDir, signal: stopped.signal })
      ).rejects.toThrow(/stopped/);
      expect(await noneLeft(before)).toBe(true);
    }, 120_000);
  });

  it('makes a 2.5x zoom crop that is sharper than an upscale', async () => {
    const s = source(edgeFilmDir);
    try {
      // The pointer is outside the zoomed area, so the crop holds the picture and nothing else.
      const moment: Moment = {
        id: 'moment-01',
        t: 1000,
        vt: 1,
        x: 0.02,
        y: 0.02,
        inside: true,
        zoom: { scale: 2.5, originX: 0.5, originY: 0.5 },
        kinds: ['zoom'],
        reasons: ['zoom'],
      };
      const { zoom } = await renderMomentStill(s, moment, [], probe);
      const crop = zoom as Buffer;
      const cm = await sharp(crop).metadata();
      expect([cm.width, cm.height]).toEqual([1920, 1080]);

      // What an MP4 would give: the same area of the still, scaled up 2.5 times.
      const still = await s.frame(1, 1920);
      const upscaled = await sharp(still)
        .extract({ left: 576, top: 324, width: 768, height: 432 })
        .resize(1920, 1080, { fit: 'fill' })
        .jpeg({ quality: 85 })
        .toBuffer();

      const sharpEdge = await softPixels(crop);
      const softEdge = await softPixels(upscaled);
      expect(sharpEdge).toBeGreaterThan(0); // the edge is in the crop
      expect(softEdge).toBeGreaterThan(sharpEdge * 1.5);
    } finally {
      await s.close();
    }
  }, 180_000);

  it('fails the frame, not the process, when a scene cannot be drawn', async () => {
    const broken = join(tmp, 'broken-film');
    await cp(FIXTURE_FILM, broken, { recursive: true });
    await writeFile(join(broken, 'a', 's02.json'), '{"not":"a lottie"}');
    const s = source(broken);
    try {
      await expect(s.frame(3, 320)).rejects.toThrow(/scene s02 could not be drawn/);
      // The source recovers with a new browser for the scene that is fine.
      const red = await sharp(await s.frame(1, 320)).stats();
      expect(red.channels[0].mean).toBeGreaterThan(200);
    } finally {
      await s.close();
    }
  }, 120_000);
});

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  compileScene,
  emitLottie,
  scene,
  svgAt,
  type SceneDef,
} from '../packages/author/src/index';
import {
  gradientShadow,
  SHADOW_STAGE,
  SHADOW_SVG,
  shadowScene,
  stackedShadow,
} from '../packages/author/test/shadows';
import { FILM_DIR, REPO, WASM_FILE } from './serve';
import { silence } from './silence';

// Gradients and clip paths, drawn for real. A drawing with linear and radial gradients (a stop
// that is half see-through, both unit modes, gradientTransform, a gradient stroke, href stops) and
// clip paths (on a group, on a turned shape, with a transform of its own, in bounding box units)
// goes through the author package into Lottie. The film's own drawing engine (dotLottie WASM)
// draws it, Chromium draws the original SVG, and the two pictures are compared pixel by pixel.
//
// The two renderers smooth edges differently, so the test allows for that: a pixel only counts
// as wrong when no pixel within one step of it in the other picture is close in colour. A wrong
// gradient, a missing clip or a clip in the wrong place shows up as a whole area, not an edge.

const ENGINE = join(REPO, 'node_modules/@lottiefiles/dotlottie-web/dist/index.js');
const ORIGIN = 'http://talkie.test';
const SIZE: [number, number] = [320, 180];
const SVG = readFileSync(join(REPO, 'e2e/fixtures/paint-clip.svg'), 'utf8');

const compile = (def: SceneDef, duration: number) =>
  compileScene(def, {
    size: SIZE,
    lines: [],
    duration,
    loaders: {
      svg: () => SVG,
      font: () => {
        throw new Error('no font in this scene');
      },
    },
  });

interface Difference {
  /** Pixels in the picture. */
  pixels: number;
  /** Mean of |film - svg| over every pixel and colour channel, 0 to 255. */
  mean: number;
  /** The largest channel difference anywhere. */
  max: number;
  /** Pixels where some channel differs by more than 16. */
  over16: number;
  /** Pixels where some channel differs by more than 48. */
  over48: number;
  /**
   * The largest channel difference away from edges: over pixels where neither picture changes by
   * more than 4 between neighbours, so smoothing cannot be the cause.
   */
  smoothMax: number;
  /** Pixels with no pixel within one step in the other picture that is within 24 on each channel. */
  unmatched: number;
  /** Where the unmatched pixels are, for the failure message. */
  unmatchedAt: Array<[number, number]>;
}

// The page, the engine and its .wasm are all answered here, so the test needs no server.
test.beforeEach(async ({ page }) => {
  // Nothing here plays sound, but keep it that way if something ever does.
  await silence(page);
  await page.route(`${ORIGIN}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/engine.js') {
      return route.fulfill({ path: ENGINE, contentType: 'text/javascript' });
    }
    if (pathname === '/engine.wasm') {
      return route.fulfill({ path: WASM_FILE, contentType: 'application/wasm' });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>paint</title><canvas id="film"></canvas>',
    });
  });
});

interface Pictures {
  /** The Lottie animation, drawn by the film's engine at `frame`. */
  animation: Record<string, unknown>;
  frame: number;
  /** The reference, drawn by Chromium. Its width and height are set to the canvas size. */
  svg: string;
  /** The canvas size. The engine fits the animation into it. */
  size?: [number, number];
  /**
   * Only count the pixels this SVG covers fully, along with all their neighbours. Without it every
   * pixel counts.
   */
  region?: string;
}

/**
 * Draw a frame of a Lottie animation with the film's engine and an SVG with Chromium, each on
 * white paper, and measure how far apart they are. The pictures go into test-results under `name`.
 */
async function compare(
  page: Page,
  testInfo: TestInfo,
  name: string,
  { animation, frame, svg, size = SIZE, region }: Pictures
): Promise<Difference> {
  await page.goto(`${ORIGIN}/`);

  const result = await page.evaluate(
    async ({ animation, svg, size, frame, region }) => {
      const [w, h] = size;
      type Engine = {
        setFrame(frame: number): void;
        addEventListener(name: string, listener: (event: { error?: Error }) => void): void;
      };
      const { DotLottie } = (await import('/engine.js' as string)) as {
        DotLottie: {
          new (config: Record<string, unknown>): Engine;
          setWasmUrl(url: string): void;
        };
      };
      DotLottie.setWasmUrl('/engine.wasm');
      const film = document.querySelector<HTMLCanvasElement>('#film')!;
      film.width = w;
      film.height = h;
      const engine = new DotLottie({
        canvas: film,
        data: animation,
        autoplay: false,
        loop: false,
        renderConfig: { devicePixelRatio: 1, autoResize: false },
      });
      await new Promise<void>((done, fail) => {
        engine.addEventListener('load', () => done());
        engine.addEventListener('loadError', (event) =>
          fail(event.error ?? new Error('the scene could not be loaded'))
        );
      });
      engine.setFrame(frame);
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));

      const drawn = async (source: string) => {
        const picture = new Image();
        picture.width = w;
        picture.height = h;
        await new Promise((done, fail) => {
          picture.addEventListener('load', done);
          picture.addEventListener('error', () => fail(new Error('the SVG could not be drawn')));
          picture.src = `data:image/svg+xml,${encodeURIComponent(
            source.replace('<svg ', `<svg width="${w}" height="${h}" `)
          )}`;
        });
        return picture;
      };
      const picture = await drawn(svg);
      /** Which pixels count: all of them, or those the region covers with all their neighbours. */
      let counts = (_x: number, _y: number) => true;
      if (region) {
        const paper = document.createElement('canvas');
        paper.width = w;
        paper.height = h;
        const pen = paper.getContext('2d')!;
        pen.drawImage(await drawn(region), 0, 0, w, h);
        const cover = pen.getImageData(0, 0, w, h).data;
        counts = (x, y) => {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h || cover[(ny * w + nx) * 4 + 3] !== 255) {
                return false;
              }
            }
          }
          return true;
        };
      }

      // Both go onto white paper, so a see-through pixel has a colour to compare.
      const read = (source: CanvasImageSource) => {
        const paper = document.createElement('canvas');
        paper.width = w;
        paper.height = h;
        const pen = paper.getContext('2d')!;
        pen.fillStyle = '#ffffff';
        pen.fillRect(0, 0, w, h);
        pen.drawImage(source, 0, 0, w, h);
        return { paper, data: pen.getImageData(0, 0, w, h).data };
      };
      const a = read(film);
      const b = read(picture);

      const at = (data: Uint8ClampedArray, x: number, y: number, c: number) =>
        data[(y * w + x) * 4 + c]!;
      /** Is some pixel of `other` within one step of (x, y) close to this pixel of `one`? */
      const matched = (one: Uint8ClampedArray, other: Uint8ClampedArray, x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
              continue;
            }
            let close = true;
            for (let c = 0; c < 3 && close; c++) {
              close = Math.abs(at(one, x, y, c) - at(other, nx, ny, c)) <= 24;
            }
            if (close) {
              return true;
            }
          }
        }
        return false;
      };

      let pixels = 0;
      let sum = 0;
      let max = 0;
      let over16 = 0;
      let over48 = 0;
      let smoothMax = 0;
      /** Does the picture stay within 4 on every channel across the pixel's neighbours? */
      const smooth = (data: Uint8ClampedArray, x: number, y: number) => {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = Math.min(Math.max(x + dx, 0), w - 1);
            const ny = Math.min(Math.max(y + dy, 0), h - 1);
            for (let c = 0; c < 3; c++) {
              if (Math.abs(at(data, x, y, c) - at(data, nx, ny, c)) > 4) {
                return false;
              }
            }
          }
        }
        return true;
      };
      let unmatched = 0;
      const unmatchedAt: Array<[number, number]> = [];
      const diff = document.createElement('canvas');
      diff.width = w;
      diff.height = h;
      const diffPen = diff.getContext('2d')!;
      const diffImage = diffPen.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!counts(x, y)) {
            continue;
          }
          pixels++;
          let worst = 0;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(at(a.data, x, y, c) - at(b.data, x, y, c));
            sum += d;
            worst = Math.max(worst, d);
          }
          max = Math.max(max, worst);
          over16 += worst > 16 ? 1 : 0;
          over48 += worst > 48 ? 1 : 0;
          if (smooth(a.data, x, y) && smooth(b.data, x, y)) {
            smoothMax = Math.max(smoothMax, worst);
          }
          const lost =
            worst > 24 && (!matched(a.data, b.data, x, y) || !matched(b.data, a.data, x, y));
          if (lost) {
            unmatched++;
            if (unmatchedAt.length < 20) {
              unmatchedAt.push([x, y]);
            }
          }
          const n = (y * w + x) * 4;
          diffImage.data[n] = lost ? 255 : worst * 4;
          diffImage.data[n + 1] = lost ? 0 : worst * 4;
          diffImage.data[n + 2] = lost ? 0 : worst * 4;
          diffImage.data[n + 3] = 255;
        }
      }
      diffPen.putImageData(diffImage, 0, 0);
      return {
        difference: {
          pixels,
          mean: sum / (pixels * 3),
          max,
          over16,
          over48,
          smoothMax,
          unmatched,
          unmatchedAt,
        },
        film: a.paper.toDataURL('image/png'),
        svg: b.paper.toDataURL('image/png'),
        diff: diff.toDataURL('image/png'),
      };
    },
    { animation, svg, size, frame, region }
  );

  // The three pictures are kept in test-results, to look at when a limit is crossed.
  for (const kind of ['film', 'svg', 'diff'] as const) {
    const url = result[kind];
    const path = testInfo.outputPath(`${name}-${kind}.png`);
    writeFileSync(path, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    await testInfo.attach(`${name}-${kind}.png`, { path, contentType: 'image/png' });
  }

  const d: Difference = result.difference;
  const share = (count: number) => `${((100 * count) / d.pixels).toFixed(2)}%`;
  const report =
    `${name}, ${d.pixels} pixels of ${size[0]}x${size[1]}: ` +
    `mean ${d.mean.toFixed(2)} of 255, max ${d.max}, ` +
    `${share(d.over16)} of pixels off by more than 16, ${share(d.over48)} by more than 48, ` +
    `${d.smoothMax} at most away from edges, ` +
    `${d.unmatched} with no close match within one pixel`;
  await testInfo.attach(`${name}-difference`, { contentType: 'text/plain', body: report });
  process.stdout.write(`${report}\n`);
  return d;
}

/** The limits a correct film stays within. See the first test for how they were set. */
function expectClose(d: Difference): void {
  expect(
    d.unmatched,
    `unmatched pixels, first at ${JSON.stringify(d.unmatchedAt)}`
  ).toBeLessThanOrEqual(20);
  expect(d.mean).toBeLessThan(1.2);
  expect(d.smoothMax).toBeLessThanOrEqual(8);
  expect(d.over16 / d.pixels).toBeLessThan(0.003);
}

test('gradients and clip paths look the same in the film as in the SVG', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'pictures are compared in chromium only');

  // The drawing must actually use what this test is about, or it proves nothing.
  const model = compile(
    scene('paint-clip', (ctx) => ctx.add(ctx.art('paint-clip', { at: [0, 0] }))),
    1
  );
  const json = JSON.stringify(emitLottie(model));
  expect(json).toContain('"ty":"gf"');
  expect(json).toContain('"ty":"gs"');
  expect(json).toContain('"masksProperties"');

  const d = await compare(page, testInfo, "film against Chromium's SVG", {
    animation: JSON.parse(json) as Record<string, unknown>,
    frame: 0,
    svg: SVG,
  });

  // Edges aside, the pictures agree. The limits in expectClose are about twice what a correct
  // film measures (mean 0.76, 0.16% over 16, 4 away from edges, 8 unmatched edge pixels). Each
  // catches a known fault: a dropped clip leaves 618 unmatched pixels, a clip turned 4 degrees
  // 65, a stop opacity off by 0.1 lifts the mean to 4 and the smooth areas to 17, a shadow stop
  // off by 0.05 lifts the smooth areas to 9, a gradient turned 5 degrees to 13, and a focal point
  // moved 4 px puts 0.5% of pixels over 16.
  expectClose(d);
});

// The motion helpers on the same drawing, part way through: a fade on a clipped group (drawn as a
// precomp), a pop on a gradient shape, a rise on a clipped shape and a fade on the stretched radial
// shadow. The reference here is the scene's SVG mirror at the same moment, which the art-mirror
// test in packages/cli holds to the drawing.
test('gradients and clip paths move in the film as they do in the SVG mirror', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'pictures are compared in chromium only');
  const model = compile(
    scene('paint-clip-motion', (ctx) => {
      const art = ctx.art('paint-clip', { at: [0, 0] });
      ctx.add(art);
      const named = (name: string) => {
        const hit = art.children.find((child) => child.name === name);
        if (!hit) {
          throw new Error(`no ${name} in the drawing`);
        }
        return hit;
      };
      ctx.fade(named('window'), 0, { dur: 1 });
      ctx.fade(named('shadow'), 0, { dur: 1 });
      ctx.pop(named('sun'), 0.2, { dur: 1 });
      ctx.rise(named('tile'), 0, { dur: 1 });
      ctx.rise(named('barred'), 0, { dur: 1 });
      // A fade over a clipped group, and a fade under a clipped group: both make precomps.
      ctx.fade(named('sign'), 0, { dur: 1 });
      const bar = named('badge').children.find((child) => child.name === 'badge-bar');
      if (!bar) {
        throw new Error('no badge-bar in the drawing');
      }
      ctx.fade(bar, 0, { dur: 1 });
    }),
    2
  );
  const animation = emitLottie(model) as unknown as Record<string, unknown>;
  expect((animation.assets as unknown[]).length).toBe(2);
  // Late in the fade, from about 0.7 s, Chromium draws the edge of the clipped, see-through
  // window with less cover than it does once the window is solid: up to 29 edge pixels come out
  // unmatched at 0.9 s. The film's edge at 0.9 s matches Chromium's drawing of the solid original,
  // so that is Chromium smoothing a clip on a see-through group, not the film. These moments keep
  // clear of it: early, middle, and after the motion.
  for (const t of [0.3, 0.5, 1.5]) {
    const svg = svgAt(model, t);
    expectClose(
      await compare(page, testInfo, `motion at ${t} s`, { animation, frame: t * 60, svg })
    );
  }
});

// The sample film's tile uses a gradient and a clip path. Its built roof scene, drawn by the
// film's engine once the tile has popped in and the camera has pushed in, has to show the tile as
// Chromium draws tile.svg in the same place, on the sky. What counts is the inside of the tile and
// a strip of sky under its curved foot, where the grooves would show if the clip were lost. The
// rest of the scene is not in the reference. Build first: yarn build && yarn sample
test('the sample film draws its gradient and clipped tile as the SVG does', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'pictures are compared in chromium only');
  const roof = readFileSync(join(FILM_DIR, 'a/roof.json'), 'utf8');
  expect(roof).toContain('"ty":"gf"');
  expect(roof).toContain('"masksProperties"');

  const tile = readFileSync(join(REPO, 'examples/sample-film/art/tile.svg'), 'utf8');
  const inner = tile.slice(tile.indexOf('>') + 1, tile.lastIndexOf('</svg>'));
  const body = /id="body" d="([^"]+)"/.exec(tile)![1];
  // From scenes/roof.ts: the tile is placed at (525, 290), and the camera ends at 104% about
  // (600, 300).
  const place = 'translate(600 300) scale(1.04) translate(-600 -300) translate(525 290)';
  const stage = (content: string, sky = '') =>
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">${sky}<g transform="${place}">${content}</g></svg>`;
  const d = await compare(page, testInfo, 'sample film tile at 15 s', {
    animation: JSON.parse(roof) as Record<string, unknown>,
    frame: 15 * 60,
    svg: stage(inner, '<rect width="1280" height="720" fill="#eaf3f6"/>'),
    size: [1280, 720],
    // The strip runs from x 20 to 130 in the tile, clear of the rafter behind its left edge, and
    // from just under the lowest point of the foot (y 190) to the ends of the grooves (y 200).
    region: stage(`<path d="${body}"/><rect x="20" y="191" width="110" height="9"/>`),
  });
  expect(d.pixels).toBeGreaterThan(20_000);
  expectClose(d);
});

// A soft shadow as one radial gradient, against the stacked flat copies it replaces. The gradient
// has to match Chromium's drawing of the same SVG. The copies are only measured: they are an
// approximation, and the report says how far it is from the smooth fade.
test('a soft shadow: one radial gradient against stacked copies', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'pictures are compared in chromium only');
  const size = SHADOW_STAGE;
  const gradient = shadowScene(gradientShadow());
  // The whole shadow and a margin round it, so the mean is over the shadow, not the empty stage.
  const region = SHADOW_SVG.replace(
    /<defs>.*<\/defs>.*$/,
    '<rect x="240" y="250" width="480" height="100"/></svg>'
  );
  const animation = (json: string) => JSON.parse(json) as Record<string, unknown>;

  const exact = await compare(page, testInfo, 'shadow gradient against Chromium', {
    animation: animation(gradient.json),
    frame: 0,
    svg: SHADOW_SVG,
    size,
    region,
  });
  expectClose(exact);

  const lines = [`one radial gradient: ${gradient.raw} bytes raw, ${gradient.gzip} gzipped`];
  for (const copies of [6, 8, 12]) {
    const stacked = shadowScene(stackedShadow(copies));
    const d = await compare(page, testInfo, `${copies} copies against the gradient`, {
      animation: animation(stacked.json),
      frame: 0,
      svg: SHADOW_SVG,
      size,
      region,
    });
    lines.push(
      `${copies} stepped copies: ${stacked.raw} bytes raw, ${stacked.gzip} gzipped; ` +
        `against the gradient, mean ${d.mean.toFixed(2)} of 255, max ${d.max}`
    );
    expect(gradient.gzip).toBeLessThan(stacked.gzip);
  }
  const report = lines.join('\n');
  await testInfo.attach('shadow sizes', { contentType: 'text/plain', body: report });
  process.stdout.write(`${report}\n`);
});

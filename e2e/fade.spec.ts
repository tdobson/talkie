import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { compileScene, emitLottie, scene, svgAt } from '../packages/author/src/index';
import { REPO, WASM_FILE } from './serve';

// A node that fades is one picture going see-through, as it is in SVG: its fill must not show
// through its own stroke, and a shape underneath must not show through the one on top. This draws
// one frame of a scene with the film's drawing engine and again from the SVG mirror, and compares
// the colours.

const ENGINE = join(REPO, 'node_modules/@lottiefiles/dotlottie-web/dist/index.js');
const ORIGIN = 'http://talkie.test';
const SIZE: [number, number] = [320, 180];
const RED = '#ff0000';
const BLUE = '#0000ff';
const GREEN = '#00aa00';
const BOTH = { fill: RED, stroke: BLUE, strokeWidth: 16 };

// Each case is a 60 px square (or a pair of them) with its top left corner at [x, 20] or [x, 110].
const model = compileScene(
  scene('fade', (c) => {
    const half = { from: 100, to: 0, dur: 2, ease: 'linear' as const };
    const top = c.rect(20, 20, 60, 60, BOTH, 'top');
    const child = c.rect(120, 20, 60, 60, BOTH, 'child');
    const holder = c.group('holder', [child]);
    const pair = c.group('pair', [
      c.rect(220, 20, 40, 40, { fill: RED }, 'under'),
      c.rect(240, 40, 40, 40, { fill: GREEN }, 'over'),
    ]);
    const innerPair = c.group('inner pair', [
      c.rect(20, 110, 40, 40, { fill: RED }, 'under'),
      c.rect(40, 130, 40, 40, { fill: GREEN }, 'over'),
    ]);
    const deep = c.rect(140, 110, 40, 40, BOTH, 'deep');
    const moving = c.group('moving', [
      c.rect(120, 100, 10, 10, { fill: GREEN }, 'before'),
      c.group('middle', [innerPair, deep]),
      c.rect(190, 100, 10, 10, { fill: GREEN }, 'after'),
    ]);
    c.add(top, holder, pair, moving);
    c.fade(top, 0, half);
    c.fade(child, 0, half);
    c.fade(pair, 0, half);
    c.fade(innerPair, 0, half);
    c.fade(deep, 0, half);
    // The parents move, and the faded children have to move with them.
    c.tween(moving, 'position', [
      { t: 0, v: [0, 0], ease: 'linear' },
      { t: 2, v: [100, 0] },
    ]);
  }),
  { size: SIZE, lines: [], duration: 2 }
);
const AT = 1;
const DX = 50;

// Where to look: the middle of a fill, both halves of a stroke, and where two shapes overlap.
const POINTS: Array<{ name: string; x: number; y: number }> = [
  { name: 'top fill', x: 50, y: 50 },
  { name: 'top stroke over the fill', x: 24, y: 50 },
  { name: 'top stroke outside the fill', x: 16, y: 50 },
  { name: 'child fill', x: 150, y: 50 },
  { name: 'child stroke over the fill', x: 124, y: 50 },
  { name: 'child stroke outside the fill', x: 116, y: 50 },
  { name: 'pair under', x: 230, y: 30 },
  { name: 'pair overlap', x: 250, y: 50 },
  { name: 'pair over', x: 270, y: 70 },
  { name: 'inner pair under', x: 30 + DX, y: 120 },
  { name: 'inner pair overlap', x: 50 + DX, y: 140 },
  { name: 'inner pair over', x: 70 + DX, y: 160 },
  { name: 'deep fill', x: 160 + DX, y: 130 },
  { name: 'deep stroke over the fill', x: 144 + DX, y: 130 },
  { name: 'deep stroke outside the fill', x: 136 + DX, y: 130 },
  { name: 'before', x: 125 + DX, y: 105 },
  { name: 'after', x: 195 + DX, y: 105 },
];

test('a fading node looks the same in the film as in the SVG mirror', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium', 'colours are compared in chromium only');

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
      body: '<!doctype html><title>fade</title><canvas id="film"></canvas>',
    });
  });
  await page.goto(`${ORIGIN}/`);

  const colours = await page.evaluate(
    async ({ animation, svg, frame, size, points }) => {
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

      const picture = new Image();
      picture.width = w;
      picture.height = h;
      await new Promise((done, fail) => {
        picture.addEventListener('load', done);
        picture.addEventListener('error', () => fail(new Error('the SVG could not be drawn')));
        picture.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      });

      // Both go onto white paper, so a see-through pixel has a colour to compare.
      const read = (source: CanvasImageSource) => {
        const paper = document.createElement('canvas');
        paper.width = w;
        paper.height = h;
        const pen = paper.getContext('2d')!;
        pen.fillStyle = '#ffffff';
        pen.fillRect(0, 0, w, h);
        pen.drawImage(source, 0, 0, w, h);
        return points.map(({ x, y }) => [...pen.getImageData(x, y, 1, 1).data.slice(0, 3)]);
      };
      return { film: read(film), svg: read(picture) };
    },
    {
      animation: emitLottie(model) as unknown as Record<string, unknown>,
      svg: svgAt(model, AT).replace('<svg ', `<svg width="${SIZE[0]}" height="${SIZE[1]}" `),
      frame: AT * 60,
      size: SIZE,
      points: POINTS,
    }
  );

  // The mirror is the reference, so first make sure it shows what the scene asks for: half of
  // blue on white where the stroke lies over the fill, with no red in it.
  const mirror = Object.fromEntries(POINTS.map((point, n) => [point.name, colours.svg[n]]));
  const near = (one: number[], other: number[]) =>
    one.every((value, channel) => Math.abs(value - other[channel]!) <= 6);
  expect(near(mirror['top stroke over the fill']!, [128, 128, 255])).toBe(true);
  expect(near(mirror['pair overlap']!, [128, 213, 128])).toBe(true);

  const far = POINTS.map((point, n) => ({
    name: point.name,
    film: colours.film[n]!,
    svg: colours.svg[n]!,
  })).filter(({ film, svg }) => !near(film, svg));
  expect(far).toEqual([]);
});

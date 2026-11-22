import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { compileScene, scene, svgAt } from '@talkie/author';

// Every drawing the importer accepts, drawn by resvg twice: as the artist wrote it, and as the SVG
// mirror of the scene the importer makes from it. They should match. This checks the importer
// against the drawing with no browser. It cannot see Lottie differences; the e2e tests do that.
const ART = join(__dirname, '..', '..', 'author', 'test', 'fixtures', 'art');
const REFUSED = /^(unsupported-|mixed-opacity|clip-)/;
/**
 * Drawings the importer knows it draws differently, with the reason. styles: a fill and a stroke
 * that are both see-through are faded as one picture, so the fill no longer shows through the
 * inner half of the stroke. That predates gradients, and belongs in docs/SNAGGING.md.
 */
const KNOWN_GAPS = new Set(['styles']);
const accepted = readdirSync(ART)
  .filter(
    (name) => name.endsWith('.svg') && !REFUSED.test(name) && !KNOWN_GAPS.has(name.slice(0, -4))
  )
  .map((name) => name.slice(0, -4))
  .toSorted();

const WIDTH = 400;
const render = (svg: string) =>
  new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: { loadSystemFonts: false },
  }).render().pixels;

describe('the SVG mirror draws each accepted drawing as the drawing does', () => {
  it('has drawings to check', () => {
    expect(accepted.length).toBeGreaterThan(10);
  });

  it.each(accepted)('%s', (name) => {
    const original = readFileSync(join(ART, `${name}.svg`), 'utf8');
    const box = (/viewBox="([^"]+)"/.exec(original)?.[1] ?? '').split(/[\s,]+/).map(Number);
    const size: [number, number] = [box[2], box[3]];
    const model = compileScene(
      scene(name, (ctx) => ctx.add(ctx.art(name, { at: [0, 0] }))),
      {
        size,
        lines: [],
        duration: 1,
        loaders: {
          svg: (art) => readFileSync(join(ART, `${art}.svg`), 'utf8'),
          font: () => {
            throw new Error('no font');
          },
        },
      }
    );
    const want = render(original);
    const got = render(svgAt(model, 0));
    expect(got.length).toBe(want.length);
    let differ = 0;
    for (let n = 0; n < want.length; n += 4) {
      for (let c = 0; c < 4; c++) {
        if (Math.abs(want[n + c] - got[n + c]) > 2) {
          differ++;
          break;
        }
      }
    }
    expect(differ / (want.length / 4)).toBeLessThanOrEqual(0.002);
  });
});

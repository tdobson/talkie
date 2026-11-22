import { gzipSync } from 'node:zlib';
import { compileScene, emitLottie, importSvg, scene, type SceneContext } from '../src/index';

// A soft ground shadow under a card, drawn three ways. One radial gradient should cost less than
// stacked flat copies, before and after gzip. The numbers are not pinned, only the order.
const SIZE: [number, number] = [1920, 1080];
const card = (ctx: SceneContext) => ctx.rect(760, 340, 400, 300, { fill: '#ffffff' }, 'card');

const sizes = (build: (ctx: SceneContext) => void) => {
  const json = JSON.stringify(
    emitLottie(compileScene(scene('shadow', build), { size: SIZE, lines: [], duration: 2 }))
  );
  return { raw: json.length, gzip: gzipSync(json).length };
};

const ellipse = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

describe('soft shadow size', () => {
  const copies = sizes((ctx) => {
    for (let n = 0; n < 8; n++) {
      const copy = ctx.path(
        ellipse(960, 680, 230 - n * 8, 40 - n * 2),
        { fill: '#000000' },
        `copy ${n}`
      );
      copy.transform.opacity = 6;
      ctx.add(copy);
    }
    ctx.add(card(ctx));
  });
  const rings = sizes((ctx) => {
    for (let n = 0; n < 12; n++) {
      const shade = Math.round(255 - (n + 1) * 6)
        .toString(16)
        .padStart(2, '0');
      ctx.add(
        ctx.path(
          ellipse(960, 680, 230 - n * 15, 40 - n * 2.6),
          { fill: `#${shade}${shade}${shade}` },
          `ring ${n}`
        )
      );
    }
    ctx.add(card(ctx));
  });
  const gradient = sizes((ctx) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><defs><radialGradient id="soft">' +
      '<stop offset="0" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/>' +
      '</radialGradient></defs><ellipse id="shadow" cx="960" cy="680" rx="230" ry="40" fill="url(#soft)"/></svg>';
    const art = importSvg(svg, 'shadow');
    ctx.add(ctx.node('shadow', art.children[0].items), card(ctx));
  });

  it('is smaller as one radial gradient than as stacked copies or rings, raw and gzipped', () => {
    expect(gradient.raw).toBeLessThan(copies.raw);
    expect(gradient.gzip).toBeLessThan(copies.gzip);
    expect(gradient.raw).toBeLessThan(rings.raw);
    expect(gradient.gzip).toBeLessThan(rings.gzip);
  });
});

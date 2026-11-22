import { gzipSync } from 'node:zlib';
import { compileScene, emitLottie, importSvg, scene, type SceneDef } from '../src/index';

// A soft ground shadow, alone on the stage, drawn two ways: as stacked flat copies of an ellipse,
// the way blurred shadows are drawn without gradients, and as one ellipse with a radial gradient
// that fades out. The jest size test and the e2e picture test both use these.

export const SHADOW_STAGE: [number, number] = [960, 540];
const CX = 480;
const CY = 300;
const RX = 230;
const RY = 40;
/** How dark the middle of the shadow is, 0 to 1. */
export const SHADOW_PEAK = 0.45;

const ellipse = (rx: number, ry: number) =>
  `M${CX - rx} ${CY}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;

/**
 * `copies` black ellipses, each smaller than the last in equal steps: copy k (0 is the biggest)
 * has (copies - k) / copies of the full size. Every copy has the same opacity, chosen so the
 * middle, where all of them overlap, comes to SHADOW_PEAK.
 */
export const stackedShadow = (copies: number): SceneDef =>
  scene(`shadow-${copies}-copies`, (ctx) => {
    const each = 1 - (1 - SHADOW_PEAK) ** (1 / copies);
    for (let k = 0; k < copies; k++) {
      const share = (copies - k) / copies;
      const copy = ctx.path(ellipse(RX * share, RY * share), { fill: '#000000' }, `copy ${k}`);
      copy.transform.opacity = Math.round(each * 10000) / 100;
      ctx.add(copy);
    }
  });

/** The same shadow as one ellipse with a radial gradient, from SHADOW_PEAK in the middle to 0. */
export const SHADOW_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHADOW_STAGE[0]} ${SHADOW_STAGE[1]}">` +
  '<defs><radialGradient id="soft">' +
  `<stop offset="0" stop-color="#000" stop-opacity="${SHADOW_PEAK}"/>` +
  '<stop offset="1" stop-color="#000" stop-opacity="0"/>' +
  `</radialGradient></defs><ellipse id="shadow" cx="${CX}" cy="${CY}" rx="${RX}" ry="${RY}" fill="url(#soft)"/></svg>`;

export const gradientShadow = (): SceneDef =>
  scene('shadow-gradient', (ctx) => {
    const art = importSvg(SHADOW_SVG, 'shadow.svg');
    ctx.add(ctx.node('shadow', art.children[0].items));
  });

/** The scene JSON, as the build writes it (no spaces), and its size raw and gzipped. */
export function shadowScene(def: SceneDef): { json: string; raw: number; gzip: number } {
  const json = JSON.stringify(
    emitLottie(compileScene(def, { size: SHADOW_STAGE, lines: [], duration: 2 }))
  );
  return { json, raw: Buffer.byteLength(json), gzip: gzipSync(json).length };
}

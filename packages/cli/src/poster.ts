import { Resvg } from '@resvg/resvg-js';

/** Width of `poster.png` in pixels. The height follows the film's shape. */
export const POSTER_WIDTH = 1280;

/**
 * Rasterise the poster SVG to a PNG 1280 pixels wide. Labels are outlines already, so no system
 * font is loaded and the same SVG gives the same picture on every machine.
 */
export function rasterisePoster(svg: string): Uint8Array {
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: POSTER_WIDTH },
    font: { loadSystemFonts: false },
  })
    .render()
    .asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}

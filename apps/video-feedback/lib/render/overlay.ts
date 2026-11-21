import type { Rect } from '@/lib/types';

// Pure SVG builders. All coordinates are output pixels unless a function says otherwise.
// Each builder returns a fragment; overlaySvg() wraps fragments into one document that sharp
// can composite over a frame.

export interface Point {
  x: number;
  y: number;
}

export const AMBER = '#ffb300';
export const CYAN = '#00bcd4';
const DARK = '#111111';
const WHITE = '#ffffff';

const n = (v: number): string => String(Math.round(v * 100) / 100);

// Arrow outline as fractions of `size`, starting at the tip and going clockwise.
const ARROW: [number, number][] = [
  [0, 0],
  [0, 0.72],
  [0.2, 0.56],
  [0.33, 0.86],
  [0.45, 0.81],
  [0.32, 0.51],
  [0.52, 0.51],
];

/** White arrow with a dark outline and a soft shadow, tip at (x, y). */
export function pointerSvg(x: number, y: number, size: number): string {
  const d = `${ARROW.map(([ax, ay], i) => `${i === 0 ? 'M' : 'L'}${n(x + ax * size)},${n(y + ay * size)}`).join(' ')} Z`;
  const off = n(size / 12);
  const blur = n(size / 16);
  return (
    `<g>` +
    `<defs><filter id="ptr-shadow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feGaussianBlur stdDeviation="${blur}"/></filter></defs>` +
    `<path d="${d}" transform="translate(${off} ${off})" fill="#000000" fill-opacity="0.45" filter="url(#ptr-shadow)"/>` +
    `<path d="${d}" fill="${WHITE}" stroke="${DARK}" stroke-width="${n(size / 16)}" stroke-linejoin="round"/>` +
    `</g>`
  );
}

function parseHex(colour: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  if (!m) return [255, 255, 255];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function mix(a: [number, number, number], b: [number, number, number], k: number): string {
  return `#${a
    .map((v, i) =>
      Math.round(v + (b[i] - v) * k)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/**
 * Pointer path through `points`. With `fade`, the line runs from a light tint of the colour at
 * the start to a dark shade at the end, so the direction of travel can be read from a still.
 */
export function trailSvg(
  points: Point[],
  w: number,
  h: number,
  opts: { fade: boolean; colour: string }
): string {
  if (points.length < 2) return '';
  const width = Math.max(2, Math.round(Math.min(w, h) / 180));
  const path = points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
  const common = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  const under = `<polyline points="${path}" ${common} stroke="${DARK}" stroke-opacity="0.4" stroke-width="${width + 2}"/>`;
  if (!opts.fade) {
    return `<g>${under}<polyline points="${path}" ${common} stroke="${opts.colour}" stroke-width="${width}"/></g>`;
  }
  const base = parseHex(opts.colour);
  const light = parseHex(mix(base, [255, 255, 255], 0.75));
  const dark = parseHex(mix(base, [0, 0, 0], 0.35));
  const last = points.length - 2;
  const lines = points.slice(0, -1).map((p, i) => {
    const k = last === 0 ? 1 : i / last;
    const q = points[i + 1];
    return `<line x1="${n(p.x)}" y1="${n(p.y)}" x2="${n(q.x)}" y2="${n(q.y)}" stroke="${mix(light, dark, k)}" stroke-width="${width}" stroke-linecap="round"/>`;
  });
  return `<g>${under}${lines.join('')}</g>`;
}

/** A ring per click: light ring over a wider dark one, so it shows on any background. */
export function ringsSvg(points: Point[], radius: number): string {
  if (points.length === 0) return '';
  const sw = Math.max(2, Math.round(radius / 5));
  const rings = points.map((p) => {
    const at = `cx="${n(p.x)}" cy="${n(p.y)}" r="${n(radius)}" fill="none"`;
    return (
      `<circle ${at} stroke="${DARK}" stroke-opacity="0.7" stroke-width="${sw + 2}"/>` +
      `<circle ${at} stroke="${WHITE}" stroke-width="${sw}"/>`
    );
  });
  return `<g>${rings.join('')}</g>`;
}

/** Outline of a zoom region. `r` is normalised (0..1); `w` and `h` are the output size. */
export function boxSvg(r: Rect, w: number, h: number): string {
  const sw = Math.max(2, Math.round(Math.min(w, h) / 240));
  const at = `x="${n(r.x * w)}" y="${n(r.y * h)}" width="${n(r.width * w)}" height="${n(r.height * h)}" fill="none"`;
  return (
    `<g>` +
    `<rect ${at} stroke="${DARK}" stroke-opacity="0.7" stroke-width="${sw + 2}"/>` +
    `<rect ${at} stroke="${CYAN}" stroke-width="${sw}" stroke-dasharray="${sw * 4} ${sw * 2}"/>` +
    `</g>`
  );
}

export function overlaySvg(w: number, h: number, parts: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${parts.join('')}</svg>`;
}

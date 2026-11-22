import type { Box } from './evaluate';
import type { BezierPath, Gradient, Matrix, Paint, RadialGradient, Vec } from './model';

/** Rounds to 3 decimals, and never gives a negative zero. */
export const round3 = (x: number): number => {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r;
};

/**
 * Reads a #rgb or #rrggbb colour as [r, g, b] in 0 to 1. Gives null for no paint (undefined or
 * "none"). Throws on anything else, so a colour is never drawn differently from how it was written.
 */
export function parseColour(colour: string | undefined, where: string): number[] | null {
  if (colour === undefined || colour === 'none') {
    return null;
  }
  const parts = hexParts(colour);
  if (!parts) {
    throw new Error(`${where}: cannot use colour "${colour}", write it as #rrggbb`);
  }
  return parts.map((part) => round3(parseInt(part, 16) / 255));
}

function hexParts(colour: unknown): string[] | null {
  if (typeof colour !== 'string') {
    return null;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(colour);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  return short ? short.slice(1).map((c) => c + c) : (long?.slice(1) ?? null);
}

/** A flat paint as [r, g, b], or null for none. Throws on a gradient, which has no single colour. */
export function flatColour(paint: Paint | undefined, where: string): number[] | null {
  if (isGradient(paint)) {
    throw new Error(`${where}: a gradient cannot be drawn here`);
  }
  return parseColour(paint, where);
}

/** True for a paint that is a gradient rather than a flat colour. */
export const isGradient = (paint: Paint | undefined): paint is Gradient =>
  typeof paint === 'object' && paint !== null;

/** True for a paint that draws something: a colour other than "none", or a gradient. */
export const hasPaint = (paint: Paint | undefined): boolean =>
  paint !== undefined && paint !== 'none';

/** True for a radial gradient that an item stretches into an ellipse. */
export const isStretched = (paint: Paint | undefined): paint is RadialGradient =>
  isGradient(paint) && paint.type === 'radial' && paint.matrix !== undefined;

const det = (m: Matrix) => m[0] * m[3] - m[1] * m[2];

/** The inverse of an affine matrix, or null when it squashes the plane flat. */
export function invert(m: Matrix): Matrix | null {
  const d = det(m);
  const size = Math.max(Math.abs(m[0]), Math.abs(m[1]), Math.abs(m[2]), Math.abs(m[3]));
  if (!Number.isFinite(d) || size === 0 || Math.abs(d) <= 1e-12 * size * size) {
    return null;
  }
  const [a, b, c, dd, e, f] = m;
  return [dd / d, -b / d, -c / d, a / d, (c * f - dd * e) / d, (b * e - a * f) / d];
}

/** Maps a point by a matrix. */
export const applyMatrix = (m: Matrix, [x, y]: Vec): Vec => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

/**
 * The linear part of a matrix taken apart as rotation(rotation), scale(s1, s2), rotation(turn),
 * applied right to left. s1 is at least |s2|, and a reflection is carried in the sign of s2.
 * Angles are in radians, in the same sense as an SVG rotate().
 */
export interface Frame {
  rotation: number;
  s1: number;
  s2: number;
  turn: number;
}

/** A closed form singular value decomposition of the linear part of m. */
export function radialFrame(m: Matrix): Frame {
  const [a, b, c, d] = m;
  const e = (a + d) / 2;
  const f = (a - d) / 2;
  const g = (b + c) / 2;
  const h = (b - c) / 2;
  const q = Math.hypot(e, h);
  const r = Math.hypot(f, g);
  const a1 = Math.atan2(g, f);
  const a2 = Math.atan2(h, e);
  return { rotation: (a2 + a1) / 2, s1: q + r, s2: q - r, turn: (a2 - a1) / 2 };
}

/**
 * True when m maps a circle of radius r to something no more than 1e-3 away from a circle: the
 * longest and shortest stretches of m differ by less than that over r.
 */
export function isNearSimilarity(m: Matrix, r: number): boolean {
  const { s1, s2 } = radialFrame(m);
  return (s1 - Math.abs(s2)) * Math.abs(r) < 1e-3;
}

/** The roots in 0 < t < 1 of a t^2 + b t + c. */
function roots01(a: number, b: number, c: number): number[] {
  const out: number[] = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      out.push(-c / b);
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      out.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** The exact bounding box of the paths, from the extremes of each curve. null for no points. */
export function tightBox(paths: BezierPath[]): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const path of paths) {
    const count = path.v.length;
    path.v.forEach(([x, y]) => add(x, y));
    const segments = path.closed ? count : count - 1;
    for (let n = 0; n < segments; n++) {
      const m = (n + 1) % count;
      const p0 = path.v[n];
      const p1: Vec = [p0[0] + path.o[n][0], p0[1] + path.o[n][1]];
      const p3 = path.v[m];
      const p2: Vec = [p3[0] + path.i[m][0], p3[1] + path.i[m][1]];
      for (const axis of [0, 1]) {
        const d0 = p1[axis] - p0[axis];
        const d1 = p2[axis] - p1[axis];
        const d2 = p3[axis] - p2[axis];
        for (const t of roots01(d0 - 2 * d1 + d2, 2 * (d1 - d0), d0)) {
          const u = 1 - t;
          const at = (k: 0 | 1) =>
            u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k];
          add(at(0), at(1));
        }
      }
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * A linear gradient from p1 to p2 in gradient space, as two points in the space m maps to. Exact
 * under any affine m: lines of one colour stay parallel, so the gradient runs at right angles to
 * them from the image of p1 to the line through the image of p2. null when m is flat.
 */
export function bakeLinear(p1: Vec, p2: Vec, m: Matrix): { from: Vec; to: Vec } | null {
  const from = applyMatrix(m, p1);
  const end = applyMatrix(m, p2);
  const d: Vec = [p2[0] - p1[0], p2[1] - p1[1]];
  // The direction of the lines of one colour, mapped into item space.
  const along: Vec = [m[0] * -d[1] + m[2] * d[0], m[1] * -d[1] + m[3] * d[0]];
  const size = Math.hypot(along[0], along[1]);
  if (size === 0) {
    return null;
  }
  const u: Vec = [-along[1] / size, along[0] / size];
  const reach = (end[0] - from[0]) * u[0] + (end[1] - from[1]) * u[1];
  if (!Number.isFinite(reach) || Math.abs(reach) < 1e-12) {
    return null;
  }
  return { from, to: [from[0] + reach * u[0], from[1] + reach * u[1]] };
}

/** One stop as both emitters write it, so the film and its SVG mirror use the same numbers. */
export interface StopOut {
  offset: number;
  colour: string;
  /** The colour as round3(channel / 255), as Lottie stores it. */
  rgb: number[];
  opacity: number;
}

/** The stops rounded once, for both emitters. The stops must have passed checkGradient. */
export function stopsOut(stops: Gradient['stops']): StopOut[] {
  return stops.map((stop) => {
    const parts = hexParts(stop.colour) as string[];
    return {
      offset: round3(stop.offset),
      colour: `#${parts.join('').toLowerCase()}`,
      rgb: parts.map((part) => round3(parseInt(part, 16) / 255)),
      opacity: round3(stop.opacity),
    };
  });
}

const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

/**
 * Throws unless the gradient can be drawn exactly as written: at least 2 stops, offsets 0 to 1
 * that never fall, #rrggbb colours, opacities 0 to 1, finite points, and for a radial gradient a
 * radius above 0, a focal point inside 0.99 of the radius and a matrix that is not flat.
 */
export function checkGradient(g: Gradient, where: string): void {
  const fail = (reason: string): never => {
    throw new Error(`${where}: its gradient ${reason}`);
  };
  if (!Array.isArray(g.stops) || g.stops.length < 2) {
    fail('needs at least 2 stops');
  }
  g.stops.forEach((stop, n) => {
    if (!finite(stop.offset) || stop.offset < 0 || stop.offset > 1) {
      fail(`offsets must be 0 to 1, got ${stop.offset}`);
    }
    if (n > 0 && stop.offset < g.stops[n - 1].offset) {
      fail(`offsets must not fall, got ${g.stops[n - 1].offset} then ${stop.offset}`);
    }
    if (!hexParts(stop.colour)) {
      fail(`cannot use colour "${stop.colour}", write it as #rrggbb`);
    }
    if (!finite(stop.opacity) || stop.opacity < 0 || stop.opacity > 1) {
      fail(`stop opacity must be 0 to 1, got ${stop.opacity}`);
    }
  });
  if (g.type === 'linear') {
    if (!finite(...g.from, ...g.to)) {
      fail('needs finite numbers for from and to');
    }
    if (g.from[0] === g.to[0] && g.from[1] === g.to[1]) {
      fail('has from and to at the same point, so it has no direction');
    }
    return;
  }
  if (g.type !== 'radial') {
    fail(`has type "${(g as { type: unknown }).type}", which is not linear or radial`);
  }
  if (!finite(...g.centre, ...g.focal, g.radius)) {
    fail('needs finite numbers for centre, focal and radius');
  }
  if (g.radius <= 0) {
    fail(`needs a radius above 0, got ${g.radius}`);
  }
  const reach = Math.hypot(g.focal[0] - g.centre[0], g.focal[1] - g.centre[1]);
  if (reach >= 0.99 * g.radius) {
    fail('has its focal point on or outside the circle, which cannot be drawn. Move it inside');
  }
  if (g.matrix !== undefined && (!finite(...g.matrix) || invert(g.matrix) === null)) {
    fail('has a matrix that is squashed flat, so it cannot be drawn');
  }
}

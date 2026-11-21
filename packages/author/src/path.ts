import svgpath from 'svgpath';
import type { BezierPath, Vec } from './model';

export type Matrix = [number, number, number, number, number, number];

const same = (a: Vec, b: Vec) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Parses SVG path data into cubic Bezier paths, one per subpath. Throws on data it cannot read. */
export function parsePathD(d: string): BezierPath[] {
  const parsed = svgpath(d).abs().unarc().unshort();
  const { err } = parsed as unknown as { err?: string };
  if (err) {
    throw new Error(`cannot read path data "${d}": ${err}`);
  }
  const out: BezierPath[] = [];
  let cur: BezierPath | null = null;
  let start: Vec = [0, 0];
  let at: Vec = [0, 0];

  const open = (p: Vec): BezierPath => {
    const path: BezierPath = { closed: false, v: [[p[0], p[1]]], i: [[0, 0]], o: [[0, 0]] };
    out.push(path);
    start = [p[0], p[1]];
    return path;
  };
  /** Adds a cubic segment from the current point. c1 and c2 are absolute control points. */
  const cubic = (c1: Vec, c2: Vec, p: Vec) => {
    const path = cur ?? open(at);
    cur = path;
    path.o[path.o.length - 1] = [c1[0] - at[0], c1[1] - at[1]];
    path.v.push([p[0], p[1]]);
    path.i.push([c2[0] - p[0], c2[1] - p[1]]);
    path.o.push([0, 0]);
    at = [p[0], p[1]];
  };
  const close = (path: BezierPath) => {
    path.closed = true;
    const last = path.v.length - 1;
    // A path that already returned to its start keeps one vertex there, not two.
    if (last > 0 && same(path.v[last], path.v[0])) {
      path.i[0] = path.i[last];
      path.v.pop();
      path.i.pop();
      path.o.pop();
    }
  };

  parsed.iterate((seg) => {
    switch (seg[0]) {
      case 'M':
        at = [seg[1], seg[2]];
        cur = open(at);
        break;
      case 'L':
        cubic(at, [seg[1], seg[2]], [seg[1], seg[2]]);
        break;
      case 'H':
        cubic(at, [seg[1], at[1]], [seg[1], at[1]]);
        break;
      case 'V':
        cubic(at, [at[0], seg[1]], [at[0], seg[1]]);
        break;
      case 'C':
        cubic([seg[1], seg[2]], [seg[3], seg[4]], [seg[5], seg[6]]);
        break;
      case 'Q': {
        const q: Vec = [seg[1], seg[2]];
        const p: Vec = [seg[3], seg[4]];
        cubic(
          [at[0] + (2 / 3) * (q[0] - at[0]), at[1] + (2 / 3) * (q[1] - at[1])],
          [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])],
          p
        );
        break;
      }
      case 'Z':
      case 'z':
        if (cur) {
          close(cur);
        }
        cur = null;
        at = [start[0], start[1]];
        break;
      default:
        throw new Error(`cannot convert path command "${seg[0]}" in "${d}"`);
    }
  });
  return out;
}

/** Bakes an affine matrix [a, b, c, d, e, f] into the points and tangents of each path. */
export function transformPaths(paths: BezierPath[], matrix: Matrix): BezierPath[] {
  const [a, b, c, d, e, f] = matrix;
  const point = ([x, y]: Vec): Vec => [a * x + c * y + e, b * x + d * y + f];
  const tangent = ([x, y]: Vec): Vec => [a * x + c * y, b * x + d * y];
  return paths.map((p) => ({
    closed: p.closed,
    v: p.v.map(point),
    i: p.i.map(tangent),
    o: p.o.map(tangent),
  }));
}

import { easeAt } from './ease';
import type { AnimProp, BezierPath, Node, SceneModel, Track, Transform, Vec } from './model';
import type { Matrix } from './path';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * The value of a track at t seconds: the first key's value before it, the last key's value after it
 * and an eased blend between. A missing or empty track gives base.
 */
export function valueAt<V extends number | Vec>(track: Track | undefined, base: V, t: number): V {
  const keys = track?.keys ?? [];
  if (keys.length === 0) {
    return base;
  }
  if (t <= keys[0].t) {
    return keys[0].v as V;
  }
  const last = keys[keys.length - 1];
  if (t >= last.t) {
    return last.v as V;
  }
  let n = 0;
  while (keys[n + 1].t <= t) {
    n++;
  }
  const from = keys[n];
  const to = keys[n + 1];
  const k = easeAt(from.ease, (t - from.t) / (to.t - from.t));
  if (typeof from.v === 'number' || typeof to.v === 'number') {
    return lerp(from.v as number, to.v as number, k) as V;
  }
  return [lerp(from.v[0], to.v[0], k), lerp(from.v[1], to.v[1], k)] as V;
}

export const trackOf = (node: Node, prop: AnimProp): Track | undefined =>
  node.tracks.find((track) => track.prop === prop);

/** The node's transform at t seconds. */
export function transformAt(node: Node, t: number): Transform {
  const base = node.transform;
  return {
    position: valueAt(trackOf(node, 'position'), base.position, t),
    anchor: base.anchor,
    scale: valueAt(trackOf(node, 'scale'), base.scale, t),
    rotation: valueAt(trackOf(node, 'rotation'), base.rotation, t),
    opacity: valueAt(trackOf(node, 'opacity'), base.opacity, t),
  };
}

/** How much of the node's strokes is drawn at t seconds, 0 to 100. Always 100 for an untrimmed node. */
export function trimAt(node: Node, t: number): number {
  return node.trimmed ? valueAt(trackOf(node, 'trimEnd'), 100, t) : 100;
}

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** m then n: applies n first, as nested SVG groups do with m outside. */
export function multiply(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/** The affine matrix of a transform: translate(position) rotate scale translate(-anchor). */
export function matrixOf(tr: Transform): Matrix {
  const rad = (tr.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sx = tr.scale[0] / 100;
  const sy = tr.scale[1] / 100;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return [
    a,
    b,
    c,
    d,
    tr.position[0] - a * tr.anchor[0] - c * tr.anchor[1],
    tr.position[1] - b * tr.anchor[0] - d * tr.anchor[1],
  ];
}

function pathPoints(path: BezierPath): Vec[] {
  const out: Vec[] = [];
  path.v.forEach(([x, y], n) => {
    out.push([x, y], [x + path.i[n][0], y + path.i[n][1]], [x + path.o[n][0], y + path.o[n][1]]);
  });
  return out;
}

function collect(node: Node, t: number, outer: Matrix, own: boolean, out: Vec[]): void {
  const m = own ? multiply(outer, matrixOf(transformAt(node, t))) : outer;
  for (const item of node.items) {
    for (const path of item.paths) {
      for (const [x, y] of pathPoints(path)) {
        out.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      }
    }
  }
  for (const child of node.children) {
    collect(child, t, m, true, out);
  }
}

function boxOf(points: Vec[]): Box | null {
  if (points.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The node's bounding box at t seconds in its parent's coordinates, from path vertices and tangent
 * control points after the node's and its children's transforms. Stroke width is not counted.
 * null for a node with no paths.
 */
export function bboxAt(node: Node, t: number): Box | null {
  const points: Vec[] = [];
  collect(node, t, IDENTITY, true, points);
  return boxOf(points);
}

/** As bboxAt, but in the node's own coordinates: its own transform is not applied. */
export function localBboxAt(node: Node, t: number): Box | null {
  const points: Vec[] = [];
  collect(node, t, IDENTITY, false, points);
  return boxOf(points);
}

const sameValue = (a: number | Vec, b: number | Vec) =>
  typeof a === 'number' || typeof b === 'number' ? a === b : a[0] === b[0] && a[1] === b[1];

function nodeActive(node: Node, t: number): boolean {
  const moving = node.tracks.some((track) =>
    track.keys.some((key, n) => {
      const next = track.keys[n + 1];
      return next !== undefined && key.t <= t && t < next.t && !sameValue(key.v, next.v);
    })
  );
  return moving || node.children.some((child) => nodeActive(child, t));
}

/** True if anything in the scene is moving at t seconds: some track has a changing segment spanning t. */
export function activeAt(model: SceneModel, t: number): boolean {
  return nodeActive(model.camera, t) || model.nodes.some((node) => nodeActive(node, t));
}

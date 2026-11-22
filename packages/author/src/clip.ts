import { IDENTITY, matrixOf, multiply, transformAt } from './evaluate';
import type { BezierPath, Node, Vec } from './model';
import { hasPaint, radialFrame } from './paint';
import type { Matrix } from './path';

const label = (node: Node) => `"${node.name}" (${node.id})`;

/** The corners of a contour that is an axis-aligned rectangle of four straight sides, else null. */
function rectangle(path: BezierPath): [number, number, number, number] | null {
  const flat = (t: Vec) => t[0] === 0 && t[1] === 0;
  if (path.v.length !== 4 || !path.i.every(flat) || !path.o.every(flat)) {
    return null;
  }
  const xs = path.v.map((v) => v[0]);
  const ys = path.v.map((v) => v[1]);
  const [x1, x2, y1, y2] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const corners = new Set(
    path.v.map(([x, y]) => `${x === x1 ? 0 : x === x2 ? 1 : 2},${y === y1 ? 0 : y === y2 ? 1 : 2}`)
  );
  const square = ['0,0', '1,0', '1,1', '0,1'].every((corner) => corners.has(corner));
  // Each side runs along x or along y, so the four points go round the rectangle in order.
  const sides = path.v.every((v, n) => {
    const w = path.v[(n + 1) % 4];
    return v[0] === w[0] || v[1] === w[1];
  });
  return square && sides && x2 > x1 && y2 > y1 ? [x1, y1, x2, y2] : null;
}

/** True when a node or anything under it has a track. */
const moves = (node: Node): boolean => node.tracks.length > 0 || node.children.some(moves);

/**
 * The points of a node's subtree in the node's own frame, at rest, and how far a stroke reaches
 * past them: twice the widest stroke, which covers a miter limit of 4 and every cap.
 */
function reach(node: Node): { points: Vec[]; grow: number } {
  const points: Vec[] = [];
  let grow = 0;
  const walk = (n: Node, m: Matrix) => {
    for (const item of n.items) {
      for (const path of item.paths) {
        path.v.forEach(([x, y], k) => {
          for (const [dx, dy] of [[0, 0], path.i[k], path.o[k]]) {
            const px = x + dx;
            const py = y + dy;
            points.push([m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]]);
          }
        });
      }
      if (hasPaint(item.style.stroke)) {
        grow = Math.max(grow, 2 * (item.style.strokeWidth ?? 1) * radialFrame(m).s1);
      }
    }
    for (const child of n.children) {
      walk(child, multiply(m, matrixOf(transformAt(child, 0))));
    }
  };
  walk(node, IDENTITY);
  return { points, grow };
}

/**
 * The clip a node is drawn with, or undefined when it has none. A clip that provably cuts nothing
 * is dropped: one rectangle, square to the node, round a subtree that does not move inside the
 * node and that stays inside it with every stroke at full reach. Figma wraps each export in such a
 * clip. The film and its SVG mirror both use this, so they always agree.
 */
export function effectiveClip(node: Node): BezierPath[] | undefined {
  const clip = node.clip;
  if (clip === undefined) {
    return undefined;
  }
  if (clip.length === 0) {
    throw new Error(`node ${label(node)} has a clip with no contours`);
  }
  const box = clip.length === 1 ? rectangle(clip[0]) : null;
  if (!box || node.children.some(moves)) {
    return clip;
  }
  const { points, grow } = reach(node);
  const inside = points.every(
    ([x, y]) => x - grow >= box[0] && y - grow >= box[1] && x + grow <= box[2] && y + grow <= box[3]
  );
  return inside ? undefined : clip;
}

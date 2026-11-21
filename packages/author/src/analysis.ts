import { bboxAt, matrixOf, transformAt } from './evaluate';
import type { Node, SceneModel, Vec } from './model';

/** A stretch of scene time, in seconds. */
export interface Span {
  start: number;
  end: number;
}

const sameValue = (a: number | Vec, b: number | Vec) =>
  typeof a === 'number' || typeof b === 'number' ? a === b : a[0] === b[0] && a[1] === b[1];

function eachNode(model: SceneModel, visit: (node: Node) => void): void {
  const walk = (node: Node) => {
    visit(node);
    node.children.forEach(walk);
  };
  walk(model.camera);
  model.nodes.forEach(walk);
}

/**
 * The stretches of the scene in which nothing moves: no track of any node, nor of the camera, has a
 * changing segment there. In time order. These are the times at which `activeAt` is false.
 */
export function stillSpans(model: SceneModel): Span[] {
  const moving: Span[] = [];
  eachNode(model, (node) => {
    for (const track of node.tracks) {
      track.keys.forEach((key, n) => {
        const next = track.keys[n + 1];
        if (next !== undefined && next.t > key.t && !sameValue(key.v, next.v)) {
          moving.push({ start: key.t, end: next.t });
        }
      });
    }
  });
  moving.sort((a, b) => a.start - b.start || a.end - b.end);

  const still: Span[] = [];
  let at = 0;
  for (const span of moving) {
    const start = Math.min(span.start, model.duration);
    if (start > at) {
      still.push({ start: at, end: start });
    }
    at = Math.max(at, Math.min(span.end, model.duration));
  }
  if (model.duration > at) {
    still.push({ start: at, end: model.duration });
  }
  return still;
}

/** A top level node that reaches into the band. */
export interface BandHit {
  id: string;
  name: string;
  /** The first key time at which the node is in the band, in scene seconds. */
  t: number;
  /** How far down the stage the node reaches at that time. */
  bottom: number;
}

/**
 * The top level nodes whose bounding box, children and camera included, reaches below `band.y` at
 * a key time: the scene start, its end, or the time of any key of any track. The foot of the stage
 * is kept for captions, so art should stay above it. A node is passed over at a time when its own
 * opacity, or the camera's, is 0. A background, which is a node that covers the whole stage, is
 * not art and is passed over too: captions are drawn on top of it. In draw order, each node once.
 */
export function outOfBand(model: SceneModel, band: { y: number }): BandHit[] {
  const times = new Set<number>([0, model.duration]);
  eachNode(model, (node) => {
    for (const track of node.tracks) {
      for (const key of track.keys) {
        if (key.t >= 0 && key.t <= model.duration) {
          times.add(key.t);
        }
      }
    }
  });
  const ordered = [...times].toSorted((a, b) => a - b);

  const hits: BandHit[] = [];
  for (const node of model.nodes) {
    for (const t of ordered) {
      const camera = transformAt(model.camera, t);
      if (camera.opacity === 0 || transformAt(node, t).opacity === 0) {
        continue;
      }
      const box = bboxAt(node, t);
      if (!box) {
        break;
      }
      const [w, h] = model.size;
      if (box.x <= 0 && box.y <= 0 && box.x + box.width >= w && box.y + box.height >= h) {
        continue;
      }
      const m = matrixOf(camera);
      const bottom = Math.max(
        ...[box.x, box.x + box.width].flatMap((x) =>
          [box.y, box.y + box.height].map((y) => m[1] * x + m[3] * y + m[5])
        )
      );
      if (bottom > band.y) {
        hits.push({ id: node.id, name: node.name, t, bottom });
        break;
      }
    }
  }
  return hits;
}

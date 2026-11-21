import {
  identity,
  type AnimProp,
  type BezierPath,
  type Ease,
  type Node,
  type PlannedLine,
  type SceneModel,
  type ShapeItem,
  type Style,
  type Vec,
} from './model';
import * as motion from './motion';
import { TimingError, type MotionState } from './motion';
import { parsePathD } from './path';

export interface SceneContext {
  /** Seconds at which a voice line starts, plus offset. Throws on an unknown id. */
  T(lineId: string, offset?: number): number;
  node(name: string, items?: ShapeItem[], children?: Node[]): Node;
  path(d: string, style: Style, name?: string): Node;
  rect(x: number, y: number, w: number, h: number, style: Style, name?: string): Node;
  line(from: Vec, to: Vec, style: Style, name?: string): Node;
  circle(c: Vec, r: number, style: Style, name?: string): Node;
  group(name: string, children: Node[]): Node;
  /** Puts nodes on the top level, in draw order (the first is at the back). */
  add(...nodes: Node[]): void;
  fade(n: Node, at: number, o?: { dur?: number; from?: number; to?: number; ease?: Ease }): void;
  rise(n: Node, at: number, o?: { dur?: number; dy?: number }): void;
  pop(n: Node, at: number, o?: { dur?: number }): void;
  draw(n: Node, at: number, dur?: number): void;
  tween(n: Node, prop: AnimProp, keys: Array<{ t: number; v: number | Vec; ease?: Ease }>): void;
  camera(at: number, o?: { dur?: number; scaleTo?: number; origin?: Vec }): void;
}
export interface SceneDef {
  id: string;
  build: (ctx: SceneContext) => void;
}
export const scene = (id: string, build: SceneDef['build']): SceneDef => ({ id, build });

export interface CompileInput {
  size: [number, number];
  lines: PlannedLine[];
  duration: number;
}

/** Control point distance for a quarter circle of radius 1. */
const KAPPA = 0.5522847498307936;

function circlePath([cx, cy]: Vec, r: number): BezierPath {
  const k = r * KAPPA;
  return {
    closed: true,
    v: [
      [cx, cy - r],
      [cx + r, cy],
      [cx, cy + r],
      [cx - r, cy],
    ],
    i: [
      [-k, 0],
      [0, -k],
      [k, 0],
      [0, k],
    ],
    o: [
      [k, 0],
      [0, k],
      [-k, 0],
      [0, -k],
    ],
  };
}

const polyline = (points: Vec[], closed: boolean): BezierPath => ({
  closed,
  v: points.map(([x, y]): Vec => [x, y]),
  i: points.map((): Vec => [0, 0]),
  o: points.map((): Vec => [0, 0]),
});

/** Runs a scene's build function and returns the model the emitters read. */
export function compileScene(def: SceneDef, input: CompileInput): SceneModel {
  const [w, h] = input.size;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error(`scene ${def.id}: size must be whole positive numbers, got ${w} x ${h}`);
  }
  if (!Number.isFinite(input.duration) || input.duration <= 0) {
    throw new Error(`scene ${def.id}: duration must be a positive number of seconds`);
  }
  const lines = new Map(input.lines.map((line) => [line.id, line]));
  const created: Node[] = [];
  const top: Node[] = [];
  const blank = (id: string, name: string, items: ShapeItem[], children: Node[]): Node => ({
    id,
    name,
    items,
    children,
    transform: identity(),
    tracks: [],
    trimmed: false,
  });
  const make = (name: string, items: ShapeItem[] = [], children: Node[] = []): Node => {
    const n = blank(`n${created.length + 1}`, name, [...items], [...children]);
    created.push(n);
    return n;
  };
  const state: MotionState = {
    size: [w, h],
    duration: input.duration,
    camera: blank('camera', 'camera', [], []),
    spans: new Map(),
  };

  const ctx: SceneContext = {
    T: (lineId, offset = 0) => {
      const line = lines.get(lineId);
      if (!line) {
        throw new TimingError(`scene ${def.id}: no voice line with id "${lineId}"`);
      }
      return line.start + offset;
    },
    node: make,
    path: (d, style, name = 'path') => make(name, [{ paths: parsePathD(d), style: { ...style } }]),
    rect: (x, y, rw, rh, style, name = 'rect') =>
      make(name, [
        {
          paths: [
            polyline(
              [
                [x, y],
                [x + rw, y],
                [x + rw, y + rh],
                [x, y + rh],
              ],
              true
            ),
          ],
          style: { ...style },
        },
      ]),
    line: (from, to, style, name = 'line') =>
      make(name, [{ paths: [polyline([from, to], false)], style: { ...style } }]),
    circle: (c, r, style, name = 'circle') =>
      make(name, [{ paths: [circlePath(c, r)], style: { ...style } }]),
    group: (name, children) => make(name, [], children),
    add: (...nodes) => {
      top.push(...nodes);
    },
    fade: (n, at, o) => motion.fade(state, n, at, o),
    rise: (n, at, o) => motion.rise(state, n, at, o),
    pop: (n, at, o) => motion.pop(state, n, at, o),
    draw: (n, at, dur) => motion.draw(state, n, at, dur),
    tween: (n, prop, keys) => motion.tween(state, n, prop, keys),
    camera: (at, o) => motion.camera(state, at, o),
  };
  def.build(ctx);

  // Every node is drawn exactly once, and nothing animated is left out of the picture.
  const placed = new Set<Node>();
  const visit = (n: Node) => {
    if (placed.has(n)) {
      throw new Error(`scene ${def.id}: node "${n.name}" (${n.id}) is in the scene twice`);
    }
    placed.add(n);
    n.children.forEach(visit);
  };
  top.forEach(visit);
  const lost = created.find((n) => n.tracks.length > 0 && !placed.has(n));
  if (lost) {
    throw new Error(
      `scene ${def.id}: node "${lost.name}" (${lost.id}) is animated but was never added to the scene`
    );
  }

  return {
    id: def.id,
    size: [w, h],
    duration: input.duration,
    fps: 60,
    camera: state.camera,
    nodes: top,
    lines: input.lines.map((line) => ({ ...line })),
  };
}

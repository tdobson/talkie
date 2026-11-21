import { parseColour } from './emit-lottie';
import { assertNoConflict, FactConflictError } from './facts';
import { LABEL_COLOUR, labelPaths, parseFont, type LabelFont, type LabelOptions } from './label';
import type { Loaders } from './loaders';
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
import { importSvg, type ArtNode } from './svg-import';

export interface SceneContext {
  /** Seconds at which a voice line starts, plus offset. Throws on an unknown id. */
  T(lineId: string, offset?: number): number;
  node(name: string, items?: ShapeItem[], children?: Node[]): Node;
  path(d: string, style: Style, name?: string): Node;
  rect(x: number, y: number, w: number, h: number, style: Style, name?: string): Node;
  line(from: Vec, to: Vec, style: Style, name?: string): Node;
  circle(c: Vec, r: number, style: Style, name?: string): Node;
  group(name: string, children: Node[]): Node;
  /**
   * A drawing from the art library, with its top left corner at `at`. Each element of the drawing
   * is a node of its own, named after its id, under the node this returns.
   */
  art(name: string, o: { at: Vec; scale?: number }): Node;
  /** Text drawn as outlines. `at` is on the baseline. Refuses figures the sources disagree about. */
  label(text: string, o: LabelOptions): Node;
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
  /** Where art and the label font come from. A scene that uses neither can leave this out. */
  loaders?: Loaders;
  /** Figures the fact gate refuses to put on screen. */
  conflicts?: string[];
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

  const loaders = (what: string): Loaders => {
    if (!input.loaders) {
      throw new Error(`scene ${def.id}: ${what} needs loaders, and the scene was compiled without`);
    }
    return input.loaders;
  };
  let font: LabelFont | null = null;
  /** Shapes with NaN or Infinity in them draw nothing and break the bounding box sums. */
  const finite = (shape: string, name: string, values: Record<string, number>): void => {
    for (const [key, value] of Object.entries(values)) {
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `scene ${def.id}: ${shape} "${name}" needs finite numbers, got ${key} ${value}`
        );
      }
    }
  };
  const fromArt = (art: ArtNode, name: string): Node => {
    const n = make(
      name,
      art.items,
      art.children.map((child) => fromArt(child, child.name))
    );
    n.transform.opacity = art.opacity;
    return n;
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
    rect: (x, y, rw, rh, style, name = 'rect') => {
      finite('rect', name, { x, y, w: rw, h: rh });
      return make(name, [
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
      ]);
    },
    line: (from, to, style, name = 'line') => {
      finite('line', name, {
        'from[0]': from[0],
        'from[1]': from[1],
        'to[0]': to[0],
        'to[1]': to[1],
      });
      return make(name, [{ paths: [polyline([from, to], false)], style: { ...style } }]);
    },
    circle: (c, r, style, name = 'circle') => {
      finite('circle', name, { 'c[0]': c[0], 'c[1]': c[1], r });
      return make(name, [{ paths: [circlePath(c, r)], style: { ...style } }]);
    },
    group: (name, children) => make(name, [], children),
    art: (name, o) => {
      const { at, scale = 1 } = o;
      if (!Number.isFinite(scale) || scale <= 0) {
        throw new Error(`scene ${def.id}: art("${name}") scale must be above 0, got ${scale}`);
      }
      const svg = loaders(`art("${name}")`).svg(name);
      // Place and scale go into the points, so the node's transform is free for motion.
      return fromArt(importSvg(svg, name, [scale, 0, 0, scale, at[0], at[1]]), name);
    },
    label: (text, o) => {
      try {
        assertNoConflict(text, input.conflicts ?? []);
      } catch (error) {
        if (error instanceof FactConflictError) {
          const message = `scene ${def.id}: label ${error.message}`;
          throw new FactConflictError(error.text, error.conflict, message);
        }
        throw error;
      }
      const fill = o.color ?? LABEL_COLOUR;
      parseColour(fill, `scene ${def.id}: label "${text}"`);
      font ??= parseFont(loaders(`label("${text}")`).font());
      return make(`label ${text}`, [{ paths: labelPaths(font, text, o), style: { fill } }]);
    },
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

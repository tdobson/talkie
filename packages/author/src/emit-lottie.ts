import { HANDLES } from './ease';
import { trackOf } from './evaluate';
import {
  identity,
  type BezierPath,
  type Gradient,
  type Node,
  type Paint,
  type RadialGradient,
  type SceneModel,
  type ShapeItem,
  type Track,
  type Transform,
  type Vec,
} from './model';
import {
  checkGradient,
  flatColour,
  hasPaint,
  isGradient,
  isStretched,
  radialFrame,
  round3,
  stopsOut,
} from './paint';
import type { Matrix } from './path';

export { parseColour, round3 } from './paint';

export interface LottieHandle {
  x: number[];
  y: number[];
}
export interface LottieKeyframe {
  t: number;
  s: number[];
  o?: LottieHandle;
  i?: LottieHandle;
}
export type LottieProp<V> = { a: 0; k: V } | { a: 1; k: LottieKeyframe[] };
export interface LottieTransform {
  p: LottieProp<number[]>;
  a: LottieProp<number[]>;
  s: LottieProp<number[]>;
  r: LottieProp<number>;
  o: LottieProp<number>;
}
export interface LottieBezier {
  c: boolean;
  v: number[][];
  i: number[][];
  o: number[][];
}
/**
 * The geometry and stops of a gradient. t is 1 for linear and 2 for radial. g holds p colour stops
 * [offset, r, g, b], then, when any stop is see-through, p alpha stops [offset, alpha].
 */
export interface LottieGradient {
  t: 1 | 2;
  s: LottieProp<number[]>;
  e: LottieProp<number[]>;
  g: { p: number; k: LottieProp<number[]> };
  h?: LottieProp<number>;
  a?: LottieProp<number>;
}
export type LottieShape =
  | { ty: 'gr'; nm: string; it: LottieShape[] }
  | { ty: 'sh'; nm: string; ks: { a: 0; k: LottieBezier } }
  | {
      ty: 'tm';
      nm: string;
      s: LottieProp<number>;
      e: LottieProp<number>;
      o: LottieProp<number>;
      m: 1;
    }
  | {
      ty: 'st';
      nm: string;
      c: LottieProp<number[]>;
      o: LottieProp<number>;
      w: LottieProp<number>;
      lc: 1 | 2 | 3;
      lj: 1 | 2 | 3;
      ml: number;
    }
  | { ty: 'fl'; nm: string; c: LottieProp<number[]>; o: LottieProp<number>; r: 1 }
  | ({ ty: 'gf'; nm: string; o: LottieProp<number>; r: 1 } & LottieGradient)
  | ({
      ty: 'gs';
      nm: string;
      o: LottieProp<number>;
      w: LottieProp<number>;
      lc: 1 | 2 | 3;
      lj: 1 | 2 | 3;
      ml: number;
    } & LottieGradient)
  | ({ ty: 'tr'; nm: string; sk: LottieProp<number>; sa: LottieProp<number> } & LottieTransform);
export interface LottieLayer {
  ddd: 0;
  ind: number;
  ty: 3 | 4;
  nm: string;
  parent?: number;
  sr: 1;
  ks: LottieTransform;
  ao: 0;
  ip: 0;
  op: number;
  st: 0;
  bm: 0;
  shapes?: LottieShape[];
}
export interface LottieAnimation {
  v: '5.12.0';
  fr: 60;
  ip: 0;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: [];
  layers: LottieLayer[];
}

const FPS = 60;
const LINE_CAP = { butt: 1, round: 2, square: 3 } as const;
const LINE_JOIN = { miter: 1, round: 2, bevel: 3 } as const;

const vec = (v: Vec): number[] => [round3(v[0]), round3(v[1])];

const fixed = <V>(k: V): { a: 0; k: V } => ({ a: 0, k });

function keyframes(track: Track, where: string): LottieKeyframe[] {
  const last = track.keys.length - 1;
  return track.keys.map((key, n) => {
    const t = Math.round(key.t * FPS);
    if (n > 0 && t === Math.round(track.keys[n - 1].t * FPS)) {
      throw new Error(`${where}: two ${track.prop} keys land on frame ${t}, move them apart`);
    }
    const s = typeof key.v === 'number' ? [round3(key.v)] : vec(key.v);
    if (n === last) {
      return { t, s };
    }
    const { o, i } = HANDLES[key.ease];
    const each = (value: number) => s.map(() => value);
    return { t, s, o: { x: each(o[0]), y: each(o[1]) }, i: { x: each(i[0]), y: each(i[1]) } };
  });
}

function scalar(track: Track | undefined, base: number, where: string): LottieProp<number> {
  const keys = track?.keys ?? [];
  if (track && keys.length > 1) {
    return { a: 1, k: keyframes(track, where) };
  }
  return fixed(round3(keys.length === 1 ? (keys[0].v as number) : base));
}

function vector(track: Track | undefined, base: Vec, where: string): LottieProp<number[]> {
  const keys = track?.keys ?? [];
  if (track && keys.length > 1) {
    return { a: 1, k: keyframes(track, where) };
  }
  return fixed(vec(keys.length === 1 ? (keys[0].v as Vec) : base));
}

function transform(node: Node): LottieTransform {
  const where = `node "${node.name}" (${node.id})`;
  const base = node.transform;
  return {
    p: vector(trackOf(node, 'position'), base.position, where),
    a: fixed(vec(base.anchor)),
    s: vector(trackOf(node, 'scale'), base.scale, where),
    r: scalar(trackOf(node, 'rotation'), base.rotation, where),
    o: scalar(trackOf(node, 'opacity'), base.opacity, where),
  };
}

function still(tr: Transform): LottieTransform {
  return {
    p: fixed(vec(tr.position)),
    a: fixed(vec(tr.anchor)),
    s: fixed(vec(tr.scale)),
    r: fixed(round3(tr.rotation)),
    o: fixed(round3(tr.opacity)),
  };
}

const bezier = (path: BezierPath): LottieBezier => ({
  c: path.closed,
  v: path.v.map(vec),
  i: path.i.map(vec),
  o: path.o.map(vec),
});

const label = (node: Node) => `"${node.name}" (${node.id})`;

/** Throws when a node is trimmed and paints with a stretched radial gradient. */
export function checkTrim(node: Node): void {
  if (node.trimmed && node.items.some((item) => isStretched(item.style.fill))) {
    throw new Error(
      `draw cannot trim ${label(node)}: its radial gradient is stretched, and a trim would not follow the drawing`
    );
  }
}

/** The gradient stops as Lottie stores them: colour stops, then alpha stops when needed. */
function gradientStops(g: Gradient): LottieGradient['g'] {
  const stops = stopsOut(g.stops);
  const colours = stops.flatMap((stop) => [stop.offset, ...stop.rgb]);
  // Alpha stops reuse the colour offsets exactly, so a renderer pairs them, hard stops included.
  const alpha = stops.some((stop) => stop.opacity < 1)
    ? stops.flatMap((stop) => [stop.offset, stop.opacity])
    : [];
  return { p: stops.length, k: fixed([...colours, ...alpha]) };
}

/**
 * A gradient in the space it is drawn in. A radial one is written with e one radius to the right
 * of s, because renderers read the radius from the distance between them.
 */
function gradientShape(g: Gradient): LottieGradient {
  if (g.type === 'linear') {
    return { t: 1, s: fixed(vec(g.from)), e: fixed(vec(g.to)), g: gradientStops(g) };
  }
  const out: LottieGradient = {
    t: 2,
    s: fixed(vec(g.centre)),
    e: fixed(vec([g.centre[0] + g.radius, g.centre[1]])),
    g: gradientStops(g),
  };
  const dx = g.focal[0] - g.centre[0];
  const dy = g.focal[1] - g.centre[1];
  if (Math.hypot(dx, dy) > 1e-9) {
    out.h = fixed(round3((100 * Math.hypot(dx, dy)) / g.radius));
    out.a = fixed(round3((Math.atan2(dy, dx) * 180) / Math.PI));
  }
  return out;
}

/** Rounds to 6 decimals, and never gives a negative zero. */
const round6 = (x: number): number => {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

function strokeShape(node: Node, style: ShapeItem['style']): LottieShape | null {
  const where = `node ${label(node)}`;
  if (!hasPaint(style.stroke)) {
    return null;
  }
  const common = {
    o: fixed(100),
    w: fixed(round3(style.strokeWidth ?? 1)),
    lc: LINE_CAP[style.lineCap ?? 'butt'],
    lj: LINE_JOIN[style.lineJoin ?? 'miter'],
    ml: 4,
  };
  const paint = style.stroke as Paint;
  if (isGradient(paint)) {
    checkGradient(paint, where);
    if (isStretched(paint)) {
      throw new Error(
        `${where} has a radial gradient stroke that is stretched, which cannot be drawn`
      );
    }
    return { ty: 'gs', nm: 'stroke', ...common, ...gradientShape(paint) };
  }
  const colour = flatColour(paint, where) as number[];
  return { ty: 'st', nm: 'stroke', c: fixed([...colour, 1]), ...common };
}

function fillShape(node: Node, style: ShapeItem['style']): LottieShape | null {
  const where = `node ${label(node)}`;
  const paint = style.fill;
  if (isGradient(paint)) {
    checkGradient(paint, where);
    return { ty: 'gf', nm: 'fill', o: fixed(100), r: 1, ...gradientShape(paint) };
  }
  const colour = flatColour(paint, where);
  return colour ? { ty: 'fl', nm: 'fill', c: fixed([...colour, 1]), o: fixed(100), r: 1 } : null;
}

/**
 * A fill with a stretched radial gradient, as one group. Its tr stretches a circle into the
 * ellipse, so the paths inside are drawn in the circle's frame and the tr maps them back. The tr
 * sits in the same group as the gf, so it moves the gradient too, and the group holds no stroke,
 * whose width the stretch would change.
 */
function stretchedFill(
  node: Node,
  item: ShapeItem,
  g: RadialGradient & { matrix: Matrix }
): LottieShape {
  checkGradient(g, `node ${label(node)}`);
  const m = g.matrix;
  const { rotation, s1, s2, turn } = radialFrame(m);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const k = s1 / s2;
  // Item space into the frame: undo the translation and the rotation, then the squash.
  const tangent = ([x, y]: Vec): Vec => [cos * x + sin * y, k * (-sin * x + cos * y)];
  const point = ([x, y]: Vec): Vec => tangent([x - m[4], y - m[5]]);
  // Gradient space into the frame: a rotation and a uniform scale, so circles stay circles.
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const frame = ([x, y]: Vec): Vec => [s1 * (ct * x - st * y), s1 * (st * x + ct * y)];
  const paths: LottieShape[] = item.paths.map((path, n) => ({
    ty: 'sh',
    nm: `path ${n + 1}`,
    ks: fixed(
      bezier({
        closed: path.closed,
        v: path.v.map(point),
        i: path.i.map(tangent),
        o: path.o.map(tangent),
      })
    ),
  }));
  const circle: RadialGradient = {
    type: 'radial',
    centre: frame(g.centre),
    radius: s1 * g.radius,
    focal: frame(g.focal),
    stops: g.stops,
  };
  return {
    ty: 'gr',
    nm: 'fill',
    it: [
      ...paths,
      { ty: 'gf', nm: 'fill', o: fixed(100), r: 1, ...gradientShape(circle) },
      {
        ty: 'tr',
        nm: 'transform',
        p: fixed(vec([m[4], m[5]])),
        a: fixed([0, 0]),
        s: fixed([100, round6((100 * s2) / s1)]),
        r: fixed(round6((rotation * 180) / Math.PI)),
        o: fixed(100),
        sk: fixed(0),
        sa: fixed(0),
      },
    ],
  };
}

/** The paths of one item, then its trim, then its stroke over its fill. */
function itemShapes(node: Node, item: ShapeItem): LottieShape[] {
  const where = `node "${node.name}" (${node.id})`;
  checkTrim(node);
  const paths = (): LottieShape[] =>
    item.paths.map((path, n) => ({ ty: 'sh', nm: `path ${n + 1}`, ks: fixed(bezier(path)) }));
  const { style } = item;
  const stroke = strokeShape(node, style);
  if (isStretched(style.fill)) {
    // The stroke goes in a group of its own, in front, with the paths where they are.
    const front: LottieShape[] = stroke
      ? [{ ty: 'gr', nm: 'stroke', it: [...paths(), stroke, transformShape(still(identity()))] }]
      : [];
    return [...front, stretchedFill(node, item, style.fill as RadialGradient & { matrix: Matrix })];
  }
  const out = paths();
  if (node.trimmed) {
    out.push({
      ty: 'tm',
      nm: 'trim',
      s: fixed(0),
      e: scalar(trackOf(node, 'trimEnd'), 100, where),
      o: fixed(0),
      m: 1,
    });
  }
  if (stroke) {
    out.push(stroke);
  }
  const fill = fillShape(node, style);
  if (fill) {
    out.push(fill);
  }
  return out;
}

const transformShape = (tr: LottieTransform): LottieShape => ({
  ty: 'tr',
  nm: 'transform',
  ...tr,
  sk: fixed(0),
  sa: fixed(0),
});

/**
 * A node as a Lottie group. Lottie paints the first entry of a group on top, so later items and
 * later children come first. A node's own items are painted over its children.
 */
function group(node: Node, tr: LottieTransform): LottieShape {
  // A style applies to every path before it in its group, so two items with their own styles
  // each need a group of their own.
  const items: LottieShape[] =
    node.items.length <= 1
      ? node.items.flatMap((item) => itemShapes(node, item))
      : node.items
          .map((item, n): LottieShape => ({
            ty: 'gr',
            nm: `${node.name} item ${n + 1}`,
            it: [...itemShapes(node, item), transformShape(still(identity()))],
          }))
          .reverse();
  const children = node.children.map((child) => group(child, transform(child))).reverse();
  return { ty: 'gr', nm: node.name, it: [...items, ...children, transformShape(tr)] };
}

/** How many fills and strokes a node paints, its children included. */
function paints(node: Node): number {
  const own = node.items.reduce(
    (sum, { style }) => sum + (hasPaint(style.fill) ? 1 : 0) + (hasPaint(style.stroke) ? 1 : 0),
    0
  );
  return node.children.reduce((sum, child) => sum + paints(child), own);
}

const fades = (node: Node): boolean =>
  node.transform.opacity !== 100 || trackOf(node, 'opacity') !== undefined;

/**
 * True for a node that has to fade as one finished picture: it fades, and it has more than one
 * paint, so one could show through another. An opacity on a group is handed down to each paint,
 * which fades them one by one. An opacity on a layer fades the picture, as the SVG mirror does.
 */
const fadesWhole = (node: Node): boolean => fades(node) && paints(node) > 1;

/**
 * True for a node that is taken apart into layers, so that a node under it can have a layer of
 * its own. A node that fades is never taken apart: a layer passes its transform on to the layers
 * under it but not its opacity, so the fade would be lost. Nodes under a fading node stay in its
 * group, and a node with several paints that fades inside another fade still fades paint by paint.
 */
const splits = (node: Node): boolean =>
  !fades(node) && node.children.some((child) => fadesWhole(child) || splits(child));

/** The scene as a Lottie animation at 60 frames a second. The output is the same for the same model. */
export function emitLottie(model: SceneModel): LottieAnimation {
  const op = Math.round(model.duration * FPS);
  const rest = {
    sr: 1 as const,
    ao: 0 as const,
    ip: 0 as const,
    op,
    st: 0 as const,
    bm: 0 as const,
  };
  const CAMERA = 1;
  const cameraLayer: LottieLayer = {
    ddd: 0,
    ind: CAMERA,
    ty: 3,
    nm: model.camera.name,
    ks: transform(model.camera),
    ...rest,
  };
  // In draw order, the back one first.
  const drawn: LottieLayer[] = [];
  const shapeLayer = (nm: string, parent: number, ks: LottieTransform, node: Node): void => {
    drawn.push({
      ddd: 0,
      ind: drawn.length + 2,
      ty: 4,
      nm,
      parent,
      ks,
      ...rest,
      // The layer carries the node's transform, so its group stays put.
      shapes: [group(node, still(identity()))],
    });
  };
  const place = (node: Node, parent: number): void => {
    if (!splits(node)) {
      shapeLayer(node.name, parent, transform(node), node);
      return;
    }
    // A null layer carries the node's transform. Its children follow as layers of their own,
    // then its own shapes, which are painted over the children.
    const ind = drawn.length + 2;
    drawn.push({ ddd: 0, ind, ty: 3, nm: node.name, parent, ks: transform(node), ...rest });
    node.children.forEach((child) => place(child, ind));
    if (node.items.length > 0) {
      shapeLayer(`${node.name} shapes`, ind, still(identity()), { ...node, children: [] });
    }
  };
  model.nodes.forEach((node) => place(node, CAMERA));
  return {
    v: '5.12.0',
    fr: FPS,
    ip: 0,
    op,
    w: model.size[0],
    h: model.size[1],
    nm: model.id,
    ddd: 0,
    assets: [],
    // Lottie draws layers[0] on top, so the last node added comes straight after the camera.
    layers: [cameraLayer, ...drawn.toReversed()],
  };
}

import { HANDLES } from './ease';
import { trackOf } from './evaluate';
import {
  identity,
  type BezierPath,
  type Node,
  type SceneModel,
  type ShapeItem,
  type Track,
  type Transform,
  type Vec,
} from './model';

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

/** Rounds to 3 decimals, and never gives a negative zero. */
export const round3 = (x: number): number => {
  const r = Math.round(x * 1000) / 1000;
  return r === 0 ? 0 : r;
};
const vec = (v: Vec): number[] => [round3(v[0]), round3(v[1])];

/**
 * Reads a #rgb or #rrggbb colour as [r, g, b] in 0 to 1. Gives null for no paint (undefined or
 * "none"). Throws on anything else, so a colour is never drawn differently from how it was written.
 */
export function parseColour(colour: string | undefined, where: string): number[] | null {
  if (colour === undefined || colour === 'none') {
    return null;
  }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(colour);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(colour);
  const parts = short ? short.slice(1).map((c) => c + c) : long?.slice(1);
  if (!parts) {
    throw new Error(`${where}: cannot use colour "${colour}", write it as #rrggbb`);
  }
  return parts.map((part) => round3(parseInt(part, 16) / 255));
}

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

/** The paths of one item, then its trim, then its stroke over its fill. */
function itemShapes(node: Node, item: ShapeItem): LottieShape[] {
  const where = `node "${node.name}" (${node.id})`;
  const out: LottieShape[] = item.paths.map((path, n) => ({
    ty: 'sh',
    nm: `path ${n + 1}`,
    ks: fixed(bezier(path)),
  }));
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
  const { style } = item;
  const stroke = parseColour(style.stroke, where);
  if (stroke) {
    out.push({
      ty: 'st',
      nm: 'stroke',
      c: fixed([...stroke, 1]),
      o: fixed(100),
      w: fixed(round3(style.strokeWidth ?? 1)),
      lc: LINE_CAP[style.lineCap ?? 'butt'],
      lj: LINE_JOIN[style.lineJoin ?? 'miter'],
      ml: 4,
    });
  }
  const fill = parseColour(style.fill, where);
  if (fill) {
    out.push({ ty: 'fl', nm: 'fill', c: fixed([...fill, 1]), o: fixed(100), r: 1 });
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

/** The scene as a Lottie animation at 60 frames a second. The output is the same for the same model. */
export function emitLottie(model: SceneModel): LottieAnimation {
  const op = Math.round(model.duration * FPS);
  const layer = (ind: number, ty: 3 | 4, node: Node) => ({
    ddd: 0 as const,
    ind,
    ty,
    nm: node.name,
  });
  const rest = {
    sr: 1 as const,
    ao: 0 as const,
    ip: 0 as const,
    op,
    st: 0 as const,
    bm: 0 as const,
  };
  const cameraLayer: LottieLayer = {
    ...layer(1, 3, model.camera),
    ks: transform(model.camera),
    ...rest,
  };
  // Lottie draws layers[0] on top, so the last node added comes straight after the camera.
  const shapeLayers = model.nodes
    .map((node, n): LottieLayer => ({
      ...layer(n + 2, 4, node),
      parent: 1,
      ks: transform(node),
      ...rest,
      // The layer carries the node's transform, so its group stays put.
      shapes: [group(node, still(identity()))],
    }))
    .reverse();
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
    layers: [cameraLayer, ...shapeLayers],
  };
}

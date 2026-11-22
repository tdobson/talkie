import { parseSync, type INode } from 'svgson';
import type { BezierPath, GradientStop, Paint, ShapeItem, Style, Vec } from './model';
import { applyMatrix, bakeLinear, invert, isNearSimilarity, tightBox } from './paint';
import { parsePathD, transformPaths, type Matrix } from './path';

/**
 * The drawing uses something the importer cannot draw exactly as a browser does: a filter, mask,
 * pattern, bitmap, live text, style sheet or blend mode, or a gradient or clip path in a form the
 * film cannot honour. The message names the element and why.
 */
export class UnsupportedSvgError extends Error {
  constructor(
    /** The tag name of the element at fault. */
    public readonly element: string,
    /** Its id, or null when it has none. */
    public readonly id: string | null,
    public readonly file: string,
    reason: string
  ) {
    super(`${file}: <${element}${id === null ? '> (no id)' : ` id="${id}">`} ${reason}`);
    this.name = 'UnsupportedSvgError';
  }
}

/** One element of a drawing. Transforms are already baked into the paths. */
export interface ArtNode {
  /** The element's id, or its tag name when it has none. The root is named after the file. */
  name: string;
  items: ShapeItem[];
  children: ArtNode[];
  /** Percent, as in Transform. */
  opacity: number;
  /** Closed contours, in the same space as the items, whose union clips this node and its children. */
  clip?: BezierPath[];
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** Control point distance for a quarter circle of radius 1. */
const KAPPA = 0.5522847498307936;

/** Things that draw nothing themselves. Gradients and clip paths are read when something uses them. */
const SKIPPED = new Set([
  'defs',
  'title',
  'desc',
  'metadata',
  'clipPath',
  'linearGradient',
  'radialGradient',
]);
const GRADIENTS = new Set(['linearGradient', 'radialGradient']);
/** Things we refuse wherever they appear, used or not. */
const REFUSED: Record<string, string> = {
  filter: 'is a filter, which cannot be drawn',
  mask: 'is a mask, which cannot be drawn',
  pattern: 'is a pattern fill, which cannot be drawn',
  image: 'is a bitmap image, which cannot be drawn',
  text: 'is live text, which cannot be drawn. Convert it to paths, or use label()',
  style:
    'is a style sheet, which the importer does not read. Export with presentation attributes (Illustrator: Styling, Presentation Attributes)',
};
/** Attributes we refuse on anything drawn, unless they have the harmless value given. */
const REFUSED_ATTRIBUTES: Record<string, { reason: string; harmless: string }> = {
  mask: { reason: 'uses a mask, which cannot be drawn', harmless: 'none' },
  filter: { reason: 'uses a filter, which cannot be drawn', harmless: 'none' },
  'stroke-dasharray': { reason: 'has a dashed stroke, which cannot be drawn', harmless: 'none' },
  'mix-blend-mode': { reason: 'uses a blend mode, which cannot be drawn', harmless: 'normal' },
  marker: { reason: 'uses markers, which cannot be drawn. Draw them as shapes', harmless: 'none' },
  'marker-start': {
    reason: 'uses markers, which cannot be drawn. Draw them as shapes',
    harmless: 'none',
  },
  'marker-mid': {
    reason: 'uses markers, which cannot be drawn. Draw them as shapes',
    harmless: 'none',
  },
  'marker-end': {
    reason: 'uses markers, which cannot be drawn. Draw them as shapes',
    harmless: 'none',
  },
  'paint-order': {
    reason: 'has a paint-order other than normal, which cannot be drawn',
    harmless: 'normal',
  },
  'vector-effect': {
    reason: 'has a vector-effect, which cannot be drawn. Use none',
    harmless: 'none',
  },
};
const INHERITED = [
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'fill-opacity',
  'stroke-opacity',
  'fill-rule',
] as const;
type Inherited = Partial<Record<(typeof INHERITED)[number], string>>;

const COLOUR_NAMES: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  maroon: '#800000',
  navy: '#000080',
  teal: '#008080',
  olive: '#808000',
  lime: '#00ff00',
  aqua: '#00ffff',
  cyan: '#00ffff',
  fuchsia: '#ff00ff',
  magenta: '#ff00ff',
};

/** a then b: the matrix that applies b first, then a. */
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;
const NUMBER_TEXT = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?';
const PLAIN = new RegExp(`^${NUMBER_TEXT}$`, 'i');
const PERCENT = new RegExp(`^(${NUMBER_TEXT})%$`, 'i');
const PIXELS = new RegExp(`^(${NUMBER_TEXT})(?:px)?$`, 'i');
const numbers = (text: string): number[] => (text.match(NUMBER) ?? []).map(Number);

const polyline = (points: Vec[], closed: boolean): BezierPath => ({
  closed,
  v: points,
  i: points.map((): Vec => [0, 0]),
  o: points.map((): Vec => [0, 0]),
});

function ellipse(cx: number, cy: number, rx: number, ry: number): BezierPath {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    closed: true,
    v: [
      [cx, cy - ry],
      [cx + rx, cy],
      [cx, cy + ry],
      [cx - rx, cy],
    ],
    i: [
      [-kx, 0],
      [0, -ky],
      [kx, 0],
      [0, ky],
    ],
    o: [
      [kx, 0],
      [0, ky],
      [-kx, 0],
      [0, -ky],
    ],
  };
}

/**
 * Turns an SVG drawing into a tree of plain shapes: one node per element, in document order,
 * with every transform baked into the points. `base` is applied on top of the drawing's own
 * transforms, which is how a scene places and scales a piece of art. The viewBox origin is moved
 * to 0,0; lengths stay in the drawing's own units. Fills and strokes may be flat colours or linear
 * and radial gradients, which are baked into the same space as the points. clip-path on a shape,
 * a group or the root becomes closed contours on that node. Anything the importer cannot draw
 * faithfully throws UnsupportedSvgError.
 */
export function importSvg(svg: string, file: string, base: Matrix = IDENTITY): ArtNode {
  let root: INode;
  try {
    root = parseSync(svg);
  } catch (error) {
    throw new Error(`${file}: cannot read this as SVG (${(error as Error).message})`);
  }
  if (root.name !== 'svg') {
    throw new Error(`${file}: the outer element is <${root.name}>, not <svg>`);
  }

  // Browsers resolve an id to the first element that has it. One that two elements share is
  // refused when something points at it, so the film never picks a different one.
  const byId = new Map<string, INode>();
  const shared = new Set<string>();
  const parentOf = new Map<INode, INode>();
  const index = (el: INode) => {
    const id = el.attributes?.id;
    if (id) {
      if (byId.has(id)) {
        shared.add(id);
      } else {
        byId.set(id, el);
      }
    }
    for (const child of el.children ?? []) {
      parentOf.set(child, el);
      index(child);
    }
  };
  index(root);

  const fail = (el: INode, reason: string): never => {
    throw new UnsupportedSvgError(el.name, el.attributes?.id ?? null, file, reason);
  };

  /** The element a local reference "#id" points at, refusing ids that are missing or shared. */
  const target = (el: INode, ref: string, what: string): INode => {
    if (!ref.startsWith('#')) {
      return fail(el, `has ${what}, which points outside this file`);
    }
    const id = ref.slice(1);
    if (shared.has(id)) {
      return fail(el, `points at id "${id}", which two elements share`);
    }
    return byId.get(id) ?? fail(el, `has ${what}, which points at nothing`);
  };
  /** The reference inside url(...), quoted or not, or null when the value is not a url. */
  const urlOf = (value: string): string | null => {
    const match = /^url\(\s*(['"]?)([^'")]*)\1\s*\)/.exec(value);
    return match ? match[2].trim() : null;
  };

  // Percentages in userSpaceOnUse are read against the viewport: the viewBox, else width and height.
  const viewport = ((): Vec | null => {
    const vb = root.attributes?.viewBox ? numbers(root.attributes.viewBox) : [];
    if (vb.length === 4) {
      return [vb[2], vb[3]];
    }
    const w = PIXELS.exec(root.attributes?.width?.trim() ?? '');
    const h = PIXELS.exec(root.attributes?.height?.trim() ?? '');
    return w && h ? [parseFloat(w[1]), parseFloat(h[1])] : null;
  })();

  /** Attributes with the inline style laid over them, as CSS would. */
  const props = (el: INode): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const key of Object.keys(el.attributes ?? {})) {
      out[key] = el.attributes[key].trim();
    }
    for (const rule of (out.style ?? '').split(';')) {
      const colon = rule.indexOf(':');
      if (colon > 0) {
        out[rule.slice(0, colon).trim()] = rule.slice(colon + 1).trim();
      }
    }
    return out;
  };

  const length = (el: INode, name: string, value: string | undefined, fallback = 0): number => {
    if (value === undefined || value === '') {
      return fallback;
    }
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?(?:px)?$/i.test(value)) {
      return fail(el, `has ${name}="${value}". Only plain numbers and px are read`);
    }
    return parseFloat(value);
  };

  const fraction = (el: INode, name: string, value: string | undefined): number => {
    if (value === undefined || value === '') {
      return 1;
    }
    if (!/^(?:\d+\.?\d*|\.\d+)%?$/.test(value)) {
      return fail(el, `has ${name}="${value}", which is not a number`);
    }
    const n = value.endsWith('%') ? parseFloat(value) / 100 : parseFloat(value);
    return Math.min(1, Math.max(0, n));
  };

  /** A plain colour as #rrggbb. */
  const colourValue = (el: INode, name: string, value: string): string => {
    const lower = value.toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(lower)) {
      return lower;
    }
    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(lower);
    if (short) {
      return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
    }
    const rgb = /^rgb\(\s*(\d+%?)\s*[, ]\s*(\d+%?)\s*[, ]\s*(\d+%?)\s*\)$/.exec(lower);
    if (rgb) {
      const hex = rgb.slice(1).map((part) => {
        const n = part.endsWith('%') ? (parseFloat(part) * 255) / 100 : parseFloat(part);
        return Math.min(255, Math.max(0, Math.round(n)))
          .toString(16)
          .padStart(2, '0');
      });
      return `#${hex.join('')}`;
    }
    return (
      COLOUR_NAMES[lower] ??
      fail(el, `has ${name}="${value}". Write the colour as #rrggbb, rgb() or a basic colour name`)
    );
  };

  const matrixOf = (el: INode, value: string | undefined): Matrix => {
    if (!value) {
      return IDENTITY;
    }
    let out: Matrix = IDENTITY;
    const rest = value.replace(/([a-z]+)\s*\(([^)]*)\)/gi, (_all, fn: string, args: string) => {
      const n = numbers(args);
      const bad = (): never => fail(el, `has a transform that cannot be read: "${value}"`);
      let m: Matrix;
      if (fn === 'matrix' && n.length === 6) {
        m = [n[0], n[1], n[2], n[3], n[4], n[5]];
      } else if (fn === 'translate' && (n.length === 1 || n.length === 2)) {
        m = [1, 0, 0, 1, n[0], n[1] ?? 0];
      } else if (fn === 'scale' && (n.length === 1 || n.length === 2)) {
        m = [n[0], 0, 0, n[1] ?? n[0], 0, 0];
      } else if (fn === 'rotate' && (n.length === 1 || n.length === 3)) {
        const r = (n[0] * Math.PI) / 180;
        const turn: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        const [cx, cy] = [n[1] ?? 0, n[2] ?? 0];
        m = multiply(multiply([1, 0, 0, 1, cx, cy], turn), [1, 0, 0, 1, -cx, -cy]);
      } else if (fn === 'skewX' && n.length === 1) {
        m = [1, 0, Math.tan((n[0] * Math.PI) / 180), 1, 0, 0];
      } else if (fn === 'skewY' && n.length === 1) {
        m = [1, Math.tan((n[0] * Math.PI) / 180), 0, 1, 0, 0];
      } else {
        m = bad();
      }
      out = multiply(out, m);
      return '';
    });
    if (rest.replace(/[\s,]/g, '') !== '') {
      fail(el, `has a transform that cannot be read: "${value}"`);
    }
    return out;
  };

  /** The outline of a basic shape in its own coordinates, or null when it draws nothing. */
  const outline = (el: INode, p: Record<string, string>): BezierPath[] | null => {
    const len = (name: string) => length(el, name, p[name]);
    switch (el.name) {
      case 'path': {
        if (!p.d) {
          return null;
        }
        try {
          return parsePathD(p.d);
        } catch (error) {
          return fail(el, `has path data that cannot be read (${(error as Error).message})`);
        }
      }
      case 'rect': {
        const [x, y, w, h] = [len('x'), len('y'), len('width'), len('height')];
        if (w <= 0 || h <= 0) {
          return null;
        }
        const auto = (name: string) =>
          p[name] === undefined || p[name] === 'auto' ? null : len(name);
        const rx = Math.min(Math.max(auto('rx') ?? auto('ry') ?? 0, 0), w / 2);
        const ry = Math.min(Math.max(auto('ry') ?? auto('rx') ?? 0, 0), h / 2);
        if (rx === 0 || ry === 0) {
          return [
            polyline(
              [
                [x, y],
                [x + w, y],
                [x + w, y + h],
                [x, y + h],
              ],
              true
            ),
          ];
        }
        const [kx, ky] = [rx * KAPPA, ry * KAPPA];
        return [
          {
            closed: true,
            v: [
              [x + rx, y],
              [x + w - rx, y],
              [x + w, y + ry],
              [x + w, y + h - ry],
              [x + w - rx, y + h],
              [x + rx, y + h],
              [x, y + h - ry],
              [x, y + ry],
            ],
            i: [
              [-kx, 0],
              [0, 0],
              [0, -ky],
              [0, 0],
              [kx, 0],
              [0, 0],
              [0, ky],
              [0, 0],
            ],
            o: [
              [0, 0],
              [kx, 0],
              [0, 0],
              [0, ky],
              [0, 0],
              [-kx, 0],
              [0, 0],
              [0, -ky],
            ],
          },
        ];
      }
      case 'circle': {
        const r = len('r');
        return r > 0 ? [ellipse(len('cx'), len('cy'), r, r)] : null;
      }
      case 'ellipse': {
        const [rx, ry] = [len('rx'), len('ry')];
        return rx > 0 && ry > 0 ? [ellipse(len('cx'), len('cy'), rx, ry)] : null;
      }
      case 'line':
        return [
          polyline(
            [
              [len('x1'), len('y1')],
              [len('x2'), len('y2')],
            ],
            false
          ),
        ];
      case 'polyline':
      case 'polygon': {
        const n = numbers(p.points ?? '');
        if (
          n.length % 2 !== 0 ||
          (p.points ?? '').replace(NUMBER, '').replace(/[\s,]/g, '') !== ''
        ) {
          return fail(el, `has points that cannot be read: "${p.points}"`);
        }
        const points: Vec[] = [];
        for (let k = 0; k < n.length; k += 2) {
          points.push([n[k], n[k + 1]]);
        }
        return points.length > 1 ? [polyline(points, el.name === 'polygon')] : null;
      }
      default:
        return null;
    }
  };

  const SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

  /** What may sit in a clipPath. A line is allowed but adds no area. */
  const CLIP_SHAPES = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline']);

  /** The value of an inherited property on el, else on the nearest ancestor in the document. */
  const inheritedProp = (el: INode, name: string): string | undefined => {
    for (let at: INode | undefined = el; at; at = parentOf.get(at)) {
      const value = props(at)[name];
      if (value !== undefined && value !== 'inherit') {
        return value;
      }
    }
    return undefined;
  };

  /**
   * The outlines of an element and everything under it, in its own user space, for an
   * objectBoundingBox. Unpainted shapes, lines and hidden shapes count; display:none does not, and
   * neither do the clips of children.
   */
  const geometry = (el: INode): BezierPath[] => {
    if (SHAPES.has(el.name)) {
      return outline(el, props(el)) ?? [];
    }
    if (el.name !== 'g' && el !== root) {
      return [];
    }
    return (el.children ?? []).flatMap((child) => {
      const p = child.type === 'element' ? props(child) : {};
      if (child.type !== 'element' || p.display === 'none') {
        return [];
      }
      return transformPaths(geometry(child), matrixOf(child, p.transform));
    });
  };

  /**
   * The clip of an element as closed contours in item space, or undefined when it has none.
   * `matrix` maps the element's own user space, its transform included, to item space.
   */
  const clipOf = (
    el: INode,
    p: Record<string, string>,
    matrix: Matrix
  ): BezierPath[] | undefined => {
    const value = p['clip-path'];
    if (value === undefined || value === 'none') {
      return undefined;
    }
    const ref = urlOf(value);
    if (ref === null) {
      return fail(el, `uses clip-path="${value}", only url(#id) of a clipPath is read`);
    }
    const clip = target(el, ref, `clip-path="${value}"`);
    if (clip.name !== 'clipPath') {
      return fail(el, `has clip-path="${value}", which points at a <${clip.name}>, not a clipPath`);
    }
    const cp = props(clip);
    if (cp['clip-path'] !== undefined && cp['clip-path'] !== 'none') {
      fail(clip, 'clips a clip, which cannot be drawn');
    }
    const units = clip.attributes?.clipPathUnits?.trim() ?? 'userSpaceOnUse';
    if (units !== 'userSpaceOnUse' && units !== 'objectBoundingBox') {
      fail(clip, `has clipPathUnits="${units}", which cannot be read`);
    }
    // The clipPath transform sits outside the bounding box mapping, so its numbers are user
    // units, as Chromium, Firefox, WebKit and resvg all read them.
    let space = multiply(matrix, matrixOf(clip, cp.transform));
    if (units === 'objectBoundingBox') {
      const box = tightBox(geometry(el));
      if (!box || box.width === 0 || box.height === 0) {
        fail(
          el,
          'has a clip path that uses objectBoundingBox, and the shape has no width or height, so browsers draw nothing. Use clipPathUnits="userSpaceOnUse"'
        );
      }
      const { x, y, width, height } = box as NonNullable<typeof box>;
      space = multiply(space, [width, 0, 0, height, x, y]);
    }
    if (!invert(space)) {
      fail(clip, 'is squashed flat, so it cannot be drawn');
    }
    const contours: BezierPath[] = [];
    for (const child of clip.children ?? []) {
      if (child.type !== 'element' || child.name === 'title' || child.name === 'desc') {
        continue;
      }
      if (child.name === 'g') {
        fail(
          child,
          'browsers ignore a group inside a clipPath. Put the shapes straight in the clipPath'
        );
      }
      const c = props(child);
      // A <use> of a basic shape, which is how Illustrator's Save As writes every clip: the
      // shape is drawn where the use puts it, and takes what it does not say from the use.
      let shape = child;
      let place = space;
      if (child.name === 'use') {
        const href = (child.attributes?.href ?? child.attributes?.['xlink:href'])?.trim();
        if (!href) {
          fail(child, 'points at nothing');
        }
        shape = target(child, href as string, `href="${href}"`);
        if (!CLIP_SHAPES.has(shape.name)) {
          fail(
            child,
            `points at a <${shape.name}> inside a clipPath, which cannot be drawn. Put the shape itself in the clipPath`
          );
        }
        const offset: Matrix = [1, 0, 0, 1, length(child, 'x', c.x), length(child, 'y', c.y)];
        place = multiply(multiply(space, matrixOf(child, c.transform)), offset);
      } else if (!CLIP_SHAPES.has(child.name)) {
        fail(
          child,
          'cannot be drawn in a clip. Only path, rect, circle, ellipse, line, polygon, polyline and a <use> of one are read'
        );
      }
      const s = shape === child ? c : props(shape);
      /** A property of the shape, else of the use or the clipPath above it. */
      const lookup = (name: string): string | undefined =>
        s[name] !== undefined && s[name] !== 'inherit' ? s[name] : inheritedProp(child, name);
      for (const at of new Set([child, shape])) {
        const value = props(at)['clip-path'];
        if (value !== undefined && value !== 'none') {
          fail(at, 'clips a clip, which cannot be drawn');
        }
      }
      const visibility = lookup('visibility');
      // A line adds no area, and fill, stroke and opacity do not count in a clip.
      if (
        c.display === 'none' ||
        s.display === 'none' ||
        visibility === 'hidden' ||
        visibility === 'collapse'
      ) {
        continue;
      }
      if (lookup('clip-rule') === 'evenodd') {
        fail(child, 'is clipped with the evenodd rule, which cannot be drawn. Use nonzero');
      }
      const paths = shape.name === 'line' ? null : outline(shape, s);
      if (!paths) {
        continue;
      }
      // Separate subpaths make a union, as the masks that draw them do, only while they do not
      // overlap: an inner one would cut a hole under nonzero.
      const boxes = paths.map((path) => tightBox([path]));
      boxes.forEach((a, n) =>
        boxes.slice(n + 1).forEach((b) => {
          if (
            a &&
            b &&
            a.x < b.x + b.width &&
            b.x < a.x + a.width &&
            a.y < b.y + b.height &&
            b.y < a.y + a.height
          ) {
            fail(shape, 'has subpaths that overlap, so its holes cannot be drawn as a clip');
          }
        })
      );
      const placed = transformPaths(paths, multiply(place, matrixOf(shape, s.transform)));
      contours.push(...placed.map((path) => ({ ...path, closed: true })));
    }
    return contours;
  };

  /** The gradient an element points at, then the ones it inherits from through href, in order. */
  const gradientChain = (start: INode): INode[] => {
    const chain = [start];
    for (let at = start; ;) {
      const href = (at.attributes?.href ?? at.attributes?.['xlink:href'])?.trim();
      if (href === undefined) {
        return chain;
      }
      const next = target(at, href, `href="${href}"`);
      if (!GRADIENTS.has(next.name)) {
        return fail(at, `has href="${href}", which points at a <${next.name}>, not a gradient`);
      }
      if (chain.includes(next)) {
        const names = [...chain, next].map((g) => g.attributes?.id ?? g.name);
        return fail(start, `has an href loop: ${names.join(', ')}`);
      }
      chain.push(next);
      at = next;
    }
  };

  /** A paint and the opacity it adds, which folds into the node like fill-opacity. */
  interface Painted {
    paint?: Paint;
    opacity: number;
  }

  /**
   * A gradient as the paint of one shape. `matrix` maps the shape's own coordinates to the item's,
   * `paths` is its outline in its own coordinates.
   */
  const gradient = (
    el: INode,
    name: 'fill' | 'stroke',
    start: INode,
    matrix: Matrix,
    paths: BezierPath[]
  ): Painted => {
    const chain = gradientChain(start);
    const kind = start.name;
    /** The first value of an attribute along the chain, with the element that holds it. */
    const read = (attr: string, sameKind = false): [string, INode] | null => {
      for (const g of chain) {
        if (sameKind && g.name !== kind) {
          continue;
        }
        const value = g.attributes?.[attr];
        if (value !== undefined) {
          return [value.trim(), g];
        }
      }
      return null;
    };
    for (const g of chain) {
      for (const child of g.children ?? []) {
        if (child.type === 'element' && !['stop', 'title', 'desc'].includes(child.name)) {
          fail(child, 'is inside a gradient, which only holds stops');
        }
      }
      // An inherited property, so an ancestor in the document can set it. Keywords ignore case.
      const mixing = (inheritedProp(g, 'color-interpolation') ?? 'auto').toLowerCase();
      if (mixing !== 'auto' && mixing !== 'srgb') {
        fail(
          g,
          `asks for ${mixing === 'linearrgb' ? 'linearRGB' : `"${mixing}"`} colour mixing, which cannot be drawn. Use sRGB`
        );
      }
    }
    const spread = read('spreadMethod');
    if (spread && spread[0] !== 'pad') {
      fail(spread[1], `uses spreadMethod="${spread[0]}", which cannot be drawn. Use pad`);
    }
    const unitsAt = read('gradientUnits');
    const units = unitsAt?.[0] ?? 'objectBoundingBox';
    if (unitsAt && units !== 'objectBoundingBox' && units !== 'userSpaceOnUse') {
      fail(unitsAt[1], `has gradientUnits="${units}", which cannot be read`);
    }
    const box = units === 'objectBoundingBox';

    // Stops come from the first gradient in the chain that has any.
    const holder = chain.find((g) => (g.children ?? []).some((c) => c.name === 'stop'));
    let last = 0;
    const stops: GradientStop[] = (holder?.children ?? [])
      .filter((c) => c.name === 'stop')
      .map((stop) => {
        const p = props(stop);
        const raw = stop.attributes?.offset?.trim() ?? '0';
        const percent = PERCENT.exec(raw);
        if (!percent && !PLAIN.test(raw)) {
          fail(stop, `has offset="${raw}", which is not a number`);
        }
        const value = percent ? parseFloat(percent[1]) / 100 : parseFloat(raw);
        // SVG clamps an offset to 0 to 1, then raises it to at least the one before.
        last = Math.max(last, Math.min(1, Math.max(0, value)));
        const colour = p['stop-color'] ?? 'black';
        if (['currentcolor', 'inherit'].includes(colour.toLowerCase())) {
          fail(
            stop,
            `has stop-color="${colour}", so it takes its colour from elsewhere. Write it as #rrggbb`
          );
        }
        return {
          offset: last,
          colour: colourValue(stop, 'stop-color', colour),
          opacity: fraction(stop, 'stop-opacity', p['stop-opacity']),
        };
      });
    if (stops.length === 0) {
      return { opacity: 1 };
    }
    const flat = (stop: GradientStop): Painted => ({ paint: stop.colour, opacity: stop.opacity });
    const first = stops[0];
    if (stops.every((stop) => stop.colour === first.colour && stop.opacity === first.opacity)) {
      return flat(first);
    }

    /** One coordinate: x and y against the width and height, r against their diagonal. */
    const coordinate = (attr: string, fallback: string, axis: 0 | 1 | 2): number => {
      const at = read(attr, true);
      const value = at?.[0] ?? fallback;
      const g = at?.[1] ?? start;
      const percent = PERCENT.exec(value);
      if (box) {
        if (!percent && !PLAIN.test(value)) {
          fail(g, `has ${attr}="${value}". Only plain numbers and percentages are read`);
        }
        return percent ? parseFloat(percent[1]) / 100 : parseFloat(value);
      }
      if (percent) {
        if (!viewport) {
          return fail(
            g,
            `has ${attr}="${value}" as a percentage, and the drawing has no viewBox or width and height to read it against`
          );
        }
        const [w, h] = viewport;
        const size = axis === 2 ? Math.sqrt((w * w + h * h) / 2) : viewport[axis];
        return (parseFloat(percent[1]) / 100) * size;
      }
      return length(g, attr, value);
    };

    let space = matrix;
    if (box) {
      const b = tightBox(paths);
      if ((!b || b.width === 0 || b.height === 0) && name === 'fill') {
        // A shape with no area has no fill to paint, so browsers paint none.
        return { opacity: 1 };
      }
      if (!b || b.width === 0 || b.height === 0) {
        fail(
          el,
          `has a ${name} gradient that uses objectBoundingBox, and the shape has no width or height, so browsers draw nothing. Use gradientUnits="userSpaceOnUse"`
        );
      }
      const { x, y, width, height } = b as NonNullable<typeof b>;
      space = multiply(space, [width, 0, 0, height, x, y]);
    }
    const transformAt = read('gradientTransform');
    if (transformAt) {
      space = multiply(space, matrixOf(transformAt[1], transformAt[0]));
    }
    if (!invert(space)) {
      fail(transformAt?.[1] ?? start, 'is squashed flat, so it cannot be drawn');
    }
    const lastStop = stops[stops.length - 1];

    if (kind === 'linearGradient') {
      const p1: Vec = [coordinate('x1', '0%', 0), coordinate('y1', '0%', 1)];
      const p2: Vec = [coordinate('x2', '100%', 0), coordinate('y2', '0%', 1)];
      if (p1[0] === p2[0] && p1[1] === p2[1]) {
        return flat(lastStop);
      }
      const baked =
        bakeLinear(p1, p2, space) ?? fail(start, 'is squashed flat, so it cannot be drawn');
      return { paint: { type: 'linear', from: baked.from, to: baked.to, stops }, opacity: 1 };
    }

    const centre: Vec = [coordinate('cx', '50%', 0), coordinate('cy', '50%', 1)];
    const r = coordinate('r', '50%', 2);
    const fxAt = read('fx', true);
    const fyAt = read('fy', true);
    const focal: Vec = [
      fxAt ? coordinate('fx', '', 0) : centre[0],
      fyAt ? coordinate('fy', '', 1) : centre[1],
    ];
    const fr = read('fr', true);
    if (fr && coordinate('fr', '0', 2) !== 0) {
      fail(fr[1], 'has a focal radius (fr), which cannot be drawn');
    }
    if (r < 0) {
      fail(read('r', true)?.[1] ?? start, `has r="${r}", which is below 0`);
    }
    if (r === 0) {
      return flat(lastStop);
    }
    if (Math.hypot(focal[0] - centre[0], focal[1] - centre[1]) >= 0.99 * r) {
      fail(
        fxAt?.[1] ?? fyAt?.[1] ?? start,
        'has its focal point fx, fy within 1% of the edge of the circle or beyond it, which cannot be drawn. Move it further in'
      );
    }
    if (isNearSimilarity(space, r)) {
      const scale = Math.sqrt(Math.abs(space[0] * space[3] - space[1] * space[2]));
      return {
        paint: {
          type: 'radial',
          centre: applyMatrix(space, centre),
          radius: r * scale,
          focal: applyMatrix(space, focal),
          stops,
        },
        opacity: 1,
      };
    }
    if (name === 'stroke') {
      fail(el, 'has a radial gradient stroke that is stretched, which cannot be drawn');
    }
    return {
      paint: { type: 'radial', centre, radius: r, focal, stops, matrix: space },
      opacity: 1,
    };
  };

  /** A fill or stroke value as a paint, resolving url(#id) against this shape. */
  const paint = (
    el: INode,
    name: 'fill' | 'stroke',
    value: string | undefined,
    matrix: Matrix,
    paths: BezierPath[]
  ): Painted => {
    if (value === undefined || value === 'none' || value === 'transparent') {
      return { opacity: 1 };
    }
    const ref = urlOf(value);
    if (ref === null) {
      return { paint: colourValue(el, name, value), opacity: 1 };
    }
    // A fallback after the url is only used when the id is missing, which is refused anyway.
    const used = target(el, ref, `${name}="${value}"`);
    if (!GRADIENTS.has(used.name)) {
      return fail(
        used,
        REFUSED[used.name] ?? `is used as a ${name}, which is not a gradient or a colour`
      );
    }
    return gradient(el, name, used, matrix, paths);
  };

  const walk = (el: INode, parent: Matrix, inherited: Inherited, name: string): ArtNode | null => {
    const p = props(el);
    for (const [attribute, { reason, harmless }] of Object.entries(REFUSED_ATTRIBUTES)) {
      if (p[attribute] !== undefined && p[attribute] !== harmless) {
        fail(el, reason);
      }
    }
    if (p.display === 'none' || p.visibility === 'hidden') {
      return null;
    }
    const matrix = multiply(parent, matrixOf(el, p.transform));
    const style: Inherited = { ...inherited };
    for (const key of INHERITED) {
      if (p[key] !== undefined && p[key] !== 'inherit') {
        style[key] = p[key];
      }
    }
    const opacity = fraction(el, 'opacity', p.opacity);
    const clip = clipOf(el, p, matrix);
    if (clip && clip.length === 0) {
      // A clip with no area hides the element and everything under it.
      return null;
    }
    const clipped = clip ? { clip } : {};

    if (!SHAPES.has(el.name)) {
      const children: ArtNode[] = [];
      for (const child of el.children ?? []) {
        if (child.type !== 'element') {
          continue;
        }
        const made = visit(child, matrix, style);
        if (made) {
          children.push(made);
        }
      }
      return { name, items: [], children, opacity: opacity * 100, ...clipped };
    }

    const paths = outline(el, p);
    if (!paths || paths.length === 0) {
      return null;
    }
    // A line encloses nothing, so its fill never shows.
    const filled: Painted =
      el.name === 'line' ? { opacity: 1 } : paint(el, 'fill', style.fill ?? 'black', matrix, paths);
    const stroked = paint(el, 'stroke', style.stroke, matrix, paths);
    const fill = filled.paint;
    const stroke = stroked.paint;
    if (!fill && !stroke) {
      return null;
    }
    if (fill && style['fill-rule'] === 'evenodd') {
      fail(el, 'is filled with the evenodd rule, which cannot be drawn. Use nonzero');
    }
    const fillOpacity = fraction(el, 'fill-opacity', style['fill-opacity']) * filled.opacity;
    const strokeOpacity = fraction(el, 'stroke-opacity', style['stroke-opacity']) * stroked.opacity;
    if (fill && stroke && fillOpacity !== strokeOpacity) {
      const stops = [filled.opacity < 1 ? 'fill' : '', stroked.opacity < 1 ? 'stroke' : '']
        .filter(Boolean)
        .join(' or ');
      fail(
        el,
        stops
          ? `has a fill and a stroke that differ in opacity (a stop-opacity of the ${stops} gradient counts), which cannot be drawn`
          : 'has a fill-opacity and a stroke-opacity that differ, which cannot be drawn'
      );
    }
    const out: Style = {};
    if (fill) {
      out.fill = fill;
    }
    if (stroke) {
      out.stroke = stroke;
      // A stroke is as wide as the transform makes it. This is exact for a uniform scale.
      const det = Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2]);
      out.strokeWidth = length(el, 'stroke-width', style['stroke-width'], 1) * Math.sqrt(det);
      const cap = style['stroke-linecap'];
      if (cap === 'round' || cap === 'square') {
        out.lineCap = cap;
      } else if (cap !== undefined && cap !== 'butt') {
        fail(el, `has stroke-linecap="${cap}", which cannot be drawn`);
      }
      const join = style['stroke-linejoin'];
      if (join === 'round' || join === 'bevel') {
        out.lineJoin = join;
      } else if (join !== undefined && join !== 'miter') {
        fail(el, `has stroke-linejoin="${join}", which cannot be drawn`);
      }
    }
    return {
      name,
      items: [{ paths: transformPaths(paths, matrix), style: out }],
      children: [],
      opacity: opacity * (fill ? fillOpacity : strokeOpacity) * 100,
      ...clipped,
    };
  };

  const visit = (el: INode, parent: Matrix, inherited: Inherited): ArtNode | null => {
    if (REFUSED[el.name]) {
      return fail(el, REFUSED[el.name]);
    }
    if (SKIPPED.has(el.name)) {
      // Definitions draw nothing, but a refused feature inside them still stops the build.
      const check = (inner: INode) => {
        if (REFUSED[inner.name]) {
          fail(inner, REFUSED[inner.name]);
        }
        (inner.children ?? []).forEach(check);
      };
      (el.children ?? []).forEach(check);
      return null;
    }
    if (el.name !== 'g' && !SHAPES.has(el.name)) {
      return fail(el, 'is not an element the importer can draw');
    }
    return walk(el, parent, inherited, el.attributes?.id || el.name);
  };

  const box = root.attributes?.viewBox ? numbers(root.attributes.viewBox) : [0, 0];
  const origin: Matrix = [1, 0, 0, 1, -(box[0] ?? 0), -(box[1] ?? 0)];
  const made = walk(root, multiply(base, origin), {}, root.attributes?.id || file);
  return made ?? { name: root.attributes?.id || file, items: [], children: [], opacity: 100 };
}

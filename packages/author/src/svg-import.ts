import { parseSync, type INode } from 'svgson';
import type { BezierPath, ShapeItem, Style, Vec } from './model';
import { parsePathD, transformPaths, type Matrix } from './path';

/** The drawing uses something the importer cannot turn into plain filled and stroked paths. */
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
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** Control point distance for a quarter circle of radius 1. */
const KAPPA = 0.5522847498307936;

/** Things that draw nothing themselves. */
const SKIPPED = new Set(['defs', 'title', 'desc', 'metadata', 'clipPath']);
/** Things we refuse wherever they appear, used or not. */
const REFUSED: Record<string, string> = {
  filter: 'is a filter',
  mask: 'is a mask',
  pattern: 'is a pattern fill',
  image: 'is a bitmap image',
  text: 'is live text. Convert it to paths, or use label()',
  linearGradient: 'is a gradient',
  radialGradient: 'is a gradient',
};
const REFUSED_ATTRIBUTES: Record<string, string> = {
  'clip-path': 'uses a clip path',
  mask: 'uses a mask',
  filter: 'uses a filter',
  'stroke-dasharray': 'has a dashed stroke',
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
 * to 0,0; lengths stay in the drawing's own units. Anything the importer cannot draw faithfully
 * throws UnsupportedSvgError.
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

  const byId = new Map<string, INode>();
  const index = (el: INode) => {
    if (el.attributes?.id) {
      byId.set(el.attributes.id, el);
    }
    (el.children ?? []).forEach(index);
  };
  index(root);

  const fail = (el: INode, reason: string): never => {
    throw new UnsupportedSvgError(el.name, el.attributes?.id ?? null, file, reason);
  };

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

  /** A paint as #rrggbb, or undefined for none. */
  const colour = (el: INode, name: string, value: string | undefined): string | undefined => {
    if (value === undefined || value === 'none' || value === 'transparent') {
      return undefined;
    }
    const ref = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)/.exec(value);
    if (ref) {
      const target = byId.get(ref[1]);
      if (target) {
        return fail(target, REFUSED[target.name] ?? `is used as a ${name}, which is not a colour`);
      }
      return fail(el, `has ${name}="${value}", which points at nothing`);
    }
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

  const walk = (el: INode, parent: Matrix, inherited: Inherited, name: string): ArtNode | null => {
    const p = props(el);
    for (const attribute of Object.keys(REFUSED_ATTRIBUTES)) {
      if (p[attribute] !== undefined && p[attribute] !== 'none') {
        fail(el, `${REFUSED_ATTRIBUTES[attribute]}, which cannot be drawn`);
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
      return { name, items: [], children, opacity: opacity * 100 };
    }

    const paths = outline(el, p);
    if (!paths || paths.length === 0) {
      return null;
    }
    // A line encloses nothing, so its fill never shows.
    const fill = el.name === 'line' ? undefined : colour(el, 'fill', style.fill ?? 'black');
    const stroke = colour(el, 'stroke', style.stroke);
    if (!fill && !stroke) {
      return null;
    }
    if (fill && style['fill-rule'] === 'evenodd') {
      fail(el, 'is filled with the evenodd rule, which cannot be drawn. Use nonzero');
    }
    const fillOpacity = fraction(el, 'fill-opacity', style['fill-opacity']);
    const strokeOpacity = fraction(el, 'stroke-opacity', style['stroke-opacity']);
    if (fill && stroke && fillOpacity !== strokeOpacity) {
      fail(el, 'has a fill-opacity and a stroke-opacity that differ, which cannot be drawn');
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
    };
  };

  const visit = (el: INode, parent: Matrix, inherited: Inherited): ArtNode | null => {
    if (REFUSED[el.name]) {
      return fail(el, `${REFUSED[el.name]}, which cannot be drawn`);
    }
    if (SKIPPED.has(el.name)) {
      // Definitions draw nothing, but a refused feature inside them still stops the build.
      const check = (inner: INode) => {
        if (REFUSED[inner.name]) {
          fail(inner, `${REFUSED[inner.name]}, which cannot be drawn`);
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

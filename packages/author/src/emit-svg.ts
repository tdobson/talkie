import { matrixOf, transformAt, trimAt } from './evaluate';
import type { BezierPath, Node, SceneModel, ShapeItem } from './model';
import { flatColour, round3 } from './paint';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const attrs = (pairs: Array<[string, string | number | null]>) =>
  pairs
    .filter(([, value]) => value !== null)
    .map(([name, value]) => ` ${name}="${escape(String(value))}"`)
    .join('');
const round6 = (x: number) => {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
};

function pathD(path: BezierPath): string {
  const point = (x: number, y: number) => `${round3(x)} ${round3(y)}`;
  const count = path.v.length;
  if (count === 0) {
    return '';
  }
  let d = `M${point(path.v[0][0], path.v[0][1])}`;
  const segments = path.closed ? count : count - 1;
  for (let n = 0; n < segments; n++) {
    const from = path.v[n];
    const out = path.o[n];
    const m = (n + 1) % count;
    const to = path.v[m];
    const into = path.i[m];
    const straight = out[0] === 0 && out[1] === 0 && into[0] === 0 && into[1] === 0;
    if (straight && m === 0) {
      // Z draws the straight line home.
      break;
    }
    d += straight
      ? `L${point(to[0], to[1])}`
      : `C${point(from[0] + out[0], from[1] + out[1])} ${point(to[0] + into[0], to[1] + into[1])} ${point(to[0], to[1])}`;
  }
  return path.closed ? `${d}Z` : d;
}

function itemSvg(node: Node, item: ShapeItem, trimEnd: number): string {
  const where = `node "${node.name}" (${node.id})`;
  const { style } = item;
  const stroke = flatColour(style.stroke, where) ? (style.stroke as string) : null;
  const fill = flatColour(style.fill, where) ? (style.fill as string) : 'none';
  const paint: Array<[string, string | number | null]> = [
    ['fill', fill],
    ['stroke', stroke],
    ['stroke-width', stroke ? round3(style.strokeWidth ?? 1) : null],
    ['stroke-linecap', stroke ? (style.lineCap ?? 'butt') : null],
    ['stroke-linejoin', stroke ? (style.lineJoin ?? 'miter') : null],
  ];
  if (!node.trimmed) {
    // One element for the whole item, so that inner paths cut holes as they do in Lottie.
    return `<path${attrs([['d', item.paths.map(pathD).join('')], ...paint])}/>`;
  }
  // Each path is trimmed on its own, as Lottie does with trim mode 1.
  return item.paths
    .map(
      (path) =>
        `<path${attrs([
          ['d', pathD(path)],
          ...paint,
          ['pathLength', 100],
          ['stroke-dasharray', 100],
          ['stroke-dashoffset', round3(100 - trimEnd)],
        ])}/>`
    )
    .join('');
}

function nodeSvg(node: Node, t: number): string {
  const tr = transformAt(node, t);
  const matrix = matrixOf(tr).map(round6);
  const plain = matrix.join(' ') === '1 0 0 1 0 0';
  const opacity = Math.min(1, Math.max(0, tr.opacity / 100));
  const open = `<g${attrs([
    ['data-node', node.id],
    ['data-name', node.name],
    ['transform', plain ? null : `matrix(${matrix.join(' ')})`],
    ['opacity', opacity === 1 ? null : round3(opacity)],
  ])}>`;
  // Children first, then the node's own items on top, matching the Lottie group order.
  const children = node.children.map((child) => nodeSvg(child, t)).join('');
  const trimEnd = trimAt(node, t);
  const items = node.items.map((item) => itemSvg(node, item, trimEnd)).join('');
  return `${open}${children}${items}</g>`;
}

/** The scene at t seconds as an SVG string. It mirrors the tree that emitLottie writes. */
export function svgAt(model: SceneModel, t: number): string {
  const [w, h] = model.size;
  const camera: Node = { ...model.camera, children: model.nodes };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${nodeSvg(camera, t)}</svg>`;
}

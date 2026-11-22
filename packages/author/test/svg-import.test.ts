import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compileScene,
  emitLottie,
  importSvg,
  scene,
  UnsupportedSvgError,
  type ArtNode,
  type BezierPath,
  type Gradient,
  type LinearGradient,
  type Loaders,
  type Matrix,
  type RadialGradient,
  type ShapeItem,
  type Vec,
} from '../src/index';

const ART = join(__dirname, 'fixtures', 'art');
const read = (name: string) => readFileSync(join(ART, `${name}.svg`), 'utf8');
const load = (name: string): ArtNode => importSvg(read(name), `${name}.svg`);
const find = (root: ArtNode, name: string): ArtNode => {
  const walk = (n: ArtNode): ArtNode | undefined =>
    n.name === name ? n : n.children.map(walk).find(Boolean);
  const hit = walk(root);
  if (!hit) {
    throw new Error(`no node called ${name}`);
  }
  return hit;
};
const close = (got: Vec[], want: Vec[]) => {
  expect(got).toHaveLength(want.length);
  got.forEach((p, n) => {
    expect(p[0]).toBeCloseTo(want[n][0], 6);
    expect(p[1]).toBeCloseTo(want[n][1], 6);
  });
};
const bbox = (vs: Vec[]) => ({
  x1: Math.min(...vs.map((v) => v[0])),
  y1: Math.min(...vs.map((v) => v[1])),
  x2: Math.max(...vs.map((v) => v[0])),
  y2: Math.max(...vs.map((v) => v[1])),
});

describe('importSvg, one fixture per element', () => {
  it('reads a path and names the node after its id', () => {
    const root = load('path');
    expect(root.name).toBe('path.svg');
    const roof = find(root, 'roof');
    expect(roof.items).toHaveLength(1);
    expect(roof.items[0].style).toEqual({ fill: '#ff0000' });
    expect(roof.items[0].paths[0].closed).toBe(true);
    close(roof.items[0].paths[0].v, [
      [10, 10],
      [90, 10],
      [50, 80],
    ]);
    expect(roof.opacity).toBe(100);
  });

  it('reads a rect', () => {
    const tile = find(load('rect'), 'tile');
    expect(tile.items[0].style).toEqual({ fill: '#00ff00' });
    expect(tile.items[0].paths[0].closed).toBe(true);
    close(tile.items[0].paths[0].v, [
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]);
  });

  it('reads a rounded rect, with ry taken from rx', () => {
    const [path] = find(load('rect-round'), 'pad').items[0].paths;
    expect(path.closed).toBe(true);
    expect(path.v).toHaveLength(8);
    const box = bbox(path.v);
    expect(box.x1).toBeCloseTo(0, 9);
    expect(box.y1).toBeCloseTo(0, 9);
    expect(box.x2).toBeCloseTo(40, 9);
    expect(box.y2).toBeCloseTo(20, 9);
    expect(path.v.some(([x, y]) => Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6)).toBe(false);
  });

  it('reads a circle', () => {
    const [path] = find(load('circle'), 'nail').items[0].paths;
    expect(path.closed).toBe(true);
    close(path.v, [
      [50, 40],
      [60, 50],
      [50, 60],
      [40, 50],
    ]);
    expect(path.o[0][0]).toBeCloseTo(5.522847, 5);
  });

  it('reads an ellipse', () => {
    const [path] = find(load('ellipse'), 'knot').items[0].paths;
    close(path.v, [
      [50, 30],
      [70, 40],
      [50, 50],
      [30, 40],
    ]);
    expect(path.o[1][1]).toBeCloseTo(5.522847, 5);
  });

  it('reads a line, which has a stroke and no fill', () => {
    const item = find(load('line'), 'batten').items[0];
    expect(item.style).toEqual({ stroke: '#333333', strokeWidth: 4, lineCap: 'round' });
    expect(item.paths[0].closed).toBe(false);
    close(item.paths[0].v, [
      [10, 20],
      [90, 20],
    ]);
  });

  it('reads a polyline', () => {
    const item = find(load('polyline'), 'lap').items[0];
    expect(item.style).toEqual({ stroke: '#333333', strokeWidth: 2, lineJoin: 'round' });
    expect(item.paths[0].closed).toBe(false);
    close(item.paths[0].v, [
      [10, 10],
      [50, 40],
      [90, 10],
    ]);
  });

  it('reads a polygon and an rgb() colour', () => {
    const item = find(load('polygon'), 'slate').items[0];
    expect(item.style).toEqual({ fill: '#ff8000' });
    expect(item.paths[0].closed).toBe(true);
    expect(item.paths[0].v).toHaveLength(3);
  });

  it('reads groups, with inherited paint and the group opacity on the group node', () => {
    const root = load('group');
    const roof = find(root, 'roof');
    expect(roof.opacity).toBe(50);
    expect(roof.items).toEqual([]);
    expect(roof.children.map((c) => c.name)).toEqual(['a', 'inner']);
    expect(find(root, 'a').items[0].style).toEqual({ fill: '#abcdef' });
    expect(find(root, 'a').opacity).toBe(100);
    expect(find(root, 'b').items[0].style).toEqual({ stroke: '#000000', strokeWidth: 3 });
  });
});

describe('importSvg transforms and styles', () => {
  it('bakes nested transforms into the points and scales the stroke width', () => {
    const item = find(load('nested-transform'), 'box').items[0];
    close(item.paths[0].v, [
      [6, 32],
      [6, 38],
      [-2, 38],
      [-2, 32],
    ]);
    expect(item.style.strokeWidth).toBeCloseTo(3, 9);
  });

  it('applies a base matrix to everything', () => {
    const root = importSvg(read('line'), 'line.svg', [2, 0, 0, 2, 100, 200]);
    const item = find(root, 'batten').items[0];
    close(item.paths[0].v, [
      [120, 240],
      [280, 240],
    ]);
    expect(item.style.strokeWidth).toBe(8);
  });

  it('moves the viewBox origin to 0,0', () => {
    const svg =
      '<svg viewBox="10 20 100 100"><rect id="r" x="10" y="20" width="5" height="5"/></svg>';
    const item = find(importSvg(svg, 'vb.svg'), 'r').items[0];
    expect(item.style).toEqual({ fill: '#000000' });
    expect(bbox(item.paths[0].v)).toEqual({ x1: 0, y1: 0, x2: 5, y2: 5 });
  });

  it('lets inline style win, and folds uniform paint opacity into the node', () => {
    const root = load('styles');
    const inline = find(root, 'inline');
    expect(inline.items[0].style).toEqual({ fill: '#00ff00', stroke: '#000000', strokeWidth: 2 });
    expect(inline.opacity).toBeCloseTo(40, 9);
    const fillOnly = find(root, 'fill-only');
    expect(fillOnly.items[0].style).toEqual({ fill: '#ffffff' });
    expect(fillOnly.opacity).toBe(25);
    expect(root.children.map((c) => c.name)).toEqual(['inline', 'fill-only']);
  });

  it('refuses fill and stroke opacities that differ', () => {
    expect(() => load('mixed-opacity')).toThrow(UnsupportedSvgError);
    expect(() => load('mixed-opacity')).toThrow(/mixed-opacity\.svg: <rect id="mixed">/);
  });

  it('gives the same output every time', () => {
    expect(JSON.stringify(load('group'))).toBe(JSON.stringify(load('group')));
  });
});

describe('importSvg refuses what it cannot draw', () => {
  it.each([
    ['unsupported-filter', 'filter', 'blur', ''],
    ['unsupported-mask', 'mask', 'hole', ''],
    ['unsupported-pattern', 'pattern', 'dots', ''],
    ['unsupported-image', 'image', 'photo', ''],
    ['unsupported-text', 'text', 'words', ''],
    ['unsupported-gradient-reflect', 'linearGradient', 'stripes', 'spreadMethod="reflect"'],
    ['unsupported-gradient-focal-outside', 'radialGradient', 'glint', 'focal point'],
    ['unsupported-gradient-fr', 'radialGradient', 'halo', 'focal radius'],
    ['unsupported-gradient-flat-bbox', 'line', 'rule', 'objectBoundingBox'],
    ['unsupported-gradient-href-loop', 'linearGradient', 'a', 'href loop: a, b, a'],
    ['unsupported-gradient-linearrgb', 'linearGradient', 'mix', 'linearRGB'],
    ['unsupported-gradient-currentcolor', 'stop', 'first', 'takes its colour from elsewhere'],
    ['unsupported-style-sheet', 'style', 'sheet', 'style sheet'],
    ['unsupported-duplicate-id', 'rect', 'plate', 'points at id "sky", which two elements share'],
    ['unsupported-blend-mode', 'rect', 'shadow', 'blend mode'],
    ['unsupported-radial-stroke-stretched', 'ellipse', 'dish', 'stretched'],
    ['unsupported-clip-group-child', 'g', 'bundle', 'browsers ignore a group inside a clipPath'],
    ['unsupported-clip-evenodd', 'path', 'ring', 'evenodd rule'],
    ['unsupported-clip-evenodd-on-defs', 'path', 'ring', 'evenodd rule'],
    ['unsupported-clip-overlap', 'path', 'frame', 'subpaths that overlap'],
    ['unsupported-clip-inset', 'rect', 'plate', 'only url(#id) of a clipPath is read'],
    ['unsupported-clip-missing', 'rect', 'plate', 'points at nothing'],
    ['unsupported-clip-clips-a-clip', 'clipPath', 'cut', 'clips a clip'],
  ])('%s', (name, element, id, reason) => {
    let caught: unknown;
    try {
      load(name);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedSvgError);
    const error = caught as UnsupportedSvgError;
    expect(error.name).toBe('UnsupportedSvgError');
    expect(error.element).toBe(element);
    expect(error.id).toBe(id);
    expect(error.file).toBe(`${name}.svg`);
    expect(error.message).toContain(`${name}.svg: <${element} id="${id}">`);
    expect(error.message).toContain(reason);
    expect(error.message).not.toMatch(/[\u2013\u2014]/);
  });

  it('allows a clipPath that nothing uses', () => {
    expect(load('unused-clip-path').children.map((c) => c.name)).toEqual(['plain']);
  });

  it('refuses elements it does not know, and says when there is no id', () => {
    const svg = '<svg><use href="#a"/></svg>';
    expect(() => importSvg(svg, 'use.svg')).toThrow(UnsupportedSvgError);
    expect(() => importSvg(svg, 'use.svg')).toThrow(/use\.svg: <use> \(no id\)/);
  });

  it.each([
    ['marker-end="url(#m)"', 'markers'],
    ['marker-start="url(#m)"', 'markers'],
    ['marker-mid="url(#m)"', 'markers'],
    ['style="marker: url(#m)"', 'markers'],
    ['paint-order="stroke"', 'paint-order'],
    ['vector-effect="non-scaling-stroke"', 'vector-effect'],
  ])('refuses %s, which would change the picture', (attribute, reason) => {
    const text = `<svg><g id="g" ${attribute}><path d="M0 0H10" stroke="#000"/></g></svg>`;
    expect(() => importSvg(text, 'a.svg')).toThrow(UnsupportedSvgError);
    expect(() => importSvg(text, 'a.svg')).toThrow(new RegExp(`<g id="g"> .*${reason}`));
  });

  it('accepts the harmless values of those attributes', () => {
    const text =
      '<svg><path id="p" d="M0 0H10" stroke="#000" marker-end="none" paint-order="normal" vector-effect="none"/></svg>';
    expect(importSvg(text, 'a.svg').children.map((c) => c.name)).toEqual(['p']);
  });

  it('refuses colours and lengths it cannot read', () => {
    const colour = '<svg><rect id="r" width="5" height="5" fill="currentColor"/></svg>';
    expect(() => importSvg(colour, 'c.svg')).toThrow(UnsupportedSvgError);
    const length = '<svg><rect id="r" width="50%" height="5"/></svg>';
    expect(() => importSvg(length, 'c.svg')).toThrow(UnsupportedSvgError);
  });
});

describe('ctx.art', () => {
  const loaders: Loaders = {
    svg: (name) => read(name),
    font: () => {
      throw new Error('no font in this test');
    },
  };
  const input = { size: [1920, 1080] as [number, number], lines: [], duration: 4, loaders };

  it('makes scene nodes, placed and scaled, that can be animated', () => {
    const model = compileScene(
      scene('s', (ctx) => {
        const art = ctx.art('group', { at: [100, 200], scale: 2 });
        ctx.add(art);
        ctx.fade(art, 0.5);
      }),
      input
    );
    const [art] = model.nodes;
    expect(art.name).toBe('group');
    expect(art.transform.position).toEqual([0, 0]);
    const roof = art.children[0];
    expect(roof.name).toBe('roof');
    expect(roof.transform.opacity).toBe(50);
    const [a, inner] = roof.children;
    expect(bbox(a.items[0].paths[0].v)).toEqual({ x1: 100, y1: 200, x2: 120, y2: 220 });
    expect(inner.children[0].items[0].style.strokeWidth).toBe(6);
    const ids = [art, roof, a, inner, inner.children[0]].map((n) => n.id);
    expect(new Set(ids).size).toBe(5);
    expect(() => emitLottie(model)).not.toThrow();
  });

  it('defaults to scale 1', () => {
    const model = compileScene(
      scene('s', (ctx) => ctx.add(ctx.art('rect', { at: [5, 5] }))),
      input
    );
    expect(bbox(model.nodes[0].children[0].items[0].paths[0].v)).toEqual({
      x1: 15,
      y1: 25,
      x2: 45,
      y2: 65,
    });
  });

  it('says so when the scene was compiled without loaders', () => {
    expect(() =>
      compileScene(
        scene('s', (ctx) => ctx.add(ctx.art('rect', { at: [0, 0] }))),
        { size: [1920, 1080], lines: [], duration: 4 }
      )
    ).toThrow(/scene s: art\("rect"\) needs loaders/);
  });
});

describe('importSvg gradients', () => {
  const STOPS = '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#00f"/>';
  const WHITE_BLUE = [
    { offset: 0, colour: '#ffffff', opacity: 1 },
    { offset: 1, colour: '#0000ff', opacity: 1 },
  ];
  const svg = (defs: string, body: string, root = 'viewBox="0 0 200 100"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${root}><defs>${defs}</defs>${body}</svg>`;
  const itemOf = (text: string, id: string): ShapeItem =>
    find(importSvg(text, 't.svg'), id).items[0];
  const linear = (text: string, id = 'r') => itemOf(text, id).style.fill as LinearGradient;
  const radial = (text: string, id = 'r') => itemOf(text, id).style.fill as RadialGradient;
  /** t of a point under SVG's own rule: the inverse of the gradient matrix, then a projection. */
  const svgT = (m: Matrix, p1: Vec, p2: Vec, [x, y]: Vec) => {
    const det = m[0] * m[3] - m[1] * m[2];
    const dx = x - m[4];
    const dy = y - m[5];
    const g: Vec = [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det];
    const d: Vec = [p2[0] - p1[0], p2[1] - p1[1]];
    return ((g[0] - p1[0]) * d[0] + (g[1] - p1[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  };
  const bakedT = (g: LinearGradient, [x, y]: Vec) => {
    const d: Vec = [g.to[0] - g.from[0], g.to[1] - g.from[1]];
    return ((x - g.from[0]) * d[0] + (y - g.from[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  };

  it('reads the linear gradient fixture with objectBoundingBox defaults', () => {
    const item = find(load('gradient-linear'), 'shaded').items[0];
    expect(item.style.fill).toEqual({
      type: 'linear',
      from: [0, 0],
      to: [10, 0],
      stops: WHITE_BLUE,
    });
  });

  it('reads the radial gradient fixture as a stroke on a square, baked into the item', () => {
    const item = find(load('gradient-radial'), 'lit').items[0];
    expect(item.style.fill).toBe('#000000');
    expect(item.style.stroke).toEqual({
      type: 'radial',
      centre: [5, 5],
      radius: 5,
      focal: [5, 5],
      stops: WHITE_BLUE,
    });
  });

  it('reads userSpaceOnUse percentages against the viewBox, and refuses them with nothing to read against', () => {
    const defs = `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0%" y1="10%" x2="50%" y2="10%">${STOPS}</linearGradient>`;
    const body = '<rect id="r" width="200" height="100" fill="url(#g)"/>';
    const g = linear(svg(defs, body));
    expect(g.from).toEqual([0, 10]);
    expect(g.to[0]).toBeCloseTo(100, 9);
    expect(g.to[1]).toBeCloseTo(10, 9);
    expect(linear(svg(defs, body, 'width="200" height="100"')).to[0]).toBeCloseTo(100, 9);
    expect(() => importSvg(svg(defs, body, ''), 't.svg')).toThrow(/percentage/);
  });

  it.each([
    ['rotate', 'rotate(30 0.5 0.5)'],
    ['skewX', 'skewX(25)'],
    ['a matrix', 'matrix(1 0.3 -0.2 0.8 0.1 0)'],
  ])('bakes a gradientTransform with %s exactly', (_name, gt) => {
    const defs = `<linearGradient id="g" x1="0.1" y1="0.2" x2="0.9" y2="0.6" gradientTransform="${gt}">${STOPS}</linearGradient>`;
    const text = svg(
      defs,
      '<rect id="r" x="20" y="10" width="120" height="60" transform="translate(5 7) rotate(10)" fill="url(#g)"/>'
    );
    const g = linear(text);
    const r = (10 * Math.PI) / 180;
    const ctm: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 5, 7];
    const box: Matrix = [120, 0, 0, 60, 20, 10];
    const gtm = (() => {
      const m = multiplyAll([ctm, box]);
      // The gradient transform, built the way SVG reads it.
      const parsed = importSvg(
        `<svg><path id="p" d="M0 0L1 0L0 1Z" transform="${gt}"/></svg>`,
        'gt.svg'
      );
      const [o, x, y] = find(parsed, 'p').items[0].paths[0].v;
      return multiplyAll([m, [x[0] - o[0], x[1] - o[1], y[0] - o[0], y[1] - o[1], o[0], o[1]]]);
    })();
    for (const corner of [
      [20, 10],
      [140, 10],
      [140, 70],
      [20, 70],
    ] as Vec[]) {
      const p: Vec = [
        ctm[0] * corner[0] + ctm[2] * corner[1] + ctm[4],
        ctm[1] * corner[0] + ctm[3] * corner[1] + ctm[5],
      ];
      expect(Math.abs(bakedT(g, p) - svgT(gtm, [0.1, 0.2], [0.9, 0.6], p))).toBeLessThan(1e-9);
    }
  });

  it('bakes an objectBoundingBox radial on a square, and keeps a matrix for an ellipse', () => {
    const defs = `<radialGradient id="g">${STOPS}</radialGradient>`;
    const square = radial(
      svg(defs, '<rect id="r" x="10" y="20" width="40" height="40" fill="url(#g)"/>')
    );
    expect(square).toEqual({
      type: 'radial',
      centre: [30, 40],
      radius: 20,
      focal: [30, 40],
      stops: WHITE_BLUE,
    });
    const wide = radial(
      svg(defs, '<ellipse id="r" cx="50" cy="50" rx="40" ry="10" fill="url(#g)"/>')
    );
    expect(wide.centre).toEqual([0.5, 0.5]);
    expect(wide.radius).toBe(0.5);
    expect(wide.focal).toEqual([0.5, 0.5]);
    const m = wide.matrix as Matrix;
    [80, 0, 0, 20, 10, 40].forEach((v, n) => expect(m[n]).toBeCloseTo(v, 9));
  });

  it('bakes a box stretched by far less than the tolerance', () => {
    const defs = `<radialGradient id="g">${STOPS}</radialGradient>`;
    const g = radial(svg(defs, '<rect id="r" width="100" height="100.0000001" fill="url(#g)"/>'));
    expect(g.matrix).toBeUndefined();
    expect(g.radius).toBeCloseTo(50, 6);
  });

  it('keeps the focal point, and refuses one at 0.995 of the radius', () => {
    const near = `<radialGradient id="g" fx="0.7">${STOPS}</radialGradient>`;
    const g = radial(svg(near, '<rect id="r" width="10" height="10" fill="url(#g)"/>'));
    expect(g.focal[0]).toBeCloseTo(7, 9);
    expect(g.focal[1]).toBeCloseTo(5, 9);
    const far = `<radialGradient id="g" fx="0.9975">${STOPS}</radialGradient>`;
    expect(() =>
      importSvg(svg(far, '<rect id="r" width="10" height="10" fill="url(#g)"/>'), 't.svg')
    ).toThrow(/focal point/);
  });

  it('says a focal point near the edge is too near the edge, not outside', () => {
    const near = `<radialGradient id="g" fx="0.9975">${STOPS}</radialGradient>`;
    expect(() =>
      importSvg(svg(near, '<rect id="r" width="10" height="10" fill="url(#g)"/>'), 't.svg')
    ).toThrow(
      /focal point fx, fy within 1% of the edge of the circle or beyond it, which cannot be drawn\. Move it further in/
    );
  });

  it('refuses linearRGB colour mixing inherited from an ancestor, in any case', () => {
    const body = '<rect id="r" width="10" height="10" fill="url(#g)"/>';
    const gradient = `<linearGradient id="g">${STOPS}</linearGradient>`;
    const onDefs = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><defs color-interpolation="linearRGB">${gradient}</defs>${body}</svg>`;
    expect(() => importSvg(onDefs, 't.svg')).toThrow(/<linearGradient id="g"> asks for linearRGB/);
    const onRoot = svg(gradient, body, 'viewBox="0 0 200 100" color-interpolation="linearRGB"');
    expect(() => importSvg(onRoot, 't.svg')).toThrow(/linearRGB/);
    const mixed = svg(
      `<linearGradient id="g" color-interpolation="LinearRGB">${STOPS}</linearGradient>`,
      body
    );
    expect(() => importSvg(mixed, 't.svg')).toThrow(/linearRGB/);
    // sRGB and auto are what the film draws, and the gradient may say so over an ancestor.
    const over = svg(
      `<linearGradient id="g" color-interpolation="SRGB">${STOPS}</linearGradient>`,
      body,
      'viewBox="0 0 200 100" color-interpolation="linearRGB"'
    );
    expect(linear(over).stops).toEqual(WHITE_BLUE);
    // On the shape that uses the gradient it makes no difference.
    const onShape = svg(gradient, body.replace('<rect', '<rect color-interpolation="linearRGB"'));
    expect(linear(onShape).stops).toEqual(WHITE_BLUE);
  });

  it('paints no fill for an objectBoundingBox gradient on a shape with no area, as browsers do', () => {
    const defs = `<linearGradient id="g">${STOPS}</linearGradient>`;
    const body =
      '<g fill="url(#g)" stroke="#000"><rect id="box" width="10" height="10"/><path id="rule" d="M10 50 H190"/></g>';
    const rule = find(importSvg(svg(defs, body), 't.svg'), 'rule');
    expect(rule.items[0].style).toEqual({ stroke: '#000000', strokeWidth: 1 });
    expect(rule.opacity).toBe(100);
  });

  it('names the stop-opacity when a flattened gradient fill and a stroke differ in opacity', () => {
    const defs =
      '<linearGradient id="g"><stop stop-color="#123456" stop-opacity="0.5"/></linearGradient>';
    const body = '<rect id="r" width="10" height="10" fill="url(#g)" stroke="#000"/>';
    expect(() => importSvg(svg(defs, body), 't.svg')).toThrow(
      /<rect id="r"> has a fill and a stroke that differ in opacity \(a stop-opacity of the fill gradient counts\), which cannot be drawn/
    );
  });

  it('follows href for stops and attributes, own attributes first, xlink:href too', () => {
    const defs =
      `<linearGradient id="base" x1="0" x2="0" y2="1">${STOPS}</linearGradient>` +
      '<linearGradient id="own" href="#base" x1="0.5"/>' +
      '<linearGradient id="old" xlink:href="#own"/>' +
      '<radialGradient id="round" href="#base" r="0.25"/>';
    const body =
      '<rect id="r" width="10" height="10" fill="url(#old)"/>' +
      '<rect id="q" width="10" height="10" fill="url(#round)"/>';
    const text = svg(
      defs,
      body,
      'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100"'
    );
    const g = linear(text);
    expect(g.stops).toEqual(WHITE_BLUE);
    // x1 0.5 from "own", x2 0, y1 0 and y2 1 from "base".
    expect(bakedT(g, [5, 0])).toBeCloseTo(0, 9);
    expect(bakedT(g, [0, 10])).toBeCloseTo(1, 9);
    expect(bakedT(g, [0, 0])).toBeCloseTo(0.2, 9);
    const r = radial(text, 'q');
    // Only the stops cross from a linear gradient to a radial one: cx and cy keep their defaults.
    expect(r).toEqual({
      type: 'radial',
      centre: [5, 5],
      radius: 2.5,
      focal: [5, 5],
      stops: WHITE_BLUE,
    });
  });

  it('reads stop offsets and colours as SVG does', () => {
    const defs =
      '<linearGradient id="g">' +
      '<stop offset="-0.5" stop-color="#ff0000"/>' +
      '<stop offset="25%" style="stop-color: #00ff00; stop-opacity: 0.5"/>' +
      '<stop offset="1e-1"/>' +
      '<stop offset="0.75" stop-color="rgb(0, 0, 255)" stop-opacity="40%"/>' +
      '</linearGradient>';
    const g = linear(svg(defs, '<rect id="r" width="10" height="10" fill="url(#g)"/>'));
    expect(g.stops).toEqual([
      { offset: 0, colour: '#ff0000', opacity: 1 },
      { offset: 0.25, colour: '#00ff00', opacity: 0.5 },
      { offset: 0.25, colour: '#000000', opacity: 1 },
      { offset: 0.75, colour: '#0000ff', opacity: 0.4 },
    ]);
  });

  it('draws nothing with no stops, and a flat colour with one stop or stops that all match', () => {
    const body = '<rect id="r" width="10" height="10" fill="url(#g)"/>';
    expect(
      find(importSvg(svg('<linearGradient id="g"/>', body), 't.svg'), 't.svg').children
    ).toEqual([]);
    const one = find(
      importSvg(
        svg(
          '<linearGradient id="g"><stop stop-color="#123456" stop-opacity="0.5"/></linearGradient>',
          body
        ),
        't.svg'
      ),
      'r'
    );
    expect(one.items[0].style).toEqual({ fill: '#123456' });
    expect(one.opacity).toBe(50);
    const same = find(
      importSvg(
        svg(
          '<radialGradient id="g"><stop offset="0" stop-color="#123456"/><stop offset="1" stop-color="#123456"/></radialGradient>',
          body
        ),
        't.svg'
      ),
      'r'
    );
    expect(same.items[0].style).toEqual({ fill: '#123456' });
    expect(same.opacity).toBe(100);
  });

  it('paints a degenerate gradient with its last stop, as SVG does', () => {
    const body = '<rect id="r" width="10" height="10" fill="url(#g)" fill-opacity="0.5"/>';
    const stops =
      '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#00f" stop-opacity="0.5"/>';
    const flatLine = find(
      importSvg(svg(`<linearGradient id="g" x2="0">${stops}</linearGradient>`, body), 't.svg'),
      'r'
    );
    expect(flatLine.items[0].style).toEqual({ fill: '#0000ff' });
    expect(flatLine.opacity).toBe(25);
    const noRadius = find(
      importSvg(svg(`<radialGradient id="g" r="0">${stops}</radialGradient>`, body), 't.svg'),
      'r'
    );
    expect(noRadius.items[0].style).toEqual({ fill: '#0000ff' });
  });

  it('uses the box of each shape for a gradient a group hands down', () => {
    const defs = `<linearGradient id="g">${STOPS}</linearGradient>`;
    const body =
      '<g fill="url(#g)"><rect id="a" width="10" height="10"/><rect id="b" x="50" width="40" height="10"/></g>';
    const text = svg(defs, body);
    expect((itemOf(text, 'a').style.fill as LinearGradient).to).toEqual([10, 0]);
    expect((itemOf(text, 'b').style.fill as LinearGradient).from).toEqual([50, 0]);
    expect((itemOf(text, 'b').style.fill as LinearGradient).to).toEqual([90, 0]);
  });

  it('accepts a linear gradient stroke, and a url with a fallback colour', () => {
    const defs = `<linearGradient id="g">${STOPS}</linearGradient>`;
    const item = itemOf(
      svg(
        defs,
        `<rect id="r" width="10" height="10" fill="url('#g') #f00" stroke="url(#g)" stroke-width="2"/>`
      ),
      'r'
    );
    expect((item.style.fill as Gradient).type).toBe('linear');
    expect((item.style.stroke as Gradient).type).toBe('linear');
    expect(item.style.strokeWidth).toBe(2);
  });

  it('ignores gradients nothing uses, even ones it could not draw, and ids nothing points at twice', () => {
    const defs =
      `<linearGradient id="g" spreadMethod="repeat">${STOPS}</linearGradient>` +
      `<linearGradient id="h">${STOPS}</linearGradient><linearGradient id="h">${STOPS}</linearGradient>`;
    expect(() =>
      importSvg(svg(defs, '<rect id="r" width="10" height="10"/>'), 't.svg')
    ).not.toThrow();
  });

  it('refuses urls into other files, at other elements and at nothing', () => {
    const defs = `<linearGradient id="g">${STOPS}</linearGradient>`;
    const outside = svg(defs, '<rect id="r" width="10" height="10" fill="url(other.svg#g)"/>');
    expect(() => importSvg(outside, 't.svg')).toThrow(
      /<rect id="r"> has fill="url\(other.svg#g\)", which points outside this file/
    );
    const atRect = svg(
      defs,
      '<rect id="q" width="1" height="1"/><rect id="r" width="10" height="10" fill="url(#q)"/>'
    );
    expect(() => importSvg(atRect, 't.svg')).toThrow(
      /<rect id="q"> is used as a fill, which is not a gradient or a colour/
    );
    const missing = svg(defs, '<rect id="r" width="10" height="10" fill="url(#nope)"/>');
    expect(() => importSvg(missing, 't.svg')).toThrow(/points at nothing/);
    const hrefOut = svg(
      '<linearGradient id="g" href="other.svg#x"/>',
      '<rect id="r" width="10" height="10" fill="url(#g)"/>'
    );
    expect(() => importSvg(hrefOut, 't.svg')).toThrow(/points outside this file/);
    const hrefRect = svg(
      '<linearGradient id="g" href="#r"/>',
      '<rect id="r" width="10" height="10" fill="url(#g)"/>'
    );
    expect(() => importSvg(hrefRect, 't.svg')).toThrow(/points at a <rect>, not a gradient/);
  });

  it('refuses gradient children that are not stops, and units it cannot read', () => {
    const body = '<rect id="r" width="10" height="10" fill="url(#g)"/>';
    const child = svg(`<linearGradient id="g">${STOPS}<animate id="move"/></linearGradient>`, body);
    expect(() => importSvg(child, 't.svg')).toThrow(
      /<animate id="move"> is inside a gradient, which only holds stops/
    );
    const units = svg(
      `<linearGradient id="g" gradientUnits="strokeBox">${STOPS}</linearGradient>`,
      body
    );
    expect(() => importSvg(units, 't.svg')).toThrow(
      /gradientUnits="strokeBox", which cannot be read/
    );
    const singular = svg(
      `<linearGradient id="g" gradientTransform="scale(0 1)">${STOPS}</linearGradient>`,
      body
    );
    expect(() => importSvg(singular, 't.svg')).toThrow(/<linearGradient id="g"> is squashed flat/);
  });

  it('gives the same bytes every time', () => {
    const defs = `<radialGradient id="g" fx="0.3" gradientTransform="rotate(20)">${STOPS}</radialGradient>`;
    const text = svg(defs, '<ellipse id="r" cx="50" cy="50" rx="40" ry="10" fill="url(#g)"/>');
    expect(JSON.stringify(importSvg(text, 't.svg'))).toBe(JSON.stringify(importSvg(text, 't.svg')));
  });
});

function multiplyAll(ms: Matrix[]): Matrix {
  return ms.reduce((a, b) => [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]);
}

describe('importSvg clip paths', () => {
  const svg = (defs: string, body: string, root = 'viewBox="0 0 200 100"') =>
    `<svg xmlns="http://www.w3.org/2000/svg" ${root}><defs>${defs}</defs>${body}</svg>`;
  const clipOf = (text: string, id: string) =>
    find(importSvg(text, 't.svg'), id).clip as BezierPath[];
  const corners = (paths: BezierPath[]) => paths.map((path) => bbox(path.v));

  it('reads the clip fixture as one contour on the clipped shape', () => {
    const clipped = find(load('clip-rect'), 'clipped');
    expect(clipped.clip).toHaveLength(1);
    expect(clipped.clip?.[0].closed).toBe(true);
    expect(corners(clipped.clip ?? [])).toEqual([{ x1: 0, y1: 0, x2: 5, y2: 5 }]);
    expect(clipped.items).toHaveLength(1);
  });

  it('clips a group in user space, with the transforms of the group, the clipPath and the child', () => {
    const defs =
      '<clipPath id="c" transform="translate(10 0)"><rect x="0" y="0" width="20" height="10" transform="scale(2)"/></clipPath>';
    const body =
      '<g id="grp" transform="translate(0 5)" clip-path="url(#c)"><rect width="100" height="100"/></g>';
    const clip = clipOf(svg(defs, body), 'grp');
    expect(corners(clip)).toEqual([{ x1: 10, y1: 5, x2: 50, y2: 25 }]);
  });

  it('clips a rotated shape with an objectBoundingBox ellipse', () => {
    const defs =
      '<clipPath id="c" clipPathUnits="objectBoundingBox"><ellipse cx="0.5" cy="0.5" rx="0.5" ry="0.25"/></clipPath>';
    const body =
      '<rect id="r" x="20" y="10" width="40" height="20" transform="rotate(90)" clip-path="url(#c)"/>';
    const [contour] = clipOf(svg(defs, body), 'r');
    // The box is 40 by 20 at 20, 10, then the rotation turns x into y.
    const box = bbox(contour.v);
    expect(box.x1).toBeCloseTo(-25, 9);
    expect(box.x2).toBeCloseTo(-15, 9);
    expect(box.y1).toBeCloseTo(20, 9);
    expect(box.y2).toBeCloseTo(60, 9);
  });

  it('makes a union of the children and of disjoint subpaths, skipping hidden ones and lines', () => {
    const defs =
      '<clipPath id="c">' +
      '<rect x="0" y="0" width="10" height="10"/>' +
      '<path d="M20 0H30V10H20ZM40 0H50V10H40Z"/>' +
      '<rect x="60" width="10" height="10" display="none"/>' +
      '<rect x="80" width="10" height="10" visibility="hidden"/>' +
      '<line x1="0" y1="50" x2="100" y2="50"/>' +
      '</clipPath>' +
      '<g visibility="hidden"><clipPath id="h"><rect width="5" height="5"/></clipPath></g>';
    const body = '<rect id="r" width="100" height="100" clip-path="url(#c)"/>';
    expect(corners(clipOf(svg(defs, body), 'r'))).toEqual([
      { x1: 0, y1: 0, x2: 10, y2: 10 },
      { x1: 20, y1: 0, x2: 30, y2: 10 },
      { x1: 40, y1: 0, x2: 50, y2: 10 },
    ]);
    // A clip whose only child is hidden through its ancestors clips everything away.
    const hidden = svg(defs, '<rect id="r" width="100" height="100" clip-path="url(#h)"/>');
    expect(importSvg(hidden, 't.svg').children).toEqual([]);
  });

  it('draws nothing for a clip with no contours', () => {
    const text = svg(
      '<clipPath id="c"/>',
      '<g id="grp" clip-path="url(#c)"><rect width="10" height="10"/></g>'
    );
    expect(importSvg(text, 't.svg').children).toEqual([]);
  });

  it('clips the root svg', () => {
    const text = svg(
      '<clipPath id="c"><rect width="50" height="50"/></clipPath>',
      '<rect id="r" width="100" height="100"/>',
      'id="art" viewBox="10 10 200 100" clip-path="url(#c)"'
    );
    // The viewBox origin is moved to 0,0, and the clip moves with it.
    expect(corners(importSvg(text, 't.svg').clip ?? [])).toEqual([
      { x1: -10, y1: -10, x2: 40, y2: 40 },
    ]);
  });

  it('reads the box of a group for objectBoundingBox, unpainted shapes included', () => {
    const defs =
      '<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="0.5" height="1"/></clipPath>';
    const body =
      '<g id="grp" clip-path="url(#c)"><rect x="10" y="10" width="20" height="20"/><rect x="50" y="10" width="50" height="40" fill="none"/></g>';
    expect(corners(clipOf(svg(defs, body), 'grp'))).toEqual([{ x1: 10, y1: 10, x2: 55, y2: 50 }]);
  });

  it('applies the clipPath transform outside the objectBoundingBox mapping, as browsers do', () => {
    // Chromium, Firefox, WebKit and resvg read the numbers of the transform in user units.
    const moved =
      '<clipPath id="c" clipPathUnits="objectBoundingBox" transform="translate(40 0)"><rect width="0.5" height="1"/></clipPath>';
    const body = '<rect id="r" x="20" y="20" width="160" height="160" clip-path="url(#c)"/>';
    expect(corners(clipOf(svg(moved, body), 'r'))).toEqual([{ x1: 60, y1: 20, x2: 140, y2: 180 }]);
    const squeezed =
      '<clipPath id="c" clipPathUnits="objectBoundingBox" transform="scale(0.5 1)"><rect width="1" height="1"/></clipPath>';
    const wide = '<rect id="r" x="100" width="200" height="100" clip-path="url(#c)"/>';
    expect(corners(clipOf(svg(squeezed, wide), 'r'))).toEqual([
      { x1: 50, y1: 0, x2: 150, y2: 100 },
    ]);
    // A turn about the origin of user space, not of the box.
    const turned =
      '<clipPath id="c" clipPathUnits="objectBoundingBox" transform="rotate(90)"><rect width="1" height="0.5"/></clipPath>';
    const [contour] = clipOf(
      svg(turned, '<rect id="r" x="10" y="20" width="40" height="20" clip-path="url(#c)"/>'),
      'r'
    );
    const box = bbox(contour.v);
    expect(box.x1).toBeCloseTo(-30, 9);
    expect(box.x2).toBeCloseTo(-20, 9);
    expect(box.y1).toBeCloseTo(10, 9);
    expect(box.y2).toBeCloseTo(50, 9);
  });

  it('reads a <use> of a basic shape inside a clipPath, as Illustrator Save As writes it', () => {
    const root = 'xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 200 100"';
    const defs =
      '<rect id="SVGID_1_" x="10" y="10" width="20" height="20"/>' +
      '<clipPath id="SVGID_2_"><use xlink:href="#SVGID_1_" style="overflow:visible;"/></clipPath>';
    const body =
      '<g id="grp" style="clip-path:url(#SVGID_2_);"><rect width="100" height="100"/></g>';
    const text = svg(defs, body, root);
    expect(corners(clipOf(text, 'grp'))).toEqual([{ x1: 10, y1: 10, x2: 30, y2: 30 }]);
    // The rect in defs is not drawn.
    expect(importSvg(text, 't.svg').children.map((c) => c.name)).toEqual(['grp']);
    // x and y move it, after the use's transform, and the shape's own transform goes inside.
    const placed =
      '<path id="s" d="M0 0H10V10H0Z" transform="scale(2)"/>' +
      '<clipPath id="c"><use href="#s" x="5" y="1" transform="translate(100 0)"/></clipPath>';
    expect(
      corners(
        clipOf(svg(placed, '<rect id="r" width="200" height="100" clip-path="url(#c)"/>'), 'r')
      )
    ).toEqual([{ x1: 105, y1: 1, x2: 125, y2: 21 }]);
    // The shape takes clip-rule and visibility from the use when it has none of its own.
    const hidden =
      '<rect id="s" width="10" height="10"/>' +
      '<clipPath id="c"><use href="#s" visibility="hidden"/><rect x="50" width="10" height="10"/></clipPath>';
    expect(
      corners(
        clipOf(svg(hidden, '<rect id="r" width="100" height="100" clip-path="url(#c)"/>'), 'r')
      )
    ).toEqual([{ x1: 50, y1: 0, x2: 60, y2: 10 }]);
    const evenodd =
      '<rect id="s" width="10" height="10"/>' +
      '<clipPath id="c"><use id="u" href="#s" clip-rule="evenodd"/></clipPath>';
    expect(() =>
      importSvg(svg(evenodd, '<rect id="r" width="10" height="10" clip-path="url(#c)"/>'), 't.svg')
    ).toThrow(/evenodd rule/);
  });

  it('refuses a <use> in a clipPath that does not point at a basic shape, and says what to do', () => {
    const body = '<rect id="r" width="10" height="10" clip-path="url(#c)"/>';
    const group = svg(
      '<g id="s"><rect width="5" height="5"/></g><clipPath id="c"><use id="u" href="#s"/></clipPath>',
      body
    );
    expect(() => importSvg(group, 't.svg')).toThrow(
      /<use id="u"> points at a <g> inside a clipPath, which cannot be drawn\. Put the shape itself in the clipPath/
    );
    const missing = svg('<clipPath id="c"><use id="u" href="#x"/></clipPath>', body);
    expect(() => importSvg(missing, 't.svg')).toThrow(
      /<use id="u"> has href="#x", which points at nothing/
    );
    const nothing = svg('<clipPath id="c"><use id="u"/></clipPath>', body);
    expect(() => importSvg(nothing, 't.svg')).toThrow(/<use id="u"> points at nothing/);
    const clipped = svg(
      '<clipPath id="d"><rect width="1" height="1"/></clipPath><rect id="s" width="5" height="5" clip-path="url(#d)"/><clipPath id="c"><use href="#s"/></clipPath>',
      body
    );
    expect(() => importSvg(clipped, 't.svg')).toThrow(/<rect id="s"> clips a clip/);
  });

  it('refuses clip units it cannot read, a flat box, and a clip-path at something else', () => {
    const body = '<rect id="r" width="10" height="10" clip-path="url(#c)"/>';
    expect(() =>
      importSvg(svg('<clipPath id="c" clipPathUnits="strokeBox"/>', body), 't.svg')
    ).toThrow(/clipPathUnits="strokeBox", which cannot be read/);
    const flat = svg(
      '<clipPath id="c" clipPathUnits="objectBoundingBox"><rect width="1" height="1"/></clipPath>',
      '<line id="r" x2="10" stroke="#000" clip-path="url(#c)"/>'
    );
    expect(() => importSvg(flat, 't.svg')).toThrow(
      /<line id="r"> has a clip path that uses objectBoundingBox/
    );
    const other = svg('<linearGradient id="c"/>', body);
    expect(() => importSvg(other, 't.svg')).toThrow(/points at a <linearGradient>, not a clipPath/);
    const text = svg('<clipPath id="c"><text id="t">hi</text></clipPath>', body);
    expect(() => importSvg(text, 't.svg')).toThrow(UnsupportedSvgError);
    const image = svg(
      '<clipPath id="c"><polyline id="u" points="0 0"/><switch id="w"/></clipPath>',
      body
    );
    expect(() => importSvg(image, 't.svg')).toThrow(
      /<switch id="w"> cannot be drawn in a clip\. Only path, rect, circle, ellipse, line, polygon, polyline and a <use> of one are read/
    );
    const shared = svg('<clipPath id="c"/><clipPath id="c"/>', body);
    expect(() => importSvg(shared, 't.svg')).toThrow(/points at id "c", which two elements share/);
  });

  it('lets a child say nonzero over an evenodd ancestor', () => {
    const defs =
      '<clipPath id="c" clip-rule="evenodd"><rect width="5" height="5" clip-rule="nonzero"/></clipPath>';
    expect(
      clipOf(svg(defs, '<rect id="r" width="10" height="10" clip-path="url(#c)"/>'), 'r')
    ).toHaveLength(1);
  });

  it('hands the clip to the scene node', () => {
    const model = compileScene(
      scene('s', (ctx) => ctx.add(ctx.art('clip-rect', { at: [10, 20], scale: 2 }))),
      {
        size: [320, 180],
        lines: [],
        duration: 1,
        loaders: { svg: read, font: () => new ArrayBuffer(0) },
      }
    );
    const clipped = model.nodes[0].children[0];
    expect(corners(clipped.clip ?? [])).toEqual([{ x1: 10, y1: 20, x2: 20, y2: 30 }]);
    expect(model.nodes[0]).not.toHaveProperty('clip');
  });
});

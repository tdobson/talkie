import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compileScene,
  emitLottie,
  importSvg,
  scene,
  UnsupportedSvgError,
  type ArtNode,
  type Loaders,
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
    ['unsupported-filter', 'filter', 'blur'],
    ['unsupported-mask', 'mask', 'hole'],
    ['unsupported-clip-path', 'rect', 'clipped'],
    ['unsupported-pattern', 'pattern', 'dots'],
    ['unsupported-image', 'image', 'photo'],
    ['unsupported-text', 'text', 'words'],
    ['unsupported-linear-gradient', 'linearGradient', 'sky'],
    ['unsupported-radial-gradient', 'radialGradient', 'glow'],
  ])('%s', (name, element, id) => {
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
  });

  it('allows a clipPath that nothing uses', () => {
    expect(load('unused-clip-path').children.map((c) => c.name)).toEqual(['plain']);
  });

  it('refuses elements it does not know, and says when there is no id', () => {
    const svg = '<svg><use href="#a"/></svg>';
    expect(() => importSvg(svg, 'use.svg')).toThrow(UnsupportedSvgError);
    expect(() => importSvg(svg, 'use.svg')).toThrow(/use\.svg: <use> \(no id\)/);
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  compileScene,
  emitLottie,
  FactConflictError,
  LABEL_COLOUR,
  LABEL_SIZE,
  labelPaths,
  labelWidth,
  parseFont,
  scene,
  type BezierPath,
  type Loaders,
} from '../src/index';

const file = readFileSync(join(__dirname, 'fixtures', 'WorkSans.ttf'));
const buffer = (): ArrayBuffer =>
  file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
const font = parseFont(buffer());

/** Bounds of the curves, taking the control points as the outer limit. */
const bbox = (paths: BezierPath[]) => {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of paths) {
    p.v.forEach(([x, y], n) => {
      xs.push(x, x + p.i[n][0], x + p.o[n][0]);
      ys.push(y, y + p.i[n][1], y + p.o[n][1]);
    });
  }
  return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) };
};

describe('labelPaths', () => {
  it('outlines "345 mm" as closed paths that span the advance width', () => {
    const paths = labelPaths(font, '345 mm', { at: [100, 200], size: 34 });
    const advance = font.getAdvanceWidth('345 mm', 34);
    expect(labelWidth(font, '345 mm', 34)).toBe(advance);
    // 3, 4 and its counter, 5, m, m.
    expect(paths).toHaveLength(6);
    expect(paths.every((p) => p.closed)).toBe(true);
    expect(paths.every((p) => p.v.length === p.i.length && p.v.length === p.o.length)).toBe(true);
    const box = bbox(paths);
    // The ink plus the side bearings of the first and last glyph is the advance width.
    const em = 34 / font.unitsPerEm;
    const left = font.charToGlyph('3').getMetrics().leftSideBearing * em;
    const right = (font.charToGlyph('m').getMetrics().rightSideBearing ?? 0) * em;
    expect(Math.abs(box.x1 - (100 + left))).toBeLessThan(1);
    expect(Math.abs(box.x2 - box.x1 + left + right - advance)).toBeLessThan(1);
    // The baseline is at y, and the digits stand on it.
    expect(box.y2).toBeGreaterThan(199);
    expect(box.y2).toBeLessThan(201);
    expect(box.y1).toBeLessThan(180);
  });

  it('anchors at the start, middle or end', () => {
    const advance = font.getAdvanceWidth('345 mm', 34);
    const at = (anchor: 'start' | 'middle' | 'end') =>
      bbox(labelPaths(font, '345 mm', { at: [100, 200], size: 34, anchor }));
    expect(at('start').x1 - at('middle').x1).toBeCloseTo(advance / 2, 6);
    expect(at('start').x1 - at('end').x1).toBeCloseTo(advance, 6);
    expect(at('end').x2).toBeLessThanOrEqual(100 + 1);
    expect(at('start')).toEqual(bbox(labelPaths(font, '345 mm', { at: [100, 200], size: 34 })));
  });

  it('turns quadratic curves into cubics, without repeating the first point', () => {
    const [o] = labelPaths(font, 'o', { at: [0, 0], size: 100 });
    expect(o.v.length).toBeGreaterThan(4);
    expect(o.i.some(([x, y]) => x !== 0 || y !== 0)).toBe(true);
    const last = o.v[o.v.length - 1];
    expect(Math.hypot(last[0] - o.v[0][0], last[1] - o.v[0][1])).toBeGreaterThan(1e-6);
  });

  it('refuses text the font cannot draw', () => {
    expect(() => labelPaths(font, 'a中b', { at: [0, 0] })).toThrow(/no glyph for "中"/);
    expect(() => labelPaths(font, '   ', { at: [0, 0] })).toThrow(/nothing to draw/);
  });

  it('gives the same output every time', () => {
    const once = JSON.stringify(labelPaths(font, '345 mm', { at: [1, 2] }));
    expect(JSON.stringify(labelPaths(parseFont(buffer()), '345 mm', { at: [1, 2] }))).toBe(once);
  });
});

describe('ctx.label', () => {
  let fontLoads = 0;
  const loaders: Loaders = {
    svg: () => {
      throw new Error('no art in this test');
    },
    font: () => {
      fontLoads += 1;
      return buffer();
    },
  };
  const input = { size: [1920, 1080] as [number, number], lines: [], duration: 4, loaders };

  it('makes a filled node with the default size and colour, loading the font once', () => {
    fontLoads = 0;
    const model = compileScene(
      scene('s', (ctx) => {
        const a = ctx.label('345 mm', { at: [100, 200] });
        const b = ctx.label('Gauge', {
          at: [100, 300],
          size: 68,
          color: '#ff0000',
          anchor: 'middle',
        });
        ctx.add(a, b);
        ctx.pop(a, 1);
      }),
      input
    );
    expect(fontLoads).toBe(1);
    const [a, b] = model.nodes;
    expect(a.name).toBe('label 345 mm');
    expect(a.items).toHaveLength(1);
    expect(a.items[0].style).toEqual({ fill: LABEL_COLOUR });
    expect(LABEL_COLOUR).toBe('#1d3b47');
    expect(LABEL_SIZE).toBe(34);
    expect(a.items[0].paths).toEqual(labelPaths(font, '345 mm', { at: [100, 200], size: 34 }));
    expect(b.items[0].style).toEqual({ fill: '#ff0000' });
    expect(b.items[0].paths).toEqual(
      labelPaths(font, 'Gauge', { at: [100, 300], size: 68, anchor: 'middle' })
    );
    expect(() => emitLottie(model)).not.toThrow();
  });

  it('runs the fact gate before drawing', () => {
    const build = (text: string) =>
      compileScene(
        scene('s', (ctx) => ctx.add(ctx.label(text, { at: [0, 100] }))),
        { ...input, conflicts: ['345 mm'] }
      );
    expect(() => build('345mm')).toThrow(FactConflictError);
    expect(() => build('345 millimetres')).toThrow(/scene s: label "345 millimetres"/);
    expect(() => build('325 mm')).not.toThrow();
  });

  it('refuses a colour the emitters cannot use', () => {
    expect(() =>
      compileScene(
        scene('s', (ctx) => ctx.add(ctx.label('Gauge', { at: [0, 100], color: 'red' }))),
        input
      )
    ).toThrow(/#rrggbb/);
  });

  it('says so when the scene was compiled without loaders', () => {
    expect(() =>
      compileScene(
        scene('s', (ctx) => ctx.add(ctx.label('Gauge', { at: [0, 0] }))),
        { size: [1920, 1080], lines: [], duration: 4 }
      )
    ).toThrow(/scene s: label\("Gauge"\) needs loaders/);
  });
});

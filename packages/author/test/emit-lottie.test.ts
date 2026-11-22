import {
  compileScene,
  emitLottie,
  invert,
  matrixOf,
  multiply,
  parseColour,
  parsePathD,
  round3,
  scene,
  transformPaths,
  type LottieLayer,
  type LottieShape,
  type Matrix,
  type Vec,
} from '../src/index';
import { everything, gauge, golden, shaded } from './scenes';

type Group = Extract<LottieShape, { ty: 'gr' }>;
const only = <T extends LottieShape['ty']>(group: Group, ty: T) =>
  group.it.filter((shape): shape is Extract<LottieShape, { ty: T }> => shape.ty === ty);

describe('emitLottie on the gauge scene', () => {
  const json = emitLottie(gauge());
  const [camera, shape] = json.layers;
  const group = shape.shapes?.[0] as Group;

  it('writes the root', () => {
    expect(json).toMatchObject({ v: '5.12.0', fr: 60, ip: 0, op: 240, w: 1920, h: 1080, ddd: 0 });
    expect(json.nm).toBe('s07-batten-gauge');
    expect(json.assets).toEqual([]);
    expect(json.layers).toHaveLength(2);
  });

  it('has one camera null layer and one shape layer parented to it', () => {
    expect(camera).toMatchObject({ ty: 3, ind: 1, nm: 'camera', ip: 0, op: 240 });
    expect(camera).not.toHaveProperty('parent');
    expect(camera).not.toHaveProperty('shapes');
    expect(shape).toMatchObject({
      ty: 4,
      ind: 2,
      parent: 1,
      ip: 0,
      op: 240,
      st: 0,
      sr: 1,
      ao: 0,
      bm: 0,
    });
    expect(shape.ks.o).toEqual({ a: 0, k: 100 });
    expect(shape.shapes).toHaveLength(1);
    expect(group.ty).toBe('gr');
  });

  it('trims the line from frame 60 to frame 132', () => {
    const [tm] = only(group, 'tm');
    expect(tm.s).toEqual({ a: 0, k: 0 });
    expect(tm.o).toEqual({ a: 0, k: 0 });
    expect(tm.e).toEqual({
      a: 1,
      k: [
        { t: 60, s: [0], o: { x: [0.42], y: [0] }, i: { x: [0.58], y: [1] } },
        { t: 132, s: [100] },
      ],
    });
  });

  it('writes the path, the stroke and the group transform in order', () => {
    expect(group.it.map((shape) => shape.ty)).toEqual(['sh', 'tm', 'st', 'tr']);
    const [sh] = only(group, 'sh');
    expect(sh.ks.k).toEqual({
      c: false,
      v: [
        [400, 600],
        [1200, 600],
      ],
      i: [
        [0, 0],
        [0, 0],
      ],
      o: [
        [0, 0],
        [0, 0],
      ],
    });
    const [st] = only(group, 'st');
    const colour = (st.c as { k: number[] }).k;
    [0.059, 0.42, 0.451, 1].forEach((value, n) =>
      expect(Math.abs(colour[n] - value)).toBeLessThan(0.001)
    );
    expect(st).toMatchObject({ lc: 2, lj: 2, ml: 4, w: { a: 0, k: 6 }, o: { a: 0, k: 100 } });
    const [tr] = only(group, 'tr');
    expect(tr).toMatchObject({
      sk: { a: 0, k: 0 },
      sa: { a: 0, k: 0 },
      s: { a: 0, k: [100, 100] },
    });
  });

  it('matches the golden file', () => {
    expect(JSON.parse(JSON.stringify(json))).toEqual(golden('gauge', json));
  });
});

describe('emitLottie on a full scene', () => {
  const json = emitLottie(everything());

  it('matches the golden file', () => {
    expect(JSON.parse(JSON.stringify(json))).toEqual(golden('everything', json));
  });

  it('puts the last node added straight after the camera, so it draws on top', () => {
    expect(json.layers.map((layer) => [layer.ind, layer.nm])).toEqual([
      [1, 'camera'],
      [6, 'badge'],
      [5, 'path'],
      [4, 'line'],
      [3, 'timber'],
      [2, 'sky'],
    ]);
    expect(json.layers.slice(1).every((layer) => layer.parent === 1 && layer.ty === 4)).toBe(true);
  });

  it('animates the camera scale with a handle per dimension', () => {
    const { ks } = json.layers[0];
    expect(ks.a).toEqual({ a: 0, k: [960, 540] });
    expect(ks.s).toEqual({
      a: 1,
      k: [
        {
          t: 0,
          s: [100, 100],
          o: { x: [0.42, 0.42], y: [0, 0] },
          i: { x: [0.58, 0.58], y: [1, 1] },
        },
        { t: 360, s: [103.5, 103.5] },
      ],
    });
  });

  it('keeps a top-level transform on the layer and a child transform on its group', () => {
    const timber = json.layers[4];
    expect(timber.ks.p).toMatchObject({ a: 1 });
    const group = timber.shapes?.[0] as Group;
    expect(only(group, 'tr')[0].p).toEqual({ a: 0, k: [0, 0] });
    // Children in reverse draw order: the nail is drawn over the batten.
    const children = only(group, 'gr');
    expect(children.map((child) => child.nm)).toEqual(['nail', 'rect']);
    const nailTr = only(children[0], 'tr')[0];
    expect(nailTr.a).toEqual({ a: 0, k: [800, 580] });
    expect(nailTr.s).toMatchObject({ a: 1 });
    expect(only(children[1], 'st')).toHaveLength(1);
    expect(only(children[1], 'fl')).toHaveLength(1);
    expect(children[1].it.map((shape) => shape.ty)).toEqual(['sh', 'st', 'fl', 'tr']);
  });

  it('gives each item of a many-item node its own group, last item on top', () => {
    const group = json.layers[1].shapes?.[0] as Group;
    const items = only(group, 'gr');
    expect(items.map((item) => item.nm)).toEqual(['badge item 2', 'badge item 1']);
    expect(items[0].it.map((shape) => shape.ty)).toEqual(['sh', 'st', 'tr']);
    expect(items[1].it.map((shape) => shape.ty)).toEqual(['sh', 'fl', 'tr']);
  });

  it('leaves out paint that is "none" and expands short colours', () => {
    const tick = json.layers[2].shapes?.[0] as Group;
    expect(only(tick, 'fl')).toHaveLength(0);
    expect(only(tick, 'st')[0].c).toEqual({ a: 0, k: [0, 0, 0, 1] });
    expect(only(tick, 'st')[0]).toMatchObject({ lc: 1, lj: 1, w: { a: 0, k: 1 } });
    const sky = json.layers[5].shapes?.[0] as Group;
    expect(only(sky, 'fl')[0]).toMatchObject({ c: { a: 0, k: [0.933, 0.933, 1, 1] }, r: 1 });
  });

  it('rounds every number to 3 decimals', () => {
    const numbers: number[] = [];
    JSON.stringify(json, (_key, value) => {
      if (typeof value === 'number') {
        numbers.push(value);
      }
      return value;
    });
    expect(numbers.length).toBeGreaterThan(100);
    expect(
      numbers.filter((value) => Math.abs(value * 1000 - Math.round(value * 1000)) > 1e-6)
    ).toEqual([]);
  });
});

describe('emitLottie on a fading node with more than one paint', () => {
  const BOTH = { fill: '#ff0000', stroke: '#0000ff', strokeWidth: 16 };
  const emit = (build: Parameters<typeof scene>[1]) =>
    emitLottie(compileScene(scene('fade', build), { size: [320, 180], lines: [], duration: 4 }));
  const row = (layer: LottieLayer) => [layer.ind, layer.ty, layer.nm, layer.parent];

  it('gives a fading child with a fill and a stroke a layer of its own, with the fade on the layer', () => {
    const json = emit((c) => {
      const back = c.rect(0, 0, 10, 10, { fill: '#000000' }, 'back');
      const plate = c.rect(20, 20, 60, 60, BOTH, 'plate');
      const front = c.rect(5, 5, 10, 10, { fill: '#000000' }, 'front');
      const holder = c.node(
        'holder',
        [{ paths: c.rect(0, 0, 4, 4, {}).items[0].paths, style: { fill: '#00aa00' } }],
        [back, plate, front]
      );
      holder.transform.position = [7, 9];
      c.add(c.rect(0, 0, 320, 180, { fill: '#ffffff' }, 'sky'), holder);
      c.fade(plate, 1);
    });
    // Lottie draws the first layer on top: the holder's own shapes, then its children from the
    // front one to the back one. The holder itself is a null layer that carries its transform.
    expect(json.layers.map(row)).toEqual([
      [1, 3, 'camera', undefined],
      [7, 4, 'holder shapes', 3],
      [6, 4, 'front', 3],
      [5, 4, 'plate', 3],
      [4, 4, 'back', 3],
      [3, 3, 'holder', 1],
      [2, 4, 'sky', 1],
    ]);
    const [, own, , plate, , holder] = json.layers;
    expect(holder.ks.p).toEqual({ a: 0, k: [7, 9] });
    expect(holder).not.toHaveProperty('shapes');
    // The fade is on the layer, which fades the finished picture of the node.
    expect(plate.ks.o).toMatchObject({ a: 1 });
    const group = plate.shapes?.[0] as Group;
    expect(group.it.map((shape) => shape.ty)).toEqual(['sh', 'st', 'fl', 'tr']);
    expect(only(group, 'tr')[0].o).toEqual({ a: 0, k: 100 });
    expect(only(group, 'st')[0].o).toEqual({ a: 0, k: 100 });
    expect(only(group, 'fl')[0].o).toEqual({ a: 0, k: 100 });
    // The holder's own shapes stay where they were, with no children under them.
    const ownGroup = own.shapes?.[0] as Group;
    expect(ownGroup.it.map((shape) => shape.ty)).toEqual(['sh', 'fl', 'tr']);
    expect(own.ks).toMatchObject({ p: { a: 0, k: [0, 0] }, o: { a: 0, k: 100 } });
  });

  it('does the same for a fading child whose own children overlap, however deep it is', () => {
    const json = emit((c) => {
      const pair = c.group('pair', [
        c.rect(0, 0, 40, 40, { fill: '#ff0000' }, 'under'),
        c.rect(20, 20, 40, 40, { fill: '#00aa00' }, 'over'),
      ]);
      const outer = c.group('outer', [c.group('inner', [pair])]);
      c.add(outer);
      c.fade(pair, 1, { from: 100, to: 0 });
      c.tween(outer, 'position', [
        { t: 0, v: [0, 0] },
        { t: 2, v: [50, 0] },
      ]);
    });
    expect(json.layers.map(row)).toEqual([
      [1, 3, 'camera', undefined],
      [4, 4, 'pair', 3],
      [3, 3, 'inner', 2],
      [2, 3, 'outer', 1],
    ]);
    expect(json.layers[3].ks.p).toMatchObject({ a: 1 });
    expect(json.layers[1].ks.o).toMatchObject({ a: 1 });
    const pair = json.layers[1].shapes?.[0] as Group;
    expect(only(pair, 'gr').map((child) => child.nm)).toEqual(['over', 'under']);
  });

  it('counts a still opacity below 100 as a fade', () => {
    const json = emit((c) => {
      const plate = c.rect(20, 20, 60, 60, BOTH, 'plate');
      plate.transform.opacity = 40;
      c.add(c.group('holder', [plate]));
    });
    expect(json.layers.map(row)).toEqual([
      [1, 3, 'camera', undefined],
      [3, 4, 'plate', 2],
      [2, 3, 'holder', 1],
    ]);
    expect(json.layers[1].ks.o).toEqual({ a: 0, k: 40 });
  });

  it('leaves a child in its group when it has one paint or does not fade', () => {
    const json = emit((c) => {
      const one = c.rect(0, 0, 10, 10, { fill: '#000000' }, 'one');
      const steady = c.rect(20, 20, 60, 60, BOTH, 'steady');
      c.add(c.group('holder', [one, steady]));
      c.fade(one, 1);
      c.tween(steady, 'rotation', [
        { t: 0, v: 0 },
        { t: 1, v: 90 },
      ]);
    });
    expect(json.layers.map(row)).toEqual([
      [1, 3, 'camera', undefined],
      [2, 4, 'holder', 1],
    ]);
  });

  it('leaves a child in its group when a node above it fades too', () => {
    // Two fades, one inside the other, cannot be told apart by layers, which pass on a
    // transform but not an opacity. The child keeps its fade on its group, as before.
    const json = emit((c) => {
      const plate = c.rect(20, 20, 60, 60, BOTH, 'plate');
      const holder = c.group('holder', [plate]);
      c.add(c.group('outer', [holder]));
      c.fade(plate, 1);
      c.fade(holder, 2, { from: 100, to: 0 });
    });
    expect(json.layers.map(row)).toEqual([
      [1, 3, 'camera', undefined],
      [3, 4, 'holder', 2],
      [2, 3, 'outer', 1],
    ]);
    const holder = json.layers[1].shapes?.[0] as Group;
    expect(only(only(holder, 'gr')[0], 'tr')[0].o).toMatchObject({ a: 1 });
  });
});

describe('emitLottie refusals', () => {
  it('refuses a colour it cannot represent, naming the node', () => {
    const def = scene('bad', (ctx) => ctx.add(ctx.rect(0, 0, 1, 1, { fill: 'teal' }, 'plate')));
    const model = compileScene(def, { size: [100, 100], lines: [], duration: 1 });
    expect(() => emitLottie(model)).toThrow('node "plate" (n1): cannot use colour "teal"');
    expect(parseColour('none', 'x')).toBeNull();
    expect(parseColour(undefined, 'x')).toBeNull();
  });

  it('refuses two keys that land on the same frame', () => {
    const def = scene('close', (ctx) => {
      const n = ctx.rect(0, 0, 1, 1, { fill: '#000' });
      ctx.add(n);
      ctx.fade(n, 0.5, { dur: 0.004 });
    });
    const model = compileScene(def, { size: [100, 100], lines: [], duration: 1 });
    expect(() => emitLottie(model)).toThrow('two opacity keys land on frame 30');
  });
});

describe('emitLottie gradients', () => {
  const STOPS = [
    { offset: 0, colour: '#ffffff', opacity: 1 },
    { offset: 1, colour: '#0000ff', opacity: 1 },
  ];
  const lin = {
    type: 'linear' as const,
    from: [10, 20] as Vec,
    to: [110, 20] as Vec,
    stops: STOPS,
  };
  const emit = (build: Parameters<typeof scene>[1]) =>
    emitLottie(compileScene(scene('g', build), { size: [320, 180], lines: [], duration: 2 }));
  const shapesOf = (json: ReturnType<typeof emitLottie>) =>
    (json.layers[1].shapes?.[0] as Group).it;

  it('writes a linear fill as gf, with p before k and no alpha stops when all are opaque', () => {
    const shapes = shapesOf(emit((c) => c.add(c.rect(0, 0, 120, 40, { fill: lin }, 'plate'))));
    expect(shapes.map((shape) => shape.ty)).toEqual(['sh', 'gf', 'tr']);
    const gf = shapes[1];
    expect(gf).toEqual({
      ty: 'gf',
      nm: 'fill',
      o: { a: 0, k: 100 },
      r: 1,
      t: 1,
      s: { a: 0, k: [10, 20] },
      e: { a: 0, k: [110, 20] },
      g: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 1] } },
    });
    expect(Object.keys((gf as { g: object }).g)).toEqual(['p', 'k']);
  });

  it('adds alpha stops at the same offsets when any stop is see-through', () => {
    const stops = [
      { offset: 0, colour: '#000000', opacity: 0.6 },
      { offset: 0.5, colour: '#000000', opacity: 0.6 },
      { offset: 0.5, colour: '#ff0000', opacity: 1 },
      { offset: 1, colour: '#ff0000', opacity: 0 },
    ];
    const shapes = shapesOf(emit((c) => c.add(c.rect(0, 0, 120, 40, { fill: { ...lin, stops } }))));
    expect((shapes[1] as { g: unknown }).g).toEqual({
      p: 4,
      k: {
        a: 0,
        k: [0, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 1, 0, 0, 1, 1, 0, 0, 0, 0.6, 0.5, 0.6, 0.5, 1, 1, 0],
      },
    });
  });

  it('writes a radial fill with e one radius to the right, and the focal point as h and a', () => {
    const radial = {
      type: 'radial' as const,
      centre: [50, 50] as Vec,
      radius: 20,
      focal: [50, 60] as Vec,
      stops: STOPS,
    };
    const shapes = shapesOf(emit((c) => c.add(c.circle([50, 50], 20, { fill: radial }))));
    expect(shapes[1]).toEqual({
      ty: 'gf',
      nm: 'fill',
      o: { a: 0, k: 100 },
      r: 1,
      t: 2,
      s: { a: 0, k: [50, 50] },
      e: { a: 0, k: [70, 50] },
      g: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 1] } },
      h: { a: 0, k: 50 },
      a: { a: 0, k: 90 },
    });
    const centred = shapesOf(
      emit((c) => c.add(c.circle([50, 50], 20, { fill: { ...radial, focal: [50, 50] } })))
    );
    expect(centred[1]).not.toHaveProperty('h');
    expect(centred[1]).not.toHaveProperty('a');
  });

  it('writes a gradient stroke as gs, over the fill', () => {
    const shapes = shapesOf(
      emit((c) =>
        c.add(
          c.rect(0, 0, 120, 40, { fill: '#000000', stroke: lin, strokeWidth: 4, lineCap: 'round' })
        )
      )
    );
    expect(shapes.map((shape) => shape.ty)).toEqual(['sh', 'gs', 'fl', 'tr']);
    expect(shapes[1]).toEqual({
      ty: 'gs',
      nm: 'stroke',
      o: { a: 0, k: 100 },
      w: { a: 0, k: 4 },
      lc: 2,
      lj: 1,
      ml: 4,
      t: 1,
      s: { a: 0, k: [10, 20] },
      e: { a: 0, k: [110, 20] },
      g: { p: 2, k: { a: 0, k: [0, 1, 1, 1, 1, 0, 0, 1] } },
    });
  });

  describe('a stretched radial gradient', () => {
    // A circle of radius 0.5 in the unit box, stretched onto an 80 by 20 box at 10, 40 and turned.
    const turn = (30 * Math.PI) / 180;
    const box: Matrix = [80, 0, 0, 20, 10, 40];
    const rotate: Matrix = [Math.cos(turn), Math.sin(turn), -Math.sin(turn), Math.cos(turn), 0, 0];
    const matrix = multiply(rotate, box);
    const stretched = {
      type: 'radial' as const,
      centre: [0.5, 0.5] as Vec,
      radius: 0.5,
      focal: [0.6, 0.5] as Vec,
      stops: STOPS,
      matrix,
    };
    const outline = 'M10 40H90V60H10Z';
    const json = emit((c) => {
      const n = c.path(outline, { fill: stretched, stroke: '#123456', strokeWidth: 2 }, 'dish');
      n.items[0].paths = transformPaths(n.items[0].paths, rotate);
      c.add(n);
    });
    const shapes = shapesOf(json);
    const [strokeGroup, fillGroup] = shapes as Group[];

    it('puts the stroke in a sibling group in front of the fill group', () => {
      expect(shapes.map((shape) => shape.ty)).toEqual(['gr', 'gr', 'tr']);
      expect(strokeGroup.it.map((shape) => shape.ty)).toEqual(['sh', 'st', 'tr']);
      expect(only(strokeGroup, 'tr')[0].s).toEqual({ a: 0, k: [100, 100] });
    });

    it('keeps the gf and the stretching tr in one group with no stroke', () => {
      expect(fillGroup.nm).toBe('fill');
      expect(fillGroup.it.map((shape) => shape.ty)).toEqual(['sh', 'gf', 'tr']);
      const [tr] = only(fillGroup, 'tr');
      const s = (tr.s as { k: number[] }).k;
      expect(s[0]).toBe(100);
      expect(s[1]).toBeCloseTo(25, 4);
      expect((tr.r as { k: number }).k).toBeCloseTo(30, 4);
      expect((tr.p as { k: number[] }).k).toEqual([round3(matrix[4]), round3(matrix[5])]);
      const [gf] = only(fillGroup, 'gf');
      const sk = (gf.s as { k: number[] }).k;
      const ek = (gf.e as { k: number[] }).k;
      expect(ek[0] - sk[0]).toBeCloseTo(40, 2);
      expect(ek[1]).toBe(sk[1]);
      expect(gf).toMatchObject({ t: 2, h: { a: 0, k: 20 }, a: { a: 0, k: 0 } });
    });

    it('draws the path where it was, once the group tr is applied', () => {
      const [tr] = only(fillGroup, 'tr');
      const m = matrixOf({
        position: (tr.p as unknown as { k: Vec }).k,
        anchor: [0, 0],
        scale: (tr.s as unknown as { k: Vec }).k,
        rotation: (tr.r as { k: number }).k,
        opacity: 100,
      });
      const [sh] = only(fillGroup, 'sh');
      const want = transformPaths(parsePathD(outline), rotate)[0].v;
      sh.ks.k.v.forEach(([x, y], n) => {
        expect(Math.abs(m[0] * x + m[2] * y + m[4] - want[n][0])).toBeLessThan(2e-3);
        expect(Math.abs(m[1] * x + m[3] * y + m[5] - want[n][1])).toBeLessThan(2e-3);
      });
    });

    it('gives every point the same place in the gradient as SVG does', () => {
      const [tr] = only(fillGroup, 'tr');
      const [gf] = only(fillGroup, 'gf');
      const m = matrixOf({
        position: (tr.p as unknown as { k: Vec }).k,
        anchor: [0, 0],
        scale: (tr.s as unknown as { k: Vec }).k,
        rotation: (tr.r as { k: number }).k,
        opacity: 100,
      });
      const inv = invert(m) as Matrix;
      const toGradient = invert(matrix) as Matrix;
      const centre = (gf.s as { k: number[] }).k;
      const radius = (gf.e as { k: number[] }).k[0] - centre[0];
      for (const [x, y] of [
        [30, 60],
        [55, 70],
        [20, 45],
      ] as Vec[]) {
        // SVG: back into the unit box, then the distance from the centre over the radius.
        const g: Vec = [
          toGradient[0] * x + toGradient[2] * y + toGradient[4],
          toGradient[1] * x + toGradient[3] * y + toGradient[5],
        ];
        const want = Math.hypot(g[0] - 0.5, g[1] - 0.5) / 0.5;
        // The film: into the group's frame, then the same in a plain circle.
        const f: Vec = [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]];
        const got = Math.hypot(f[0] - centre[0], f[1] - centre[1]) / radius;
        expect(Math.abs(got - want)).toBeLessThan(1e-4);
      }
    });

    it('refuses a trim, even one set on the node by hand', () => {
      const model = compileScene(
        scene('g', (c) => {
          const n = c.path(outline, { fill: stretched }, 'dish');
          n.trimmed = true;
          c.add(n);
        }),
        { size: [320, 180], lines: [], duration: 2 }
      );
      expect(() => emitLottie(model)).toThrow(
        'draw cannot trim "dish" (n1): its radial gradient is stretched, and a trim would not follow the drawing'
      );
    });

    it('refuses a stretched radial stroke', () => {
      const model = compileScene(
        scene('g', (c) => c.add(c.path(outline, { stroke: stretched, strokeWidth: 2 }, 'dish'))),
        { size: [320, 180], lines: [], duration: 2 }
      );
      expect(() => emitLottie(model)).toThrow(
        '"dish" (n1) has a radial gradient stroke that is stretched'
      );
    });
  });

  it('checks every gradient it draws', () => {
    const model = compileScene(
      scene('g', (c) =>
        c.add(c.rect(0, 0, 10, 10, { fill: { ...lin, stops: [STOPS[0]] } }, 'plate'))
      ),
      { size: [320, 180], lines: [], duration: 2 }
    );
    expect(() => emitLottie(model)).toThrow(
      'node "plate" (n1): its gradient needs at least 2 stops'
    );
  });

  it('counts a gradient as one paint when deciding a fade needs its own layer', () => {
    const json = emit((c) => {
      const plate = c.rect(0, 0, 10, 10, { fill: lin, stroke: lin, strokeWidth: 2 }, 'plate');
      c.add(c.group('holder', [plate]));
      c.fade(plate, 0.5);
    });
    expect(json.layers.map((layer) => [layer.ty, layer.nm])).toEqual([
      [3, 'camera'],
      [4, 'plate'],
      [3, 'holder'],
    ]);
  });
});

describe('emitLottie on the shaded scene', () => {
  it('matches the golden file, byte for byte', () => {
    const json = emitLottie(shaded());
    expect(JSON.parse(JSON.stringify(json))).toEqual(golden('shaded', json));
  });
});

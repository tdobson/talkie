import { compileScene, emitLottie, parseColour, scene, type LottieShape } from '../src/index';
import { everything, gauge, golden } from './scenes';

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

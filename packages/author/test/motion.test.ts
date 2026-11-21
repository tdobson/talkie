import {
  activeAt,
  bboxAt,
  compileScene,
  easeAt,
  MotionConflictError,
  scene,
  TimingError,
  trackOf,
  transformAt,
  trimAt,
  valueAt,
  type Node,
  type SceneContext,
  type SceneModel,
  type Track,
} from '../src/index';

const LINES = [{ id: 'l1', text: 'Set the gauge.', start: 1.4, voiceEnd: 2.6, captionEnd: 4.4 }];
const build = (fn: (ctx: SceneContext) => void, duration = 10): SceneModel =>
  compileScene(scene('test', fn), { size: [1920, 1080], lines: LINES, duration });
const keys = (n: Node, prop: Parameters<typeof trackOf>[1]) => trackOf(n, prop)?.keys;
const box = (ctx: SceneContext) => ctx.rect(100, 200, 40, 20, { fill: '#000000' });

describe('scene context', () => {
  it('T gives the line start plus an offset, and throws on an unknown id', () => {
    build(({ T }) => {
      expect(T('l1')).toBe(1.4);
      expect(T('l1', 0.5)).toBe(1.9);
      expect(() => T('nope')).toThrow(TimingError);
      expect(() => T('nope')).toThrow('no voice line with id "nope"');
    });
  });

  it('numbers nodes n1, n2 in creation order and keeps top-level draw order', () => {
    const model = build((ctx) => {
      const a = ctx.rect(0, 0, 1, 1, {}, 'a');
      const b = ctx.circle([0, 0], 5, {}, 'b');
      const c = ctx.group('c', [b]);
      ctx.add(c, a);
    });
    expect(model.nodes.map((n) => [n.id, n.name])).toEqual([
      ['n3', 'c'],
      ['n1', 'a'],
    ]);
    expect(model.nodes[0].children[0].id).toBe('n2');
    expect(model.camera.id).toBe('camera');
    expect(model.fps).toBe(60);
  });

  it('builds shapes: a line is open, a rect and a circle are closed with four vertices', () => {
    build((ctx) => {
      const line = ctx.line([0, 0], [10, 0], {});
      expect(line.items[0].paths[0]).toEqual({
        closed: false,
        v: [
          [0, 0],
          [10, 0],
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
      expect(box(ctx).items[0].paths[0].v).toEqual([
        [100, 200],
        [140, 200],
        [140, 220],
        [100, 220],
      ]);
      const circle = ctx.circle([50, 50], 10, {});
      expect(circle.items[0].paths[0].closed).toBe(true);
      expect(bboxAt(circle, 0)).toEqual({ x: 40, y: 40, width: 20, height: 20 });
      expect(ctx.path('M0 0H10V10H0Z', {}).items[0].paths[0].v).toHaveLength(4);
    });
  });

  it('refuses a node that is animated but never added, and a node placed twice', () => {
    expect(() => build((ctx) => ctx.fade(box(ctx), 1))).toThrow('never added to the scene');
    expect(() =>
      build((ctx) => {
        const n = box(ctx);
        ctx.add(n, ctx.group('g', [n]));
      })
    ).toThrow('in the scene twice');
  });
});

describe('motion defaults', () => {
  it('fade: 0.4 s, 0 to 100, inOut, hidden before it starts', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      ctx.fade(n, 2);
      expect(keys(n, 'opacity')).toEqual([
        { t: 2, v: 0, ease: 'inOut' },
        { t: 2.4, v: 100, ease: 'inOut' },
      ]);
      expect(n.transform.opacity).toBe(0);
    });
  });

  it('fade out leaves the static opacity alone', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      ctx.fade(n, 2, { from: 100, to: 0, dur: 1, ease: 'in' });
      expect(keys(n, 'opacity')).toEqual([
        { t: 2, v: 100, ease: 'in' },
        { t: 3, v: 0, ease: 'in' },
      ]);
      expect(n.transform.opacity).toBe(100);
    });
  });

  it('rise: 0.6 s from 40 below with out, plus a fade over the same span', () => {
    build((ctx) => {
      const n = box(ctx);
      n.transform.position = [5, 7];
      ctx.add(n);
      ctx.rise(n, 1);
      expect(keys(n, 'position')).toEqual([
        { t: 1, v: [5, 47], ease: 'out' },
        { t: 1.6, v: [5, 7], ease: 'out' },
      ]);
      expect(keys(n, 'opacity')?.map((k) => [k.t, k.v])).toEqual([
        [1, 0],
        [1.6, 100],
      ]);
    });
  });

  it('pop: 0.35 s about the bounding-box centre, 0 to 108 to 100, fading in over the first 40 percent', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      ctx.pop(n, 1);
      expect(n.transform.anchor).toEqual([120, 210]);
      expect(n.transform.position).toEqual([120, 210]);
      const scale = keys(n, 'scale') ?? [];
      expect(scale.map((k) => k.v)).toEqual([
        [0, 0],
        [108, 108],
        [100, 100],
      ]);
      expect(scale[0].t).toBe(1);
      expect(scale[1].t).toBeCloseTo(1.245);
      expect(scale[2].t).toBeCloseTo(1.35);
      const opacity = keys(n, 'opacity') ?? [];
      expect(opacity.map((k) => k.v)).toEqual([0, 100]);
      expect(opacity[1].t).toBeCloseTo(1.14);
      // Settled, it sits where it was drawn.
      expect(bboxAt(n, 5)).toEqual({ x: 100, y: 200, width: 40, height: 20 });
    });
  });

  it('draw: 1 s trim from 0 to 100 with inOut, nothing drawn before it starts', () => {
    build((ctx) => {
      const n = ctx.line([0, 0], [10, 0], { stroke: '#000000' });
      ctx.add(n);
      expect(trimAt(n, 0)).toBe(100);
      ctx.draw(n, 2);
      expect(n.trimmed).toBe(true);
      expect(keys(n, 'trimEnd')).toEqual([
        { t: 2, v: 0, ease: 'inOut' },
        { t: 3, v: 100, ease: 'inOut' },
      ]);
      expect(trimAt(n, 0)).toBe(0);
      expect(trimAt(n, 2.5)).toBeCloseTo(50);
      expect(trimAt(n, 9)).toBe(100);
      expect(() => ctx.draw(ctx.group('empty', []), 1)).toThrow('needs a node with paths');
    });
  });

  it('camera: 6 s to 103.5 percent about the scene centre with inOut, on the camera node', () => {
    const model = build((ctx) => ctx.camera(1));
    expect(model.camera.transform.anchor).toEqual([960, 540]);
    expect(model.camera.transform.position).toEqual([960, 540]);
    expect(keys(model.camera, 'scale')).toEqual([
      { t: 1, v: [100, 100], ease: 'inOut' },
      { t: 7, v: [103.5, 103.5], ease: 'inOut' },
    ]);
    const custom = build((ctx) => ctx.camera(0, { dur: 2, scaleTo: 110, origin: [10, 20] }));
    expect(custom.camera.transform.anchor).toEqual([10, 20]);
    expect(keys(custom.camera, 'scale')?.[1]).toEqual({ t: 2, v: [110, 110], ease: 'inOut' });
  });

  it('tween: takes keys in any order, defaults to inOut, and widens a scale number', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      ctx.tween(n, 'scale', [
        { t: 3, v: 50 },
        { t: 1, v: [100, 100], ease: 'linear' },
      ]);
      expect(keys(n, 'scale')).toEqual([
        { t: 1, v: [100, 100], ease: 'linear' },
        { t: 3, v: [50, 50], ease: 'inOut' },
      ]);
      expect(() => ctx.tween(n, 'position', [{ t: 1, v: 5 }])).toThrow('needs [x, y] values');
      expect(() => ctx.tween(n, 'rotation', [{ t: 1, v: [1, 2] }])).toThrow('needs number values');
    });
  });
});

describe('motion rules', () => {
  it('merges and sorts keys on the same prop', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      ctx.fade(n, 5, { from: 100, to: 0 });
      ctx.fade(n, 1);
      expect(n.tracks).toHaveLength(1);
      expect(keys(n, 'opacity')?.map((k) => [k.t, k.v])).toEqual([
        [1, 0],
        [1.4, 100],
        [5, 100],
        [5.4, 0],
      ]);
    });
  });

  it('joins two motions that meet at the same instant with one key', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      ctx.fade(n, 1, { dur: 1 });
      ctx.fade(n, 2, { dur: 1, from: 100, to: 0, ease: 'in' });
      expect(keys(n, 'opacity')).toEqual([
        { t: 1, v: 0, ease: 'inOut' },
        { t: 2, v: 100, ease: 'in' },
        { t: 3, v: 0, ease: 'in' },
      ]);
    });
  });

  it('throws MotionConflictError naming the node and prop when two segments overlap', () => {
    build((ctx) => {
      const n = ctx.rect(0, 0, 10, 10, { fill: '#000000' }, 'plate');
      ctx.add(n);
      ctx.fade(n, 1, { dur: 2 });
      let thrown: unknown;
      try {
        ctx.fade(n, 2, { from: 100, to: 0 });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MotionConflictError);
      const conflict = thrown as MotionConflictError;
      expect(conflict.node).toBe(n);
      expect(conflict.prop).toBe('opacity');
      expect(conflict.message).toContain('opacity on "plate" (n1)');
      // A different prop over the same span is fine.
      expect(() =>
        ctx.tween(n, 'rotation', [
          { t: 1, v: 0 },
          { t: 3, v: 10 },
        ])
      ).not.toThrow();
    });
  });

  it('pop after rise, and rise after pop, both settle at the drawn box', () => {
    build((ctx) => {
      const a = box(ctx);
      const b = box(ctx);
      ctx.add(a, b);
      ctx.rise(a, 1);
      ctx.pop(a, 5);
      ctx.pop(b, 1);
      ctx.rise(b, 5);
      const drawn = { x: 100, y: 200, width: 40, height: 20 };
      expect(bboxAt(a, 9)).toEqual(drawn);
      expect(bboxAt(b, 9)).toEqual(drawn);
      // The rise still starts 40 below.
      expect(keys(a, 'position')?.map((k) => k.v)).toEqual([
        [120, 250],
        [120, 210],
      ]);
    });
  });

  it('throws MotionConflictError naming the node, prop and time when two motions meet at one instant with different values', () => {
    build((ctx) => {
      const n = ctx.rect(0, 0, 10, 10, { fill: '#000000' }, 'plate');
      ctx.add(n);
      ctx.fade(n, 2, { from: 100, to: 0 });
      const before = structuredClone(keys(n, 'opacity'));
      let thrown: unknown;
      try {
        ctx.tween(n, 'opacity', [
          { t: 1, v: 0 },
          { t: 2, v: 50 },
        ]);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MotionConflictError);
      const conflict = thrown as MotionConflictError;
      expect(conflict.node).toBe(n);
      expect(conflict.prop).toBe('opacity');
      expect(conflict.message).toContain('opacity on "plate" (n1)');
      expect(conflict.message).toContain('at 2 s');
      // The refused motion left nothing behind.
      expect(keys(n, 'opacity')).toEqual(before);
      expect(() =>
        ctx.tween(n, 'opacity', [
          { t: 1, v: 0 },
          { t: 2, v: 100 },
        ])
      ).not.toThrow();

      const m = ctx.rect(0, 0, 10, 10, { fill: '#000000' }, 'tile');
      ctx.add(m);
      ctx.tween(m, 'position', [
        { t: 1, v: [0, 0] },
        { t: 2, v: [10, 0] },
      ]);
      expect(() =>
        ctx.tween(m, 'position', [
          { t: 2, v: [10, 5] },
          { t: 3, v: [0, 0] },
        ])
      ).toThrow(MotionConflictError);
    });
  });

  it('throws TimingError for a duration that is not a positive finite number', () => {
    build((ctx) => {
      const n = ctx.rect(0, 0, 10, 10, { fill: '#000000' }, 'plate');
      ctx.add(n);
      for (const dur of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => ctx.fade(n, 1, { dur })).toThrow(TimingError);
        expect(() => ctx.rise(n, 1, { dur })).toThrow(TimingError);
        expect(() => ctx.pop(n, 1, { dur })).toThrow(TimingError);
        expect(() => ctx.draw(n, 1, dur)).toThrow(TimingError);
        expect(() => ctx.camera(1, { dur })).toThrow(TimingError);
      }
      expect(() => ctx.fade(n, 1, { dur: 0 })).toThrow(
        'fade on "plate" (n1) needs a duration above 0 s, got 0'
      );
      expect(() => ctx.camera(1, { dur: 0 })).toThrow('camera needs a duration above 0 s, got 0');
      // Nothing was left behind by the refused calls.
      expect(n.tracks).toEqual([]);
      expect(n.trimmed).toBe(false);
      expect(n.transform.opacity).toBe(100);
    });
  });

  it('refuses a second camera move about a different origin', () => {
    const model = build((ctx) => {
      ctx.camera(0, { dur: 2, origin: [100, 100] });
      expect(() => ctx.camera(2, { dur: 2, scaleTo: 110, origin: [100, 100] })).not.toThrow();
      let thrown: unknown;
      try {
        ctx.camera(4, { dur: 2, origin: [500, 300] });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(MotionConflictError);
      expect((thrown as Error).message).toBe(
        'camera moves about [100, 100] already, and cannot also move about [500, 300]'
      );
      // Leaving the origin out means the scene centre, which is a different origin here.
      expect(() => ctx.camera(4, { dur: 2 })).toThrow(MotionConflictError);
    });
    expect(model.camera.transform.anchor).toEqual([100, 100]);
    expect(keys(model.camera, 'scale')).toHaveLength(3);
  });

  it('rect, line and circle refuse coordinates that are not finite numbers', () => {
    build((ctx) => {
      expect(() => ctx.rect(Number.NaN, 0, 1, 1, {})).toThrow(TypeError);
      expect(() => ctx.rect(0, 0, Number.POSITIVE_INFINITY, 1, {}, 'wall')).toThrow(
        'scene test: rect "wall" needs finite numbers, got w Infinity'
      );
      expect(() => ctx.rect(0, 0, 1, Number.NaN, {})).toThrow(TypeError);
      expect(() => ctx.line([0, Number.NaN], [1, 1], {})).toThrow(TypeError);
      expect(() => ctx.line([0, 0], [Number.NEGATIVE_INFINITY, 1], {})).toThrow(
        'scene test: line "line" needs finite numbers, got to[0] -Infinity'
      );
      expect(() => ctx.circle([Number.NaN, 0], 1, {})).toThrow(TypeError);
      expect(() => ctx.circle([0, 0], Number.NaN, {}, 'knob')).toThrow(
        'scene test: circle "knob" needs finite numbers, got r NaN'
      );
      expect(() => ctx.rect(-5, 0.5, 1, 1, {})).not.toThrow();
    });
  });

  it('throws TimingError for any key past the duration or before zero', () => {
    build((ctx) => {
      const n = box(ctx);
      ctx.add(n);
      expect(() => ctx.fade(n, 3.8)).toThrow(TimingError);
      expect(() => ctx.fade(n, 3.8)).toThrow('outside the scene (0 to 4 s)');
      expect(() => ctx.fade(n, -1)).toThrow(TimingError);
      expect(() => ctx.fade(n, 3.6)).not.toThrow();
      expect(() => ctx.camera(0)).toThrow(TimingError);
    }, 4);
  });
});

describe('evaluate', () => {
  const track: Track = {
    prop: 'opacity',
    keys: [
      { t: 1, v: 0, ease: 'linear' },
      { t: 3, v: 100, ease: 'in' },
      { t: 4, v: 0, ease: 'linear' },
    ],
  };

  it('valueAt holds before the first key and after the last, and eases between', () => {
    expect(valueAt(undefined, 42, 1)).toBe(42);
    expect(valueAt(track, 42, 0)).toBe(0);
    expect(valueAt(track, 42, 2)).toBeCloseTo(50);
    expect(valueAt(track, 42, 3)).toBe(100);
    expect(valueAt(track, 42, 3.5)).toBeCloseTo(100 - 100 * easeAt('in', 0.5));
    expect(valueAt(track, 42, 9)).toBe(0);
    const move: Track = {
      prop: 'position',
      keys: [
        { t: 0, v: [0, 10], ease: 'linear' },
        { t: 2, v: [20, 30], ease: 'linear' },
      ],
    };
    const [x, y] = valueAt(move, [0, 0], 1);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(20);
  });

  it('easeAt runs from 0 to 1 and bends the named way', () => {
    expect(easeAt('linear', 0.25)).toBeCloseTo(0.25);
    expect(easeAt('inOut', 0)).toBe(0);
    expect(easeAt('inOut', 1)).toBe(1);
    expect(easeAt('inOut', 0.5)).toBeCloseTo(0.5);
    expect(easeAt('in', 0.5)).toBeLessThan(0.5);
    expect(easeAt('out', 0.5)).toBeGreaterThan(0.5);
  });

  it('transformAt blends tracks over the static transform', () => {
    build((ctx) => {
      const n = box(ctx);
      n.transform.rotation = 15;
      ctx.add(n);
      ctx.tween(n, 'position', [
        { t: 0, v: [0, 0], ease: 'linear' },
        { t: 2, v: [10, 0], ease: 'linear' },
      ]);
      const tr = transformAt(n, 1);
      expect(tr.position[0]).toBeCloseTo(5);
      expect(tr.rotation).toBe(15);
      expect(tr.scale).toEqual([100, 100]);
      expect(tr.opacity).toBe(100);
    });
  });

  it('bboxAt follows the transforms of the node and its children', () => {
    build((ctx) => {
      const child = ctx.rect(0, 0, 10, 10, { fill: '#000000' });
      child.transform.position = [5, 0];
      const parent = ctx.group('parent', [child]);
      parent.transform.scale = [200, 200];
      ctx.add(parent);
      ctx.tween(parent, 'position', [
        { t: 0, v: [0, 0], ease: 'linear' },
        { t: 2, v: [100, 0], ease: 'linear' },
      ]);
      expect(bboxAt(parent, 0)).toEqual({ x: 10, y: 0, width: 20, height: 20 });
      expect(bboxAt(parent, 2)).toEqual({ x: 110, y: 0, width: 20, height: 20 });
      expect(bboxAt(ctx.group('empty', []), 0)).toBeNull();
      const turned = ctx.rect(0, 0, 10, 20, {});
      turned.transform.rotation = 90;
      const turnedBox = bboxAt(turned, 0);
      expect(turnedBox?.x).toBeCloseTo(-20);
      expect(turnedBox?.width).toBeCloseTo(20);
      expect(turnedBox?.height).toBeCloseTo(10);
    });
  });

  it('bboxAt counts tangent control points', () => {
    build((ctx) => {
      const curve = ctx.path('M0 0C0 50 100 50 100 0', {});
      expect(bboxAt(curve, 0)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    });
  });

  it('activeAt is true only while something is changing', () => {
    const model = build((ctx) => {
      const n = box(ctx);
      const inner = box(ctx);
      ctx.add(n, ctx.group('g', [inner]));
      ctx.fade(n, 1, { dur: 1 });
      ctx.fade(n, 5, { dur: 1, from: 100, to: 0 });
      ctx.draw(inner, 7, 1);
    });
    expect(activeAt(model, 0.5)).toBe(false);
    expect(activeAt(model, 1.5)).toBe(true);
    expect(activeAt(model, 3)).toBe(false);
    expect(activeAt(model, 5.5)).toBe(true);
    expect(activeAt(model, 7.5)).toBe(true);
    expect(activeAt(model, 9)).toBe(false);
    expect(
      activeAt(
        build((ctx) => ctx.camera(0)),
        3
      )
    ).toBe(true);
  });
});

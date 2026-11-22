import {
  bakeLinear,
  checkGradient,
  invert,
  isNearSimilarity,
  multiply,
  parsePathD,
  radialFrame,
  stopsOut,
  tightBox,
  type Gradient,
  type Matrix,
  type Vec,
} from '../src/index';

/** A seeded linear congruential generator, so the property tests are the same every run. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const apply = (m: Matrix, [x, y]: Vec): Vec => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];

describe('invert', () => {
  it('undoes a matrix', () => {
    const m: Matrix = [2, 1, -1, 3, 5, -7];
    const inv = invert(m) as Matrix;
    multiply(m, inv).forEach((v, n) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][n], 12));
  });

  it('gives null for a matrix that squashes the plane flat', () => {
    expect(invert([1, 2, 2, 4, 0, 0])).toBeNull();
  });
});

describe('bakeLinear', () => {
  it('maps the gradient value of every point the same way as the matrix does', () => {
    const random = lcg(7);
    for (let run = 0; run < 200; run++) {
      const r = () => random() * 200 - 100;
      const m: Matrix = [r() / 30, r() / 30, r() / 30, r() / 30, r(), r()];
      if (Math.abs(m[0] * m[3] - m[1] * m[2]) < 1e-3) {
        continue;
      }
      const p1: Vec = [r(), r()];
      const p2: Vec = [r(), r()];
      const baked = bakeLinear(p1, p2, m);
      expect(baked).not.toBeNull();
      const { from, to } = baked as { from: Vec; to: Vec };
      const d = sub(p2, p1);
      const dd = sub(to, from);
      for (let k = 0; k < 4; k++) {
        const x: Vec = [r(), r()];
        // t in gradient space, then t of the mapped point in item space.
        const want = dot(sub(x, p1), d) / dot(d, d);
        const got = dot(sub(apply(m, x), from), dd) / dot(dd, dd);
        expect(Math.abs(got - want)).toBeLessThan(1e-9 * Math.max(1, Math.abs(want)));
      }
    }
  });

  it('keeps the points of a gradient that a plain translate moves', () => {
    expect(bakeLinear([0, 0], [10, 0], [1, 0, 0, 1, 5, 5])).toEqual({ from: [5, 5], to: [15, 5] });
  });
});

describe('radialFrame', () => {
  const rebuild = (f: ReturnType<typeof radialFrame>): Matrix => {
    const u: Matrix = [
      Math.cos(f.rotation),
      Math.sin(f.rotation),
      -Math.sin(f.rotation),
      Math.cos(f.rotation),
      0,
      0,
    ];
    const v: Matrix = [
      Math.cos(f.turn),
      Math.sin(f.turn),
      -Math.sin(f.turn),
      Math.cos(f.turn),
      0,
      0,
    ];
    return multiply(multiply(u, [f.s1, 0, 0, f.s2, 0, 0]), v);
  };

  it.each([
    ['a plain stretch', [4, 0, 0, 1, 0, 0] as Matrix],
    ['a rotated stretch', [2, 2, -0.5, 0.5, 3, 4] as Matrix],
    ['a reflection', [1, 0, 0, -3, 0, 0] as Matrix],
    ['a skew', [1, 0, 0.7, 1, 0, 0] as Matrix],
  ])('takes %s apart into rotation, scale, rotation', (_name, m) => {
    const f = radialFrame(m);
    expect(f.s1).toBeGreaterThanOrEqual(Math.abs(f.s2) - 1e-12);
    expect(Math.abs(f.s2)).toBeGreaterThan(0);
    rebuild(f)
      .slice(0, 4)
      .forEach((v, n) => expect(v).toBeCloseTo(m[n], 9));
  });

  it('round trips random matrices', () => {
    const random = lcg(11);
    for (let run = 0; run < 200; run++) {
      const m: Matrix = [
        random() * 4 - 2,
        random() * 4 - 2,
        random() * 4 - 2,
        random() * 4 - 2,
        0,
        0,
      ];
      const f = radialFrame(m);
      rebuild(f)
        .slice(0, 4)
        .forEach((v, n) => expect(Math.abs(v - m[n])).toBeLessThan(1e-9));
      expect(f.s1).toBeGreaterThanOrEqual(Math.abs(f.s2) - 1e-12);
    }
  });
});

describe('isNearSimilarity', () => {
  it('passes rotations, uniform scales and reflections', () => {
    const r = Math.PI / 5;
    expect(
      isNearSimilarity(
        [3 * Math.cos(r), 3 * Math.sin(r), -3 * Math.sin(r), 3 * Math.cos(r), 9, 9],
        50
      )
    ).toBe(true);
    expect(isNearSimilarity([2, 0, 0, -2, 0, 0], 50)).toBe(true);
  });

  it('passes a stretch too small to see over the radius, and fails a visible one', () => {
    expect(isNearSimilarity([100, 0, 0, 100.0000001, 0, 0], 0.5)).toBe(true);
    expect(isNearSimilarity([100, 0, 0, 100.01, 0, 0], 0.5)).toBe(false);
    expect(isNearSimilarity([4, 0, 0, 1, 0, 0], 0.5)).toBe(false);
  });
});

describe('tightBox', () => {
  it('finds the extremes of a curve, not of its control points', () => {
    const box = tightBox(parsePathD('M0 0C0 100 100 100 100 0'));
    expect(box?.x).toBeCloseTo(0, 9);
    expect(box?.y).toBeCloseTo(0, 9);
    expect(box?.width).toBeCloseTo(100, 9);
    expect(box?.height).toBeCloseTo(75, 9);
  });

  it('counts the closing segment of a closed path, and gives null for no paths', () => {
    const box = tightBox(parsePathD('M10 10L20 10L20 30Z'));
    expect(box).toEqual({ x: 10, y: 10, width: 10, height: 20 });
    expect(tightBox([])).toBeNull();
  });
});

describe('stopsOut', () => {
  it('rounds offsets and opacities to 3 decimals and keeps the order', () => {
    expect(
      stopsOut([
        { offset: 0, colour: '#FFF', opacity: 1 },
        { offset: 0.33333333, colour: '#336699', opacity: 0.12345 },
        { offset: 0.3333334, colour: '#000000', opacity: 0 },
      ])
    ).toEqual([
      { offset: 0, colour: '#ffffff', rgb: [1, 1, 1], opacity: 1 },
      { offset: 0.333, colour: '#336699', rgb: [0.2, 0.4, 0.6], opacity: 0.123 },
      { offset: 0.333, colour: '#000000', rgb: [0, 0, 0], opacity: 0 },
    ]);
  });
});

describe('checkGradient', () => {
  const stops = [
    { offset: 0, colour: '#ffffff', opacity: 1 },
    { offset: 1, colour: '#000000', opacity: 1 },
  ];
  const linear: Gradient = { type: 'linear', from: [0, 0], to: [10, 0], stops };
  const radial: Gradient = { type: 'radial', centre: [0, 0], radius: 10, focal: [0, 0], stops };

  it('accepts sound gradients', () => {
    expect(() => checkGradient(linear, 'x')).not.toThrow();
    expect(() => checkGradient(radial, 'x')).not.toThrow();
    expect(() => checkGradient({ ...radial, matrix: [2, 0, 0, 1, 0, 0] }, 'x')).not.toThrow();
  });

  it.each([
    ['one stop', { ...linear, stops: [stops[0]] }, 'needs at least 2 stops'],
    ['falling offsets', { ...linear, stops: [stops[1], stops[0]] }, 'offsets must not fall'],
    [
      'an offset past 1',
      { ...linear, stops: [stops[0], { ...stops[1], offset: 1.5 }] },
      'offsets must be 0 to 1',
    ],
    [
      'a colour name',
      { ...linear, stops: [stops[0], { ...stops[1], colour: 'red' }] },
      'cannot use colour "red"',
    ],
    [
      'an opacity past 1',
      { ...linear, stops: [stops[0], { ...stops[1], opacity: 2 }] },
      'opacity must be 0 to 1',
    ],
    ['a NaN point', { ...linear, to: [Number.NaN, 0] }, 'finite numbers'],
    ['from and to the same', { ...linear, to: [0, 0] }, 'from and to at the same point'],
    ['a zero radius', { ...radial, radius: 0 }, 'radius above 0'],
    ['a focal point on the edge', { ...radial, focal: [9.95, 0] }, 'focal point'],
    ['a flat matrix', { ...radial, matrix: [1, 2, 2, 4, 0, 0] }, 'squashed flat'],
  ] as Array<[string, Gradient, string]>)('refuses %s', (_name, g, message) => {
    expect(() => checkGradient(g, 'node "a" (n1)')).toThrow(message);
    expect(() => checkGradient(g, 'node "a" (n1)')).toThrow('node "a" (n1)');
  });
});

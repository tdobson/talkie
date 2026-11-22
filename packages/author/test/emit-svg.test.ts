import { compileScene, scene, svgAt, type Gradient, type Vec } from '../src/index';
import { everything, gauge, golden, shaded } from './scenes';

const attr = (svg: string, name: string) =>
  [...svg.matchAll(new RegExp(` ${name}="([^"]*)"`, 'g'))].map((match) => match[1]);

describe('svgAt', () => {
  it('draws the gauge line on: dashoffset 100 at the start and 0 once drawn', () => {
    const model = gauge();
    const start = svgAt(model, 0);
    expect(
      start.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080">')
    ).toBe(true);
    expect(start.endsWith('</svg>')).toBe(true);
    expect(attr(start, 'stroke-dashoffset')).toEqual(['100']);
    expect(attr(start, 'pathLength')).toEqual(['100']);
    expect(attr(start, 'stroke-dasharray')).toEqual(['100']);
    expect(attr(svgAt(model, 2.2), 'stroke-dashoffset')).toEqual(['0']);
    const half = Number(attr(svgAt(model, 1.6), 'stroke-dashoffset')[0]);
    expect(half).toBeCloseTo(50, 1);
  });

  it('writes the line with its stroke and no fill', () => {
    const svg = svgAt(gauge(), 3);
    expect(svg).toContain(
      '<path d="M400 600L1200 600" fill="none" stroke="#0f6b73" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"'
    );
    expect(svg).toContain('<g data-node="camera" data-name="camera">');
    expect(svg).toContain('<g data-node="n1" data-name="gauge line">');
  });

  it('nests groups with transform and opacity evaluated at t', () => {
    const model = everything();
    const before = svgAt(model, 0);
    // The timber group is hidden and 40 below before it rises at 1.4 s.
    expect(before).toContain(
      '<g data-node="n9" data-name="timber" transform="matrix(1 0 0 1 0 40)" opacity="0">'
    );
    const after = svgAt(model, 10);
    expect(after).toContain('<g data-node="n9" data-name="timber">');
    // The camera has scaled to 103.5 percent about the centre.
    expect(after).toContain(
      '<g data-node="camera" data-name="camera" transform="matrix(1.035 0 0 1.035 -33.6 -18.9)">'
    );
    // The badge has turned a quarter and sits at its position.
    expect(after).toContain('transform="matrix(0 1 -1 0 1500 300)"');
  });

  it('draws in order: back to front, children under the items of their parent', () => {
    const svg = svgAt(everything(), 10);
    const order = attr(svg, 'data-name');
    expect(order).toEqual(['camera', 'sky', 'timber', 'rect', 'nail', 'line', 'path', 'badge']);
  });

  it('writes curves as C and closes closed paths', () => {
    const def = scene('curve', (ctx) =>
      ctx.add(ctx.path('M0 0C0 50 100 50 100 0Z', { fill: '#ff0000' }, 'a "quoted" <name>'))
    );
    const svg = svgAt(compileScene(def, { size: [100, 100], lines: [], duration: 1 }), 0);
    expect(svg).toContain('<path d="M0 0C0 50 100 50 100 0Z" fill="#ff0000"/>');
    expect(svg).toContain('data-name="a &quot;quoted&quot; &lt;name&gt;"');
  });

  it('keeps the paths of an untrimmed item in one element so holes stay holes', () => {
    const def = scene('hole', (ctx) =>
      ctx.add(ctx.path('M0 0H10V10H0ZM2 2V8H8V2Z', { fill: '#000000' }))
    );
    const svg = svgAt(compileScene(def, { size: [100, 100], lines: [], duration: 1 }), 0);
    expect(svg.match(/<path /g)).toHaveLength(1);
  });

  it('matches the golden file for the full scene at several times', () => {
    const frames = [0, 1.6, 2.5, 5.7, 10].map((t) => svgAt(everything(), t));
    expect(frames).toEqual(golden('everything-svg', frames));
  });
});

describe('svgAt gradients', () => {
  const STOPS = [
    { offset: 0, colour: '#FFFFFF', opacity: 1 },
    { offset: 0.33333, colour: '#0000ff', opacity: 0.25 },
  ];
  const draw = (id: string, build: Parameters<typeof scene>[1]) =>
    svgAt(compileScene(scene(id, build), { size: [320, 180], lines: [], duration: 2 }), 0);

  it('writes a linear gradient fill in user space just before the path that uses it', () => {
    const g: Gradient = { type: 'linear', from: [10, 20], to: [110.12345, 20], stops: STOPS };
    const svg = draw('sky', (c) => c.add(c.rect(0, 0, 120, 40, { fill: g }, 'plate')));
    expect(svg).toContain(
      '<linearGradient id="sky-n1-f0" gradientUnits="userSpaceOnUse" x1="10" y1="20" x2="110.123" y2="20">' +
        '<stop offset="0" stop-color="#ffffff"/><stop offset="0.333" stop-color="#0000ff" stop-opacity="0.25"/>' +
        '</linearGradient><path d="M0 0L120 0L120 40L0 40Z" fill="url(#sky-n1-f0)"/>'
    );
  });

  it('writes a radial gradient stroke, with the focal point only when it moves', () => {
    const g: Gradient = {
      type: 'radial',
      centre: [50, 50],
      radius: 20,
      focal: [50, 60],
      stops: STOPS,
    };
    const svg = draw('s', (c) =>
      c.add(c.circle([50, 50], 20, { fill: '#000', stroke: g, strokeWidth: 3 }, 'bead'))
    );
    expect(svg).toContain(
      '<radialGradient id="s-n1-s0" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="20" fx="50" fy="60">'
    );
    expect(svg).toContain('fill="#000" stroke="url(#s-n1-s0)" stroke-width="3"');
    const centred = draw('s', (c) =>
      c.add(c.circle([50, 50], 20, { fill: { ...g, focal: [50, 50] as Vec } }, 'bead'))
    );
    expect(centred).toContain(
      '<radialGradient id="s-n1-f0" gradientUnits="userSpaceOnUse" cx="50" cy="50" r="20">'
    );
  });

  it('writes a stretched radial gradient with its matrix as gradientTransform', () => {
    const g: Gradient = {
      type: 'radial',
      centre: [0.5, 0.5],
      radius: 0.5,
      focal: [0.5, 0.5],
      stops: STOPS,
      matrix: [80, 0, 0, 20, 10, 40.1234567],
    };
    const svg = draw('s', (c) => c.add(c.rect(10, 40, 80, 20, { fill: g }, 'dish')));
    expect(svg).toContain(
      '<radialGradient id="s-n1-f0" gradientUnits="userSpaceOnUse" cx="0.5" cy="0.5" r="0.5" gradientTransform="matrix(80 0 0 20 10 40.123457)">'
    );
  });

  it('makes ids safe from the scene id, and unique per node and item', () => {
    const g: Gradient = { type: 'linear', from: [0, 0], to: [10, 0], stops: STOPS };
    const svg = draw('my scene/1 "x"', (c) => {
      const two = c.node('two', [
        { paths: c.rect(0, 0, 5, 5, {}).items[0].paths, style: { fill: g } },
        { paths: c.rect(5, 0, 5, 5, {}).items[0].paths, style: { fill: g, stroke: g } },
      ]);
      c.add(two);
    });
    const ids = attr(svg, 'id');
    expect(ids).toEqual(['my_scene_1__x_-n3-f0', 'my_scene_1__x_-n3-f1', 'my_scene_1__x_-n3-s1']);
  });

  it('refuses what the film refuses', () => {
    const g: Gradient = { type: 'linear', from: [0, 0], to: [0, 0], stops: STOPS };
    expect(() => draw('s', (c) => c.add(c.rect(0, 0, 5, 5, { fill: g }, 'plate')))).toThrow(
      'node "plate" (n1): its gradient has from and to at the same point'
    );
  });
});

describe('svgAt on the shaded scene', () => {
  it('matches the golden file', () => {
    const frames = [0, 0.8, 3].map((t) => svgAt(shaded(), t));
    expect(frames).toEqual(golden('shaded-svg', frames));
  });
});

describe('svgAt clips', () => {
  const draw = (build: Parameters<typeof scene>[1]) =>
    svgAt(compileScene(scene('clip me', build), { size: [320, 180], lines: [], duration: 2 }), 0);
  const rect = (x: number, y: number, w: number, h: number) =>
    compileScene(
      scene('r', (c) => c.add(c.rect(x, y, w, h, {}))),
      { size: [320, 180], lines: [], duration: 1 }
    ).nodes[0].items[0].paths[0];

  it('writes a clipPath with one path per contour, used by the group that has the transform', () => {
    const svg = draw((c) => {
      const plate = c.rect(0, 0, 100, 100, { fill: '#000000' }, 'plate');
      plate.clip = [rect(0, 0, 50, 50), rect(60, 0, 20, 20)];
      plate.transform.position = [5, 6];
      c.add(plate);
    });
    expect(svg).toContain(
      '<clipPath id="clip_me-n1-c" clipPathUnits="userSpaceOnUse"><path d="M0 0L50 0L50 50L0 50Z"/><path d="M60 0L80 0L80 20L60 20Z"/></clipPath>' +
        '<g data-node="n1" data-name="plate" transform="matrix(1 0 0 1 5 6)" clip-path="url(#clip_me-n1-c)">'
    );
  });

  it('leaves out a clip that cuts nothing, as the film does', () => {
    const svg = draw((c) => {
      const plate = c.rect(10, 10, 100, 100, { fill: '#000000' }, 'plate');
      plate.clip = [rect(0, 0, 320, 180)];
      c.add(plate);
    });
    expect(svg).not.toContain('clip');
  });
});

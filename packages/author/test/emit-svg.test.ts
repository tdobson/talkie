import { compileScene, scene, svgAt } from '../src/index';
import { everything, gauge, golden } from './scenes';

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

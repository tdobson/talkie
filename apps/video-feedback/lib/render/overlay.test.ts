import { boxSvg, overlaySvg, pointerSvg, ringsSvg, trailSvg } from './overlay';

describe('overlay', () => {
  it('pointerSvg places the tip at the given point', () =>
    expect(pointerSvg(10, 20, 24)).toMatch(/M\s*10[ ,]20/));

  it('pointerSvg is a white arrow with a dark outline', () => {
    const svg = pointerSvg(10, 20, 24);
    expect(svg).toMatch(/fill="#ffffff"/);
    expect(svg).toMatch(/stroke="#111111"/);
  });

  it('trailSvg draws one segment per pair of points, fading when asked', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 5 },
    ];
    const faded = trailSvg(pts, 640, 360, { fade: true, colour: '#ffb300' });
    expect(faded.match(/<line /g)).toHaveLength(2);
    const strokes = [...faded.matchAll(/<line [^>]*stroke="(#[0-9a-f]{6})"/g)].map((m) => m[1]);
    expect(new Set(strokes).size).toBe(2); // light at the start, dark at the end
    const flat = trailSvg(pts, 640, 360, { fade: false, colour: '#00bcd4' });
    expect(flat).not.toContain('<line ');
    expect(flat).toContain('#00bcd4');
  });

  it('trailSvg is empty for fewer than two points', () => {
    expect(trailSvg([{ x: 1, y: 1 }], 640, 360, { fade: true, colour: '#ffb300' })).toBe('');
  });

  it('ringsSvg draws a ring per click', () => {
    const svg = ringsSvg(
      [
        { x: 5, y: 6 },
        { x: 50, y: 60 },
      ],
      12
    );
    expect(svg.match(/<circle [^>]*cx="5" cy="6" r="12"/g)).toHaveLength(2); // dark + light
    expect(svg).toContain('cx="50" cy="60"');
    expect(ringsSvg([], 12)).toBe('');
  });

  it('boxSvg scales a normalised rect to output pixels', () => {
    const svg = boxSvg({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, 640, 360);
    expect(svg).toContain('x="160" y="180" width="320" height="90"');
  });

  it('overlaySvg wraps parts in a sized svg document', () => {
    const svg = overlaySvg(640, 360, ['<g id="a"/>', '', '<g id="b"/>']);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="640" height="360"/);
    expect(svg).toContain('<g id="a"/><g id="b"/>');
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

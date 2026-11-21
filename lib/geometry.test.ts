import {
  containRect,
  distance,
  normalise,
  percent,
  positionLabel,
  unzoom,
  visibleRegion,
} from './geometry';

describe('containRect', () => {
  it('letterboxes a 16:9 video in a 4:3 box', () =>
    expect(containRect(800, 600, 1920, 1080)).toEqual({ x: 0, y: 75, width: 800, height: 450 }));
  it('pillarboxes a 9:16 video in a 16:9 box', () => {
    const r = containRect(1600, 900, 1080, 1920);
    expect(r.height).toBe(900);
    expect(r.width).toBeCloseTo(506.25);
    expect(r.x).toBeCloseTo(546.875);
  });
  it('handles zero sizes', () => expect(containRect(0, 0, 1920, 1080).width).toBe(0));
});

describe('normalise', () => {
  const content = { x: 0, y: 75, width: 800, height: 450 };
  it('maps centre', () =>
    expect(normalise(400, 300, content)).toEqual({ x: 0.5, y: 0.5, inside: true }));
  it('flags the black bar as outside', () =>
    expect(normalise(400, 10, content).inside).toBe(false));
});

describe('unzoom', () => {
  it('is identity without zoom', () => expect(unzoom(0.3, 0.7, null)).toEqual({ x: 0.3, y: 0.7 }));
  it('keeps the origin fixed', () =>
    expect(unzoom(0.4, 0.6, { scale: 2.5, originX: 0.4, originY: 0.6 })).toEqual({
      x: 0.4,
      y: 0.6,
    }));
  it('maps the top-left screen corner into the zoomed region', () => {
    const p = unzoom(0, 0, { scale: 2, originX: 0.5, originY: 0.5 });
    expect(p.x).toBeCloseTo(0.25);
    expect(p.y).toBeCloseTo(0.25);
  });
  it('round-trips with the CSS transform maths', () => {
    const z = { scale: 2.5, originX: 0.2, originY: 0.9 };
    const frame = { x: 0.25, y: 0.85 };
    const screen = {
      x: z.originX + (frame.x - z.originX) * z.scale,
      y: z.originY + (frame.y - z.originY) * z.scale,
    };
    const back = unzoom(screen.x, screen.y, z);
    expect(back.x).toBeCloseTo(frame.x);
    expect(back.y).toBeCloseTo(frame.y);
  });
});

describe('visibleRegion', () => {
  it('is the full frame at scale 1', () =>
    expect(visibleRegion({ scale: 1, originX: 0.3, originY: 0.3 })).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    }));
  it('anchors at the origin', () => {
    const r = visibleRegion({ scale: 2, originX: 1, originY: 0 });
    expect(r).toEqual({ x: 0.5, y: 0, width: 0.5, height: 0.5 });
  });
});

describe('positionLabel', () => {
  it.each([
    [0.1, 0.1, 'top-left'],
    [0.5, 0.1, 'top-centre'],
    [0.9, 0.5, 'middle-right'],
    [0.5, 0.5, 'centre'],
    [0.5, 0.9, 'bottom-centre'],
    [1, 1, 'bottom-right'],
    [1.2, 0.5, 'off-picture'],
  ])('(%s,%s) -> %s', (x, y, l) => expect(positionLabel(x, y)).toBe(l));
});

describe('distance and percent', () => {
  it('measures a 3-4-5 triangle', () =>
    expect(distance({ x: 0, y: 0 }, { x: 0.3, y: 0.4 })).toBeCloseTo(0.5));
  it('rounds to a whole percent', () => expect(percent(0.126)).toBe('13%'));
});

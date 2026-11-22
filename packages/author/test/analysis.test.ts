import {
  bboxAt,
  compileScene,
  outOfBand,
  scene,
  stillSpans,
  type SceneContext,
  type SceneModel,
} from '../src/index';

const LINES = [{ id: 'l1', text: 'Set the gauge.', start: 1.4, voiceEnd: 2.6, captionEnd: 4.4 }];
const build = (fn: (ctx: SceneContext) => void, duration = 20): SceneModel =>
  compileScene(scene('test', fn), { size: [1920, 1080], lines: LINES, duration });
const box = (ctx: SceneContext, y: number, name: string) =>
  ctx.rect(100, y, 40, 20, { fill: '#000000' }, name);

describe('stillSpans', () => {
  it('gives the whole scene when nothing moves', () => {
    const model = build((ctx) => ctx.add(box(ctx, 100, 'a')));
    expect(stillSpans(model)).toEqual([{ start: 0, end: 20 }]);
  });

  it('gives the gaps between motions, joining motions that overlap or touch', () => {
    const model = build((ctx) => {
      const a = box(ctx, 100, 'a');
      const b = box(ctx, 200, 'b');
      const inner = box(ctx, 300, 'inner');
      ctx.add(a, b, ctx.group('g', [inner]));
      ctx.fade(a, 1, { dur: 1 });
      ctx.fade(b, 1.5, { dur: 1.5 });
      ctx.fade(inner, 3, { dur: 1 });
      ctx.fade(a, 14, { dur: 2, from: 100, to: 0 });
    });
    expect(stillSpans(model)).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 14 },
      { start: 16, end: 20 },
    ]);
  });

  it('counts the camera as motion, and a key pair that holds its value as still', () => {
    const model = build((ctx) => {
      const a = box(ctx, 100, 'a');
      ctx.add(a);
      ctx.camera(2, { dur: 6 });
      ctx.tween(a, 'opacity', [
        { t: 10, v: 100 },
        { t: 12, v: 100 },
      ]);
    });
    expect(stillSpans(model)).toEqual([
      { start: 0, end: 2 },
      { start: 8, end: 20 },
    ]);
  });

  it('gives nothing when the scene moves throughout', () => {
    const model = build((ctx) => {
      const a = box(ctx, 100, 'a');
      ctx.add(a);
      ctx.fade(a, 0, { dur: 20 });
    });
    expect(stillSpans(model)).toEqual([]);
  });
});

describe('outOfBand', () => {
  const band = { y: 845 };

  it('gives nothing when every node stays above the band', () => {
    const model = build((ctx) => ctx.add(box(ctx, 825, 'edge'), box(ctx, 100, 'high')));
    // the box ends at y 845 exactly, which is not inside y > 845
    expect(outOfBand(model, band)).toEqual([]);
  });

  it('names a node that sits in the band, with how far down it reaches', () => {
    const model = build((ctx) => ctx.add(box(ctx, 100, 'high'), box(ctx, 900, 'low')));
    expect(outOfBand(model, band)).toEqual([{ id: 'n2', name: 'low', t: 0, bottom: 920 }]);
  });

  it('names a node that moves into the band, at the first key time it is there', () => {
    const model = build((ctx) => {
      const a = box(ctx, 100, 'mover');
      ctx.add(a);
      ctx.tween(a, 'position', [
        { t: 2, v: [0, 0] },
        { t: 4, v: [0, 800] },
        { t: 6, v: [0, 0] },
      ]);
    });
    expect(outOfBand(model, band)).toEqual([{ id: 'n1', name: 'mover', t: 4, bottom: 920 }]);
  });

  it('counts children and the camera', () => {
    const model = build((ctx) => {
      ctx.add(ctx.group('g', [box(ctx, 900, 'inner')]), box(ctx, 820, 'near'));
      // zooming about the top left corner pushes the lower box over the line
      ctx.camera(1, { dur: 2, scaleTo: 110, origin: [0, 0] });
    });
    const found = outOfBand(model, band);
    expect(found.map((f) => [f.name, f.t])).toEqual([
      ['g', 0],
      ['near', 3],
    ]);
    expect(found[1].bottom).toBeCloseTo(924, 6);
  });

  it('leaves out a node while it cannot be seen', () => {
    const model = build((ctx) => {
      const hidden = box(ctx, 900, 'hidden');
      const shown = box(ctx, 900, 'shown');
      ctx.add(hidden, shown);
      ctx.tween(hidden, 'opacity', [
        { t: 0, v: 0 },
        { t: 5, v: 0 },
      ]);
      ctx.fade(shown, 3, { dur: 1 });
    });
    expect(outOfBand(model, band)).toEqual([{ id: 'n2', name: 'shown', t: 4, bottom: 920 }]);
  });

  it('passes over a background, which is a node that covers the whole stage', () => {
    const model = build((ctx) => {
      const sky = ctx.rect(0, 0, 1920, 1080, { fill: '#eaf3f6' }, 'sky');
      // Nearly a background, but it stops short of the right edge, so it is art.
      const floor = ctx.rect(0, 0, 1900, 1080, { fill: '#cccccc' }, 'floor');
      ctx.add(sky, floor, box(ctx, 900, 'low'));
      ctx.camera(1, { dur: 2, scaleTo: 110 });
    });
    expect(outOfBand(model, band).map((hit) => hit.name)).toEqual(['floor', 'low']);
  });

  it('counts only the part a clip lets through', () => {
    const model = build((ctx) => {
      // Drawn down to 1000, but clipped at 800, so nothing shows in the band.
      const tall = ctx.rect(100, 100, 200, 900, { fill: '#000000' }, 'tall');
      tall.clip = ctx.rect(0, 0, 1920, 800, {}).items[0].paths;
      const low = ctx.rect(100, 100, 200, 900, { fill: '#000000' }, 'low');
      low.clip = ctx.rect(0, 0, 1920, 900, {}).items[0].paths;
      ctx.add(tall, low);
    });
    expect(outOfBand(model, band)).toEqual([{ id: 'n3', name: 'low', t: 0, bottom: 900 }]);
  });
});

describe('clip-aware boxes', () => {
  it('pops a clipped node about the centre of the part that shows', () => {
    const model = build((ctx) => {
      const plate = ctx.rect(0, 0, 400, 400, { fill: '#000000' }, 'plate');
      plate.clip = ctx.rect(100, 100, 100, 50, {}).items[0].paths;
      ctx.add(plate);
      ctx.pop(plate, 1);
    });
    expect(model.nodes[0].transform.anchor).toEqual([150, 125]);
  });

  it('gives no box for a node clipped away from all its paths', () => {
    const model = build((ctx) => {
      const plate = ctx.rect(0, 0, 10, 10, { fill: '#000000' }, 'plate');
      plate.clip = ctx.rect(100, 100, 10, 10, {}).items[0].paths;
      ctx.add(ctx.group('g', [plate]));
    });
    expect(bboxAt(model.nodes[0], 0)).toBeNull();
  });

  it('moves the clip with the clipped node and its children inside it', () => {
    const model = build((ctx) => {
      const child = ctx.rect(0, 0, 400, 400, { fill: '#000000' }, 'child');
      child.transform.position = [50, 0];
      const plate = ctx.group('plate', [child]);
      plate.clip = ctx.rect(0, 0, 100, 100, {}).items[0].paths;
      plate.transform.position = [10, 20];
      ctx.add(plate);
    });
    expect(bboxAt(model.nodes[0], 0)).toEqual({ x: 60, y: 20, width: 50, height: 100 });
  });
});

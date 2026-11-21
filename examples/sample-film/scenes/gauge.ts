import { scene } from '@talkie/author';

const SKY = '#eaf3f6';
const INK = '#1d3b47';
const ACCENT = '#d9480f';
const TOP = 150;
const NEXT = 390;

export default scene('gauge', (c) => {
  // The bottom of the stage is kept clear for captions, so the picture stops at y 540.
  const sky = c.rect(0, 0, 1280, 540, { fill: SKY }, 'sky');
  const upper = c.art('batten', { at: [120, TOP] });
  const lower = c.art('batten', { at: [120, NEXT] });

  // The dimension: a line from the top of one batten to the top of the next, with a tick at
  // each end. line() and path() take a style, and draw() strokes them on.
  const stroke = { stroke: ACCENT, strokeWidth: 6, lineCap: 'round' as const };
  const dimension = c.line([960, TOP], [960, NEXT], stroke, 'dimension');
  const ticks = c.path(`M930 ${TOP} H990 M930 ${NEXT} H990`, stroke, 'ticks');
  const gaugeName = c.label('Gauge', { at: [1010, 282], color: ACCENT });

  const sum = c.group('sum', [
    c.label('Tile length 400 mm', { at: [160, 250], size: 30 }),
    c.label('Headlap 100 mm', { at: [160, 294], size: 30 }),
  ]);
  const answer = c.label('Gauge 300 mm', { at: [160, 352], size: 40, color: ACCENT });
  const ring = c.circle([960, 270], 150, { stroke: INK, strokeWidth: 4 }, 'ring');

  c.add(sky, upper, lower, dimension, ticks, gaugeName, sum, answer, ring);

  c.draw(ticks, c.T('gauge-a', 0.4), 0.5);
  c.draw(dimension, c.T('gauge-a', 0.9), 1.2);
  c.rise(gaugeName, c.T('gauge-a', 2));

  c.fade(sum, c.T('gauge-b', 0.3));
  c.pop(answer, c.T('gauge-b', 2.2));

  // tween() sets any property key by key. Here the ring strokes on, then fades away.
  c.tween(ring, 'trimEnd', [
    { t: c.T('gauge-b', 2.2), v: 0 },
    { t: c.T('gauge-b', 3), v: 100, ease: 'out' },
  ]);
  c.tween(ring, 'opacity', [
    { t: c.T('gauge-b', 3.4), v: 100 },
    { t: c.T('gauge-b', 4), v: 0, ease: 'in' },
  ]);
});

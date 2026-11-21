import { scene } from '@talkie/author';

const SKY = '#eaf3f6';
const INK = '#1d3b47';
const ACCENT = '#d9480f';
const MARK_Y = [470, 330, 190];
const STEP = 140;

export default scene('setting-out', (c) => {
  // The sky fills the frame. Everything else stays above y 563, where the caption band starts.
  const sky = c.rect(0, 0, 1280, 720, { fill: SKY }, 'sky');
  const rafter = c.art('roof/rafter', { at: [620, 70], scale: 0.9 });

  // node() makes a parent with shapes of its own or, as here, with children. The rod and its
  // two marks then move together.
  const rod = c.node(
    'rod',
    [],
    [
      c.rect(700, MARK_Y[0] - STEP - 20, 26, STEP + 40, { fill: '#f1c40f' }, 'rod body'),
      c.line([700, MARK_Y[0]], [726, MARK_Y[0]], { stroke: INK, strokeWidth: 4 }, 'low mark'),
      c.line(
        [700, MARK_Y[0] - STEP],
        [726, MARK_Y[0] - STEP],
        { stroke: INK, strokeWidth: 4 },
        'high mark'
      ),
    ]
  );
  const rodName = c.label('Gauge rod', { at: [750, 420], size: 30 });

  const marks = MARK_Y.map((y) => c.circle([640, y], 9, { fill: ACCENT }, 'mark'));
  const battens = MARK_Y.map((y) => c.art('batten', { at: [260, y] }));
  const done = c.label('Every course the same', { at: [640, 50], anchor: 'middle' });

  c.add(sky, rafter, ...battens, rod, rodName, ...marks, done);

  c.fade(rod, c.T('set-a'));
  c.fade(rodName, c.T('set-a', 0.3));
  c.fade(rodName, c.T('set-a', 1.5), { from: 100, to: 0 });
  c.pop(marks[0], c.T('set-a', 0.8));
  // Step the rod up one gauge at a time, and leave a mark at each stop.
  c.tween(rod, 'position', [
    { t: c.T('set-a', 1.5), v: [0, 0] },
    { t: c.T('set-a', 2.1), v: [0, -STEP], ease: 'linear' },
    { t: c.T('set-a', 2.6), v: [0, -STEP] },
    { t: c.T('set-a', 3.2), v: [0, -2 * STEP] },
  ]);
  c.pop(marks[1], c.T('set-a', 2.1));
  c.pop(marks[2], c.T('set-a', 3.2));

  c.fade(rod, c.T('set-b'), { from: 100, to: 0 });
  battens.forEach((batten, i) => c.rise(batten, c.T('set-b', 0.4 + i * 0.4)));
  c.fade(done, c.T('set-b', 2));
  c.camera(c.T('set-b'), { dur: 3, scaleTo: 103 });
});

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScene, scene, type SceneModel } from '../src/index';

const SIZE: [number, number] = [1920, 1080];

/** The gauge line from the design spec: one teal line drawn on from 1.0 s over 1.2 s. */
export const gaugeDef = scene('s07-batten-gauge', ({ line, draw, add }) => {
  const gaugeLine = line(
    [400, 600],
    [1200, 600],
    { stroke: '#0f6b73', strokeWidth: 6, lineCap: 'round', lineJoin: 'round' },
    'gauge line'
  );
  add(gaugeLine);
  draw(gaugeLine, 1.0, 1.2);
});
export const gauge = (): SceneModel =>
  compileScene(gaugeDef, { size: SIZE, lines: [], duration: 4 });

const LINES = [
  { id: 'l1', text: 'Set the gauge.', start: 1.4, voiceEnd: 2.6, captionEnd: 4.4 },
  { id: 'l2', text: 'Check it twice.', start: 5.1, voiceEnd: 6.15, captionEnd: 8.1 },
];

/** A scene that uses every drawing and motion helper once. */
export const everythingDef = scene('everything', (ctx) => {
  const sky = ctx.rect(0, 0, 1920, 1080, { fill: '#eef' }, 'sky');
  const batten = ctx.rect(400, 560, 800, 40, {
    fill: '#c9a26b',
    stroke: '#5a4320',
    strokeWidth: 3,
  });
  const gaugeLine = ctx.line([400, 700], [1200, 700], { stroke: '#0f6b73', strokeWidth: 6 });
  const nail = ctx.circle([800, 580], 12, { fill: '#333333' }, 'nail');
  const tick = ctx.path('M100 100q30 0 30 30a20 20 0 0 1 -40 0z', { fill: 'none', stroke: '#000' });
  const badge = ctx.node(
    'badge',
    [
      { paths: ctx.circle([0, 0], 30, {}).items[0].paths, style: { fill: '#ffffff' } },
      {
        paths: ctx.rect(-10, -10, 20, 20, {}).items[0].paths,
        style: { stroke: '#d33', strokeWidth: 2 },
      },
    ],
    []
  );
  badge.transform.position = [1500, 300];
  const timber = ctx.group('timber', [batten, nail]);
  ctx.add(sky, timber, gaugeLine, tick, badge);
  ctx.rise(timber, ctx.T('l1'));
  ctx.pop(nail, ctx.T('l1', 1));
  ctx.draw(gaugeLine, ctx.T('l2', 0.5), 1.2);
  ctx.fade(tick, ctx.T('l2'));
  ctx.fade(tick, 9, { from: 100, to: 0, ease: 'in' });
  ctx.tween(badge, 'rotation', [
    { t: 2, v: 0, ease: 'linear' },
    { t: 4, v: 90 },
  ]);
  ctx.camera(0);
});
export const everything = (): SceneModel =>
  compileScene(everythingDef, { size: SIZE, lines: LINES, duration: 10.3 });

const ART = join(__dirname, 'fixtures', 'art');

/**
 * A scene drawn from art with gradients: see-through and hard stops, a stretched radial shadow, a
 * focal point under a gradientTransform, gradient strokes and an href. It fades, rises and pops.
 */
export const shadedDef = scene('shaded', (ctx) => {
  const art = ctx.art('shaded', { at: [0, 0] });
  ctx.add(art);
  const [, shadow, sun, card] = art.children;
  ctx.fade(shadow, 0.2);
  ctx.rise(card, 0.5);
  ctx.pop(sun, 1);
});
export const shaded = (): SceneModel =>
  compileScene(shadedDef, {
    size: [320, 180],
    lines: [],
    duration: 3,
    loaders: {
      svg: (name) => readFileSync(join(ART, `${name}.svg`), 'utf8'),
      font: () => {
        throw new Error('no font in this scene');
      },
    },
  });

/** Reads a golden file. Run with UPDATE_GOLDEN=1 to rewrite it from the value under test. */
export function golden(name: string, actual: unknown): unknown {
  const file = join(__dirname, '__golden__', `${name}.json`);
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}

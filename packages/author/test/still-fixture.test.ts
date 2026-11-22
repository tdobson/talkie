import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileScene, emitLottie, scene } from '../src/index';

// The video-feedback app draws server stills of Talkie films with the player's engine. Its
// Chromium test (apps/video-feedback/lib/media/frame-source-talkie.chromium.test.ts) puts a scene
// with gradients and clip paths into a small film and compares the still with the drawing. The app
// cannot build scenes itself, so the scene is kept there as a built file. This keeps that file the
// same as what the author package makes from the drawing today. UPDATE_GOLDEN=1 rewrites it.
const REPO = join(__dirname, '..', '..', '..');
const SVG = join(REPO, 'e2e', 'fixtures', 'paint-clip.svg');
const BUILT = join(REPO, 'apps', 'video-feedback', 'test', 'fixtures', 'talkie-paint-clip.json');

it('the video-feedback still fixture is the gradient and clip drawing as built now', () => {
  const svg = readFileSync(SVG, 'utf8');
  const model = compileScene(
    scene('s01', (ctx) => ctx.add(ctx.art('paint-clip', { at: [0, 0] }))),
    {
      size: [320, 180],
      lines: [],
      // The scene it stands in for, s01 of the talkie-mini fixture, runs from 0 s to 2 s.
      duration: 2,
      loaders: {
        svg: () => svg,
        font: () => {
          throw new Error('no font in this scene');
        },
      },
    }
  );
  const built = `${JSON.stringify(emitLottie(model))}\n`;
  if (process.env.UPDATE_GOLDEN === '1') {
    writeFileSync(BUILT, built);
  }
  expect(readFileSync(BUILT, 'utf8')).toBe(built);
});

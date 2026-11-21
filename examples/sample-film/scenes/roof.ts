import { scene } from '@talkie/author';

const SKY = '#eaf3f6';
const RAFTER_X = [300, 500, 700, 900];
const BATTEN_Y = [420, 290, 160];

export default scene('roof', (c) => {
  // The bottom of the stage is kept clear for captions, so the picture stops at y 540.
  const sky = c.rect(0, 0, 1280, 540, { fill: SKY }, 'sky');

  // art() places a drawing by its top left corner. group() keeps the four rafters together.
  const rafters = c.group(
    'rafters',
    RAFTER_X.map((x) => c.art('roof/rafter', { at: [x, 40], scale: 0.95 }))
  );
  const raftersName = c.label('Rafters', { at: [1030, 500], size: 30 });

  const battens = BATTEN_Y.map((y) => c.art('batten', { at: [240, y] }));
  const battensName = c.label('Battens', { at: [1030, 190], size: 30 });

  const tile = c.art('tile', { at: [525, 290] });

  c.add(sky, rafters, raftersName, ...battens, battensName, tile);

  // The rafters are there from the first frame, which is also the poster.
  c.fade(raftersName, c.T('roof-a', 0.6));

  battens.forEach((batten, i) => c.rise(batten, c.T('roof-b', i * 0.25)));
  c.fade(battensName, c.T('roof-b', 0.9));
  c.pop(tile, c.T('roof-b', 1.6));

  // A slow push in, centred on the tile.
  c.camera(c.T('roof-a'), { dur: 3, scaleTo: 104, origin: [600, 300] });
});

import { scene } from '@talkie/author';

export default scene('one', (c) => {
  const tile = c.art('tile', { at: [40, 30], scale: 2 });
  const name = c.label('Tile', { at: [40, 170], size: 20 });
  c.add(tile, name);
  c.fade(tile, c.T('one-a'));
  c.fade(name, c.T('one-b'));
});

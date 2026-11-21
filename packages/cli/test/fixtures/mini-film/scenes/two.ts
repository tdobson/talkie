import { scene } from '@talkie/author';

export default scene('two', (c) => {
  const dot = c.art('marks/dot', { at: [120, 50] });
  c.add(dot);
  c.fade(dot, c.T('two-a'));
});

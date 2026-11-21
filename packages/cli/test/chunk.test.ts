import { chunkCaption } from '../src/captions/chunk';

// Expected values are the output of chunkCaption in ~/dev/md-roofkit-films/tools/lib/plan.mjs,
// run in node on these inputs.
const cases: Array<[string, string[]]> = [
  ['Short caption.', ['Short caption.']],
  ['  Spaces   are\n collapsed.  ', ['Spaces are collapsed.']],
  [
    'The batten gauge is set from the tile, and the first course sits lower so the tails line up with the gutter before anything is fixed.',
    [
      'The batten gauge is set from the tile, and the first course sits lower',
      'so the tails line up with the gutter before anything is fixed.',
    ],
  ],
  [
    'Fix every tile. Check the gauge twice before you nail, because a batten set 5 mm out throws the whole slope by the ridge.',
    [
      'Fix every tile. Check the gauge twice before you nail,',
      'because a batten set 5 mm out throws the whole slope by the ridge.',
    ],
  ],
  [
    'Set the gauge to between 320 and 345 millimetres for this tile, then mark both ends of the roof and strike a line across.',
    [
      'Set the gauge to between 320 and 345 millimetres for this tile, then mark both ends of the roof',
      'and strike a line across.',
    ],
  ],
  ['The pitch here is 35 degrees. So it works.', ['The pitch here is 35 degrees. So it works.']],
  [
    'Laps of a hundred and fifty millimetres are the minimum on a slope this shallow, which is why the underlay goes on first and is checked before the battens.',
    [
      'Laps of a hundred and fifty millimetres are the minimum on a slope this shallow,',
      'which is why the underlay goes on first and is checked before the battens.',
    ],
  ],
  [
    'Measure 1,200 by 2,400 mm sheets carefully; cut once: then lay them from the eaves upward while the membrane is still dry and tight.',
    [
      'Measure 1,200 by 2,400 mm sheets carefully; cut once: then lay them from the eaves upward',
      'while the membrane is still dry and tight.',
    ],
  ],
  ['No.', ['No.']],
];

test.each(cases)('chunkCaption(%j)', (text, expected) => {
  expect(chunkCaption(text)).toEqual(expected);
});

test('chunks never contain the private glue character', () => {
  for (const [text] of cases) {
    expect(chunkCaption(text).join(' ')).not.toContain('\uE000');
  }
});

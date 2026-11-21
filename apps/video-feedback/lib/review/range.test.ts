import { parseRange } from './range';

it.each([
  ['bytes=0-99', 1000, { start: 0, end: 99 }],
  ['bytes=900-', 1000, { start: 900, end: 999 }],
  ['bytes=-100', 1000, { start: 900, end: 999 }],
  ['bytes=2000-', 1000, 'invalid'],
  [null, 1000, null],
  // The end is clamped to the last byte.
  ['bytes=0-5000', 1000, { start: 0, end: 999 }],
  ['bytes=999-999', 1000, { start: 999, end: 999 }],
  ['bytes=1000-1000', 1000, 'invalid'],
  // A suffix longer than the file means the whole file.
  ['bytes=-5000', 1000, { start: 0, end: 999 }],
  ['bytes=-0', 1000, 'invalid'],
  ['bytes=0-', 0, 'invalid'],
  // Anything that is not a single well-formed byte range is ignored, as if no header was sent.
  ['bytes=5-2', 1000, null],
  ['bytes=0-1,5-6', 1000, null],
  ['items=0-1', 1000, null],
  ['bytes=abc', 1000, null],
  ['bytes=-', 1000, null],
  ['', 1000, null],
] as const)('parseRange(%s)', (h, size, out) => {
  expect(parseRange(h, size)).toEqual(out);
});

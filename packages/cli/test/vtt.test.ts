import { buildVtt, formatVttTime } from '../src/captions/vtt';

test('formatVttTime writes hh:mm:ss.mmm', () => {
  expect(formatVttTime(0)).toBe('00:00:00.000');
  expect(formatVttTime(1.2346)).toBe('00:00:01.235');
  expect(formatVttTime(59.9996)).toBe('00:01:00.000');
  expect(formatVttTime(3725.04)).toBe('01:02:05.040');
});

test('buildVtt chunks long lines by character share and holds the last chunk to captionEnd', () => {
  const long =
    'The batten gauge is set from the tile, and the first course sits lower so the tails line up with the gutter before anything is fixed.';
  // the chunks are 70 and 62 characters, so the first takes 70/132 of the 6.6 s voice span
  const vtt = buildVtt([
    { start: 0.8, voiceEnd: 2.1, captionEnd: 3.8, text: 'Short caption.' },
    { start: 4.2, voiceEnd: 10.8, captionEnd: 12, text: long },
    {
      start: 62.5,
      voiceEnd: 64,
      captionEnd: 65.5,
      text: 'three hundred and twenty',
      caption: '320 mm <gauge> & lap',
    },
  ]);
  expect(vtt).toBe(
    [
      'WEBVTT',
      '',
      '00:00:00.800 --> 00:00:03.800',
      'Short caption.',
      '',
      '00:00:04.200 --> 00:00:07.700',
      'The batten gauge is set from the tile, and the first course sits lower',
      '',
      '00:00:07.700 --> 00:00:12.000',
      'so the tails line up with the gutter before anything is fixed.',
      '',
      '00:01:02.500 --> 00:01:05.500',
      '320 mm &lt;gauge&gt; &amp; lap',
      '',
    ].join('\n')
  );
});

test('buildVtt with no lines is just the header', () => {
  expect(buildVtt([])).toBe('WEBVTT\n');
});

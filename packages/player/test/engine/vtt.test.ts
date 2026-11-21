import { cueAt, parseVtt } from '../../src/engine/vtt';

const sample = [
  'WEBVTT - narration',
  '',
  'NOTE',
  'a comment that',
  'spans lines',
  '',
  'STYLE',
  '::cue { color: white }',
  '',
  '00:01.000 --> 00:03.500',
  'Fix the first batten',
  'on the reference line.',
  '',
  'intro',
  '01:02:03.250 --> 01:02:05.000 align:start line:0',
  'Then the next one.',
  '',
  'not a cue at all',
  '',
].join('\r\n');

describe('parseVtt', () => {
  test('reads mm:ss.mmm and hh:mm:ss.mmm cues with multi-line text', () => {
    expect(parseVtt(sample)).toEqual([
      { start: 1, end: 3.5, text: 'Fix the first batten\non the reference line.' },
      { start: 3723.25, end: 3725, text: 'Then the next one.' },
    ]);
  });

  test('gives no cues for empty or header-only input', () => {
    expect(parseVtt('')).toEqual([]);
    expect(parseVtt('﻿WEBVTT\n')).toEqual([]);
  });

  test('sorts cues by start time', () => {
    const cues = parseVtt('WEBVTT\n\n00:05.000 --> 00:06.000\nb\n\n00:01.000 --> 00:02.000\na\n');
    expect(cues.map((c) => c.text)).toEqual(['a', 'b']);
  });
});

describe('cueAt', () => {
  const cues = parseVtt(sample);

  test('finds the cue at a time, start inclusive and end exclusive', () => {
    expect(cueAt(cues, 1)?.text).toMatch(/^Fix/);
    expect(cueAt(cues, 3.49)?.text).toMatch(/^Fix/);
    expect(cueAt(cues, 3.5)).toBeNull();
  });

  test('returns null between and outside cues', () => {
    expect(cueAt(cues, 0)).toBeNull();
    expect(cueAt(cues, 100)).toBeNull();
    expect(cueAt([], 1)).toBeNull();
  });
});

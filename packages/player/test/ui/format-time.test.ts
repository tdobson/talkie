import { formatTime, sliderValueText, spokenTime } from '../../src/ui/format-time';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [59.9, '0:59'],
    [61, '1:01'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [NaN, '0:00'],
    [-3, '0:00'],
  ])('formats %p as %p', (seconds, text) => {
    expect(formatTime(seconds)).toBe(text);
  });
});

describe('spokenTime', () => {
  it.each([
    [0, '0 seconds'],
    [1, '1 second'],
    [65, '1 minute 5 seconds'],
    [120, '2 minutes'],
    [214, '3 minutes 34 seconds'],
    [3600, '1 hour'],
    [3725, '1 hour 2 minutes 5 seconds'],
  ])('says %p as %p', (seconds, text) => {
    expect(spokenTime(seconds)).toBe(text);
  });

  it('builds the slider text', () => {
    expect(sliderValueText(65, 214)).toBe('1 minute 5 seconds of 3 minutes 34 seconds');
  });
});

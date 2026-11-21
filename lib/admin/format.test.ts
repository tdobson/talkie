import { formatBytes, formatWhen, plural } from './format';

it('pluralises counts', () => {
  expect(plural(0, 'comment')).toBe('0 comments');
  expect(plural(1, 'comment')).toBe('1 comment');
  expect(plural(3, 'session')).toBe('3 sessions');
});

it('formats file sizes', () => {
  expect(formatBytes(0)).toBe('0 KB');
  expect(formatBytes(4_096)).toBe('4 KB');
  expect(formatBytes(12_500_000)).toBe('12.5 MB');
  expect(formatBytes(2_340_000_000)).toBe('2.34 GB');
});

it('formats timestamps in UK time, the same on server and browser', () => {
  expect(formatWhen('2026-11-20T14:30:00.000Z')).toBe('20 Nov 2026, 14:30');
  // British Summer Time is one hour ahead of UTC.
  expect(formatWhen('2026-07-01T12:00:00.000Z')).toBe('1 Jul 2026, 13:00');
  expect(formatWhen(null)).toBe('Never');
  expect(formatWhen('nonsense')).toBe('Never');
});

import { mixScene } from '../src/audio/mix';

test('lines land at round(start * rate) and the buffer is round(duration * rate) long', () => {
  const out = mixScene(
    [
      { start: 0.5, samples: Int16Array.from([100, 200, 300]) },
      { start: 1.00001, samples: Int16Array.from([-5, -6]) },
    ],
    2.5,
    1000
  );
  expect(out.length).toBe(2500);
  expect(Array.from(out.subarray(499, 504))).toEqual([0, 100, 200, 300, 0]);
  expect(Array.from(out.subarray(999, 1003))).toEqual([0, -5, -6, 0]);
  expect(out.reduce((n, v) => n + (v === 0 ? 0 : 1), 0)).toBe(5);
});

test('the default rate is 48 kHz', () => {
  const out = mixScene([{ start: 0.25, samples: Int16Array.from([7]) }], 1);
  expect(out.length).toBe(48000);
  expect(out[12000]).toBe(7);
});

test('overlapping lines sum and clip', () => {
  const out = mixScene(
    [
      { start: 0, samples: Int16Array.from([30000, -30000, 10]) },
      { start: 0, samples: Int16Array.from([30000, -30000, 5]) },
    ],
    0.003,
    1000
  );
  expect(Array.from(out)).toEqual([32767, -32768, 15]);
});

test('samples past the end of the scene are dropped', () => {
  const out = mixScene([{ start: 0.002, samples: Int16Array.from([1, 2, 3]) }], 0.003, 1000);
  expect(Array.from(out)).toEqual([0, 0, 1]);
});

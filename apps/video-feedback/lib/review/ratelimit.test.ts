import { allowRequest, resetRateLimits } from './ratelimit';

beforeEach(() => resetRateLimits());

it('allows up to the limit inside the window, then refuses', () => {
  for (let i = 0; i < 3; i++) expect(allowRequest('a', 3, 1000, 100 + i)).toBe(true);
  expect(allowRequest('a', 3, 1000, 200)).toBe(false);
});

it('is a rolling window: old requests stop counting', () => {
  expect(allowRequest('a', 2, 1000, 0)).toBe(true);
  expect(allowRequest('a', 2, 1000, 600)).toBe(true);
  expect(allowRequest('a', 2, 1000, 900)).toBe(false);
  expect(allowRequest('a', 2, 1000, 1000)).toBe(true);
  expect(allowRequest('a', 2, 1000, 1100)).toBe(false);
});

it('refused requests do not extend the block', () => {
  expect(allowRequest('a', 1, 1000, 0)).toBe(true);
  expect(allowRequest('a', 1, 1000, 999)).toBe(false);
  expect(allowRequest('a', 1, 1000, 1000)).toBe(true);
});

it('counts each key separately', () => {
  expect(allowRequest('a', 1, 1000, 0)).toBe(true);
  expect(allowRequest('b', 1, 1000, 0)).toBe(true);
  expect(allowRequest('a', 1, 1000, 1)).toBe(false);
});

it('resetRateLimits clears every key', () => {
  expect(allowRequest('a', 1, 1000, 0)).toBe(true);
  resetRateLimits();
  expect(allowRequest('a', 1, 1000, 1)).toBe(true);
});

it('a limit of zero refuses everything', () => {
  expect(allowRequest('z', 0, 1000, 0)).toBe(false);
  expect(allowRequest('z', 0, 1000, 5000)).toBe(false);
});

it('the periodic sweep drops idle keys but keeps active limits', () => {
  expect(allowRequest('active', 1, 1000, 10_000)).toBe(true);
  for (let i = 0; i < 600; i++) allowRequest(`idle-${i}`, 5, 1000, i);
  // 'active' is still inside its window after the sweep, so it stays blocked.
  expect(allowRequest('active', 1, 1000, 10_500)).toBe(false);
  expect(allowRequest('idle-0', 1, 1000, 10_500)).toBe(true);
});

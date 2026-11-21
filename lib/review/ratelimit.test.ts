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

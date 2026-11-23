import { CommentLimit } from './comment-limit';

const opts = { threshold: 0.1, silenceMs: 30_000, maxMs: 300_000, warnBeforeMs: 60_000 };

/** Feeds a level every 100ms from `from` for `ms`, returning the last answer. */
function feed(l: CommentLimit, level: number, from: number, ms: number) {
  let state = l.update(level, from);
  for (let t = from; t <= from + ms; t += 100) state = l.update(level, t);
  return state;
}

it('ends a comment after 30 s of quiet, not before', () => {
  const l = new CommentLimit(opts, 0);
  expect(feed(l, 0.5, 0, 5000)).toBe('ok');
  expect(feed(l, 0, 5100, 29_800)).toBe('ok');
  expect(l.update(0, 35_100)).toBe('silence');
  // And stays ended, whatever comes next.
  expect(l.update(0.9, 35_200)).toBe('silence');
});

it('a word now and then keeps it open', () => {
  const l = new CommentLimit(opts, 0);
  let state = l.update(0, 0);
  for (let t = 0; t < 200_000; t += 100) state = l.update(t % 20_000 < 500 ? 0.5 : 0, t);
  expect(state).toBe('ok');
});

it('warns in the last minute, then ends at 5 minutes even while talking', () => {
  const l = new CommentLimit(opts, 0);
  expect(feed(l, 0.5, 0, 239_900)).toBe('ok');
  expect(feed(l, 0.5, 240_000, 59_900)).toBe('warn');
  expect(l.update(0.5, 300_000)).toBe('cap');
});

it('a stalled tab does not count its gap as quiet', () => {
  const l = new CommentLimit(opts, 0);
  l.update(0.5, 0);
  // The tab slept for a minute with the last level still speech.
  expect(l.update(0, 60_000)).toBe('ok');
});

import { PracticeListener } from './practice';

/** Feeds the listener a level every 50ms from `from` for `ms`, returning the last answer. */
function feed(l: PracticeListener, level: number, from: number, ms: number): boolean {
  let done = false;
  for (let t = from; t < from + ms; t += 50) done = l.update(level, t);
  return done;
}

describe('PracticeListener', () => {
  it('needs enough speech, then a quiet spell', () => {
    const l = new PracticeListener({ threshold: 0.1, speechMs: 1000, silenceMs: 500 });
    expect(feed(l, 0.3, 0, 600)).toBe(false);
    expect(feed(l, 0, 600, 550)).toBe(false); // quiet, but not enough speech yet
    expect(feed(l, 0.3, 1150, 500)).toBe(false); // about 1100ms of speech in all
    expect(feed(l, 0, 1650, 450)).toBe(false);
    expect(l.update(0, 2150)).toBe(true);
  });

  it('silence alone never counts', () => {
    const l = new PracticeListener({ threshold: 0.1, speechMs: 1000, silenceMs: 500 });
    expect(feed(l, 0, 0, 10_000)).toBe(false);
  });

  it('talking on resets the quiet spell', () => {
    const l = new PracticeListener({ threshold: 0.1, speechMs: 500, silenceMs: 500 });
    feed(l, 0.3, 0, 600);
    expect(feed(l, 0, 600, 400)).toBe(false);
    expect(feed(l, 0.3, 1000, 100)).toBe(false);
    expect(feed(l, 0, 1100, 450)).toBe(false);
    expect(l.update(0, 1600)).toBe(true);
  });

  it('stays done', () => {
    const l = new PracticeListener({ threshold: 0.1, speechMs: 100, silenceMs: 100 });
    feed(l, 0.3, 0, 200);
    feed(l, 0, 200, 200);
    expect(l.update(0.5, 1000)).toBe(true);
  });

  it('a stalled tab does not count its gap as a second of speech', () => {
    const l = new PracticeListener({ threshold: 0.1, speechMs: 1000, silenceMs: 100 });
    l.update(0.3, 0);
    l.update(0.3, 1000);
    expect(feed(l, 0, 1000, 300)).toBe(false);
  });
});

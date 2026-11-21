import { parsePathD, transformPaths } from '../src/path';
import { planLines, readHold } from '../src/timing';

// Expected numbers come from running planScene in md-roofkit-films tools/lib/plan.mjs on the same
// input with lead 1.4, gap 0.7, tail 2.2 (rounded to 3 decimals).
describe('planLines', () => {
  it('holds a short caption for three seconds and a long one for its words', () => {
    const plan = planLines([
      { id: 'l1', text: 'Set the gauge.', voiceSeconds: 1.2 },
      {
        id: 'l2',
        text: 'Measure from the top of one batten to the top of the next.',
        voiceSeconds: 3.9,
      },
    ]);
    expect(plan.lines.map((l) => [l.id, l.start, l.voiceEnd, l.captionEnd])).toEqual([
      ['l1', 1.4, 2.6, 4.4],
      ['l2', 5.1, 9, 10.933],
    ]);
    expect(plan.duration).toBe(13.133);
  });

  it('never ends a caption before its voice, and counts the caption words when one is given', () => {
    const plan = planLines([
      {
        id: 'l1',
        text: 'The gauge is the distance between battens and it must stay the same all the way up the roof slope today.',
        caption: 'Keep the gauge even.',
        voiceSeconds: 7.25,
      },
      { id: 'l2', text: 'Check it twice.', voiceSeconds: 1.05 },
      {
        id: 'l3',
        text: 'Then fix the next course of battens along the chalk line you marked.',
        voiceSeconds: 4.4,
      },
    ]);
    expect(plan.lines.map((l) => [l.id, l.start, l.voiceEnd, l.captionEnd])).toEqual([
      ['l1', 1.4, 8.65, 8.95],
      ['l2', 9.65, 10.7, 12.65],
      ['l3', 13.35, 17.75, 19.183],
    ]);
    expect(plan.lines[0].caption).toBe('Keep the gauge even.');
    expect(plan.lines[1]).not.toHaveProperty('caption');
    expect(plan.duration).toBe(21.383);
  });

  it('takes lead, gap, tail and a minimum duration', () => {
    const plan = planLines([{ id: 'only', text: 'One short line.', voiceSeconds: 1.5 }], {
      lead: 0.5,
      gap: 0.25,
      tail: 1,
      minDuration: 12,
    });
    expect(plan.lines).toEqual([
      { id: 'only', text: 'One short line.', start: 0.5, voiceEnd: 2, captionEnd: 3.5 },
    ]);
    expect(plan.duration).toBe(12);
  });

  it('rejects a duplicate id and a line with no text', () => {
    const line = { id: 'a', text: 'Hello there.', voiceSeconds: 1 };
    expect(() => planLines([line, line])).toThrow('duplicate line id a');
    expect(() => planLines([{ id: 'b', text: '', voiceSeconds: 1 }])).toThrow('needs id and text');
  });

  it('readHold is max(3, words / 3 + 1.5)', () => {
    expect(readHold(2)).toBe(3);
    expect(readHold(12)).toBe(5.5);
  });
});

describe('parsePathD', () => {
  it('reads a square as one closed path with four vertices', () => {
    const paths = parsePathD('M0 0H10V10H0Z');
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    expect(paths[0].v).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(paths[0].i).toEqual(paths[0].v.map(() => [0, 0]));
    expect(paths[0].o).toEqual(paths[0].v.map(() => [0, 0]));
  });

  it('keeps one vertex where a closed path returns to its start', () => {
    const [path] = parsePathD('M0 0L10 0L10 10L0 0Z');
    expect(path.v).toHaveLength(3);
    expect(path.closed).toBe(true);
  });

  it('turns an arc into cubics', () => {
    const [path] = parsePathD('M0 0A10 10 0 0 1 20 0');
    expect(path.closed).toBe(false);
    expect(path.v.length).toBeGreaterThanOrEqual(2);
    expect(path.v[path.v.length - 1][0]).toBeCloseTo(20);
    expect(path.v[path.v.length - 1][1]).toBeCloseTo(0);
    expect(path.o[0]).not.toEqual([0, 0]);
  });

  it('raises a quadratic to a cubic and resolves relative and short commands', () => {
    const [path] = parsePathD('m10 10q30 0 30 30t30 30');
    expect(path.v).toEqual([
      [10, 10],
      [40, 40],
      [70, 70],
    ]);
    expect(path.o[0]).toEqual([20, 0]);
    expect(path.i[1]).toEqual([0, -20]);
    expect(path.o[1]).toEqual([0, 20]);
  });

  it('splits subpaths', () => {
    expect(parsePathD('M0 0L1 1M5 5L6 6Z')).toHaveLength(2);
  });

  it('throws on data it cannot read', () => {
    expect(() => parsePathD('M0 0 L banana')).toThrow('cannot read path data');
  });
});

describe('transformPaths', () => {
  it('shifts vertices only under a translate', () => {
    const [before] = parsePathD('M0 0C5 0 10 5 10 10');
    const [after] = transformPaths([before], [1, 0, 0, 1, 100, 50]);
    expect(after.v).toEqual([
      [100, 50],
      [110, 60],
    ]);
    expect(after.o).toEqual(before.o);
    expect(after.i).toEqual(before.i);
  });

  it('scales vertices and tangents', () => {
    const [after] = transformPaths(parsePathD('M1 1C2 1 3 2 3 3'), [2, 0, 0, 3, 0, 0]);
    expect(after.v).toEqual([
      [2, 3],
      [6, 9],
    ]);
    expect(after.o[0]).toEqual([2, 0]);
    expect(after.i[1]).toEqual([0, -3]);
  });
});

import { rmsLevel, SpeechGate } from './micLevel';

describe('rmsLevel', () => {
  it('is 0 for silence and for an empty buffer', () => {
    expect(rmsLevel(new Float32Array(128))).toBe(0);
    expect(rmsLevel(new Float32Array(0))).toBe(0);
  });
  it('is the root mean square of the samples', () => {
    expect(rmsLevel(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rmsLevel(new Float32Array([1, 0, 0, 0]))).toBeCloseTo(0.5);
  });
  it('is clamped to 1', () => {
    expect(rmsLevel(new Float32Array([2, -2]))).toBe(1);
  });
});

describe('SpeechGate', () => {
  it('SpeechGate needs the level held for holdMs', () => {
    const g = new SpeechGate(0.1, 300);
    expect(g.update(0.2, 0)).toBe(false);
    expect(g.update(0.2, 200)).toBe(false);
    expect(g.update(0.2, 310)).toBe(true);
    const g2 = new SpeechGate(0.1, 300);
    g2.update(0.2, 0);
    g2.update(0.01, 100);
    expect(g2.update(0.2, 350)).toBe(false);
  });
  it('stays open once speech has been heard, until reset', () => {
    const g = new SpeechGate(0.1, 300);
    g.update(0.2, 0);
    expect(g.update(0.2, 300)).toBe(true);
    expect(g.update(0, 400)).toBe(true);
    g.reset();
    expect(g.update(0.2, 500)).toBe(false);
  });
});

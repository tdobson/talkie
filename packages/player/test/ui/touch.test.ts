import { classifyTap } from '../../src/ui/touch';

const width = 900;

describe('classifyTap', () => {
  it('treats a first tap as a controls toggle', () => {
    expect(classifyTap(null, { time: 1000, x: 100 }, width)).toBe('toggle-controls');
  });

  it('treats a quick second tap on the left third as skip back', () => {
    expect(classifyTap({ time: 1000, x: 100 }, { time: 1200, x: 120 }, width)).toBe('skip-back');
  });

  it('treats a quick second tap on the right third as skip forward', () => {
    expect(classifyTap({ time: 1000, x: 800 }, { time: 1250, x: 780 }, width)).toBe(
      'skip-forward'
    );
  });

  it('does not skip in the middle third', () => {
    expect(classifyTap({ time: 1000, x: 450 }, { time: 1100, x: 450 }, width)).toBe(
      'toggle-controls'
    );
  });

  it('does not skip when the taps are slow or on different sides', () => {
    expect(classifyTap({ time: 1000, x: 100 }, { time: 1400, x: 100 }, width)).toBe(
      'toggle-controls'
    );
    expect(classifyTap({ time: 1000, x: 100 }, { time: 1100, x: 800 }, width)).toBe(
      'toggle-controls'
    );
  });
});

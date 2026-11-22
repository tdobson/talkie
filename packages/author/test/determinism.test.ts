import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emitLottie, importSvg, svgAt } from '../src/index';
import { everything, gauge, shaded } from './scenes';

describe('determinism', () => {
  it.each([
    ['gauge', gauge],
    ['everything', everything],
    ['shaded', shaded],
  ])('compiling and emitting %s twice gives identical output', (_name, compile) => {
    expect(JSON.stringify(compile())).toBe(JSON.stringify(compile()));
    expect(JSON.stringify(emitLottie(compile()))).toBe(JSON.stringify(emitLottie(compile())));
    expect(svgAt(compile(), 2.5)).toBe(svgAt(compile(), 2.5));
  });

  it('importing the same drawing twice gives the same bytes', () => {
    const svg = readFileSync(join(__dirname, 'fixtures', 'art', 'shaded.svg'), 'utf8');
    expect(JSON.stringify(importSvg(svg, 'shaded'))).toBe(JSON.stringify(importSvg(svg, 'shaded')));
  });

  it('emitting does not change the model', () => {
    for (const model of [everything(), shaded()]) {
      const before = JSON.stringify(model);
      emitLottie(model);
      svgAt(model, 1);
      expect(JSON.stringify(model)).toBe(before);
    }
  });
});

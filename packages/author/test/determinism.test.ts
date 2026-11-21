import { emitLottie, svgAt } from '../src/index';
import { everything, gauge } from './scenes';

describe('determinism', () => {
  it.each([
    ['gauge', gauge],
    ['everything', everything],
  ])('compiling and emitting %s twice gives identical output', (_name, compile) => {
    expect(JSON.stringify(compile())).toBe(JSON.stringify(compile()));
    expect(JSON.stringify(emitLottie(compile()))).toBe(JSON.stringify(emitLottie(compile())));
    expect(svgAt(compile(), 2.5)).toBe(svgAt(compile(), 2.5));
  });

  it('emitting does not change the model', () => {
    const model = everything();
    const before = JSON.stringify(model);
    emitLottie(model);
    svgAt(model, 1);
    expect(JSON.stringify(model)).toBe(before);
  });
});

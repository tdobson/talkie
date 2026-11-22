import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { emitLottie } from '../src/index';
import { everything, gauge, shaded } from './scenes';

// The Lottie 1.0.1 schema from https://lottie.github.io/lottie-spec/1.0.1/lottie.schema.json.
// It nests its definitions two levels deep and carries a "$version" keyword, so ajv runs unstrict.
const schema = JSON.parse(readFileSync(join(__dirname, 'lottie-1.0.1.schema.json'), 'utf8'));
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const errors = (json: unknown) => (check(JSON.parse(JSON.stringify(json))) ? [] : check.errors);

describe('Lottie 1.0.1 schema', () => {
  it('is the 1.0.1 schema in draft 2020-12', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.$id).toBe('https://lottie.github.io/lottie-spec/1.0.1/specs/schema/');
  });

  it('accepts the gauge scene', () => expect(errors(emitLottie(gauge()))).toEqual([]));

  it('accepts a scene that uses every helper', () =>
    expect(errors(emitLottie(everything()))).toEqual([]));

  it('accepts a scene with gradients, clips and precomps', () =>
    expect(errors(emitLottie(shaded()))).toEqual([]));

  it('rejects a broken animation, so the check has teeth', () => {
    const broken = JSON.parse(JSON.stringify(emitLottie(gauge())));
    broken.layers[1].shapes[0].it[0].ks = { a: 0, k: 'not a bezier' };
    expect(errors(broken)).not.toEqual([]);
    const noSize = JSON.parse(JSON.stringify(emitLottie(gauge())));
    delete noSize.w;
    expect(errors(noSize)).not.toEqual([]);
  });
});

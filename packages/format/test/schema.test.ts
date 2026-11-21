import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { validateFilm } from '../src/validate';

const fixtures = join(__dirname, 'fixtures');
const read = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
const schema = JSON.parse(readFileSync(join(__dirname, '..', 'talkie.schema.json'), 'utf8'));
const check = new Ajv2020({ allErrors: true }).compile(schema);

/** Fixtures that break a cross-field rule only. The schema describes shape, so it accepts them. */
const CROSS_FIELD = ['bad-gap.json', 'bad-no-aac.json'];
const badFixtures = readdirSync(fixtures)
  .filter((name) => /^bad-.*\.json$/.test(name))
  .sort();
const shapeFixtures = badFixtures.filter((name) => !CROSS_FIELD.includes(name));

it('is a draft 2020-12 schema', () =>
  expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema'));

it('accepts the valid film', () => {
  expect(check(read('valid.json'))).toBe(true);
  expect(validateFilm(read('valid.json')).ok).toBe(true);
});

it('has shape fixtures and cross-field fixtures to check', () => {
  expect(shapeFixtures.length).toBeGreaterThanOrEqual(5);
  expect(badFixtures).toEqual(expect.arrayContaining(CROSS_FIELD));
});

it.each(shapeFixtures)('rejects %s, as the validator does', (name) => {
  expect(check(read(name))).toBe(false);
  expect(validateFilm(read(name)).ok).toBe(false);
});

it.each(CROSS_FIELD)('accepts the shape of %s, which only the validator rejects', (name) => {
  expect(check(read(name))).toBe(true);
  expect(validateFilm(read(name)).ok).toBe(false);
});

it('ignores unknown keys, as the validator does', () => {
  const film = { ...read('valid.json'), futureThing: 1 };
  film.scenes[0].note = 'x';
  expect(check(film)).toBe(true);
  expect(validateFilm(film).ok).toBe(true);
});

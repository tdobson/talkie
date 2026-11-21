import { isUuid, newToken, newVideoId } from './ids';
import { ID_RE } from './paths';

it('newToken is 43 url-safe chars', () => expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/));

it('newToken is different every time', () => {
  expect(new Set(Array.from({ length: 50 }, newToken)).size).toBe(50);
});

it('newVideoId is the title slug plus a 4 character suffix', () => {
  expect(newVideoId('Mavala launch')).toMatch(/^mavala-launch-[a-z0-9]{4}$/);
  expect(newVideoId('Mavala launch')).not.toBe(newVideoId('Mavala launch'));
});

it('newVideoId always yields a safe id', () => {
  for (const title of ['', '../../etc/passwd', 'É', 'x'.repeat(500), '  ', 'a']) {
    expect(newVideoId(title)).toMatch(ID_RE);
  }
});

it('isUuid accepts lowercase UUIDs only', () => {
  expect(isUuid(crypto.randomUUID())).toBe(true);
  expect(isUuid('3f2b8c1e-7a4d-4e9b-8c1f-0a1b2c3d4e5f')).toBe(true);
  for (const bad of [
    '',
    'not-a-uuid',
    '3F2B8C1E-7A4D-4E9B-8C1F-0A1B2C3D4E5F',
    '3f2b8c1e7a4d4e9b8c1f0a1b2c3d4e5f',
    '3f2b8c1e-7a4d-4e9b-8c1f-0a1b2c3d4e5f\n',
  ]) {
    expect(isUuid(bad)).toBe(false);
  }
});

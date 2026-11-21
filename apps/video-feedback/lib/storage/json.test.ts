import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTmpData } from '@/test/helpers/tmpData';
import { readJson, writeJsonAtomic } from './json';

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
});
afterEach(() => cleanup());

it('writeJsonAtomic never leaves a partial file', async () => {
  await writeJsonAtomic(join(dir, 'a/b.json'), { x: 1 });
  expect(await readJson(join(dir, 'a/b.json'))).toEqual({ x: 1 });
  expect((await readdir(join(dir, 'a'))).filter((f) => f.includes('.tmp'))).toEqual([]);
});

it('readJson returns null for a missing file or directory', async () => {
  expect(await readJson(join(dir, 'nope.json'))).toBeNull();
  expect(await readJson(join(dir, 'no/such/dir/x.json'))).toBeNull();
});

it('readJson throws on corrupt JSON rather than hiding it', async () => {
  await writeFile(join(dir, 'bad.json'), '{"x":');
  await expect(readJson(join(dir, 'bad.json'))).rejects.toThrow();
});

it('overwrites an existing file and survives concurrent writers', async () => {
  const p = join(dir, 'c.json');
  await writeJsonAtomic(p, { n: 0 });
  await Promise.all(Array.from({ length: 20 }, (_, n) => writeJsonAtomic(p, { n: n + 1 })));
  const got = await readJson<{ n: number }>(p);
  expect(got?.n).toBeGreaterThan(0);
  expect((await readdir(dir)).filter((f) => f.includes('.tmp'))).toEqual([]);
});

it('cleans up the tmp file when the rename fails', async () => {
  await mkdir(join(dir, 'd/target.json'), { recursive: true });
  await writeFile(join(dir, 'd/target.json/keep'), 'x'); // non-empty dir: rename must fail
  await expect(writeJsonAtomic(join(dir, 'd/target.json'), { x: 1 })).rejects.toThrow();
  expect((await readdir(join(dir, 'd'))).filter((f) => f.includes('.tmp'))).toEqual([]);
});

it('readJson rethrows errors other than missing file (e.g. EISDIR)', async () => {
  await mkdir(join(dir, 'isdir.json'));
  await expect(readJson(join(dir, 'isdir.json'))).rejects.toThrow();
});

it('writeJsonAtomic cleans up its tmp file when the rename fails', async () => {
  const target = join(dir, 'target.json');
  await mkdir(join(target, 'child'), { recursive: true });
  await expect(writeJsonAtomic(target, { x: 1 })).rejects.toThrow();
  expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
});

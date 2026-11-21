import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaptureEvent } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { missingChunks, putChunk, storedBytes } from './chunks';

let d: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  const tmp = await withTmpData();
  d = join(tmp.dir, 'comment');
  cleanup = tmp.cleanup;
});
afterEach(() => cleanup());

const ev: CaptureEvent[] = [{ t: 5, type: 'seek', from: 1, to: 2, via: 'key' }];

it('putChunk is idempotent', async () => {
  expect(await putChunk(d, 0, Buffer.from('a'), [])).toBe('stored');
  expect(await putChunk(d, 0, Buffer.from('DIFFERENT'), [])).toBe('duplicate');
  expect(await readFile(join(d, 'chunks/0.bin'), 'utf8')).toBe('a');
});

it('missingChunks lists gaps', async () => {
  await putChunk(d, 0, Buffer.from('a'), []);
  await putChunk(d, 2, Buffer.from('c'), []);
  expect(await missingChunks(d, 4)).toEqual([1, 3]);
});

it('missingChunks on an empty comment lists everything', async () => {
  expect(await missingChunks(d, 3)).toEqual([0, 1, 2]);
  expect(await missingChunks(d, 0)).toEqual([]);
});

it('stores the events beside the audio and keeps the first copy', async () => {
  await putChunk(d, 1, Buffer.from('a'), ev);
  await putChunk(d, 1, Buffer.from('b'), []);
  expect(JSON.parse(await readFile(join(d, 'events/1.json'), 'utf8'))).toEqual(ev);
});

it('concurrent duplicates store exactly once and leave no tmp files', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => putChunk(d, 0, Buffer.from(`body-${i}`), ev))
  );
  expect(results.filter((r) => r === 'stored')).toHaveLength(1);
  expect(await readFile(join(d, 'chunks/0.bin'), 'utf8')).toMatch(/^body-\d$/);
  expect(await readdir(join(d, 'chunks'))).toEqual(['0.bin']);
  expect(await readdir(join(d, 'events'))).toEqual(['0.json']);
});

it('storedBytes sums the audio chunks', async () => {
  expect(await storedBytes(d)).toBe(0);
  await putChunk(d, 0, Buffer.from('abc'), ev);
  await putChunk(d, 1, Buffer.alloc(10), []);
  await putChunk(d, 1, Buffer.alloc(99), []);
  expect(await storedBytes(d)).toBe(13);
});

it('rejects a bad seq', async () => {
  for (const bad of [-1, 1.5, Number.NaN, '../1' as unknown as number]) {
    await expect(putChunk(d, bad, Buffer.from('a'), [])).rejects.toThrow();
  }
});

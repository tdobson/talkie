import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withTmpData } from '@/test/helpers/tmpData';
import { initialStatus, readStatus, updateStatus } from './status';
import { seedComment } from './testutil';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
});
afterEach(() => cleanup());

it('initialStatus is receiving with every step pending', () => {
  expect(initialStatus()).toMatchObject({
    state: 'receiving',
    steps: {
      audio: 'pending',
      silence: 'pending',
      transcribe: 'pending',
      moments: 'pending',
      stills: 'pending',
      clip: 'pending',
    },
    error: null,
    attempts: 0,
  });
});

it('readStatus returns null when there is no status file', async () => {
  const { ref } = await seedComment();
  const missing = { ...ref, commentId: '00000000-0000-4000-8000-000000000000' };
  expect(await readStatus(missing)).toBeNull();
});

it('updateStatus merges steps and keeps the rest', async () => {
  const { ref, dir } = await seedComment();
  await updateStatus(ref, { state: 'processing', steps: { audio: 'done' } });
  const s = await updateStatus(ref, { steps: { silence: 'done' }, error: 'boom' });
  expect(s).toMatchObject({
    state: 'processing',
    error: 'boom',
    steps: { audio: 'done', silence: 'done', transcribe: 'pending' },
  });
  expect(JSON.parse(await readFile(join(dir, 'status.json'), 'utf8'))).toEqual(s);
  expect(await readStatus(ref)).toEqual(s);
});

it('does not lose concurrent updates', async () => {
  const { ref } = await seedComment();
  await Promise.all([
    updateStatus(ref, { steps: { audio: 'done' } }),
    updateStatus(ref, { steps: { silence: 'done' } }),
    updateStatus(ref, { steps: { transcribe: 'failed' } }),
  ]);
  expect((await readStatus(ref))?.steps).toMatchObject({
    audio: 'done',
    silence: 'done',
    transcribe: 'failed',
  });
});

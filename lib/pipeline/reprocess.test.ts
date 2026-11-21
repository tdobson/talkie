import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommentRef, StepName, StepState } from '@/lib/types';
import { withTmpData } from '@/test/helpers/tmpData';
import { prepareReprocess } from './reprocess';
import { readStatus, updateStatus } from './status';
import { seedComment, seedVideo } from './testutil';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
});
afterEach(() => cleanup());

const DERIVED = [
  'audio.webm',
  'audio16k.wav',
  'events.json',
  'transcript.json',
  'moments.json',
  'render/moment-01.jpg',
  'render/moment-01-zoom.jpg',
  'render/overview.jpg',
  'render/clip.mp4',
];

async function fill(dir: string): Promise<void> {
  await mkdir(join(dir, 'render'), { recursive: true });
  for (const name of DERIVED) await writeFile(join(dir, name), 'x');
}

const present = (dir: string) => DERIVED.filter((name) => existsSync(join(dir, name)));

async function finished(
  ref: CommentRef,
  state: 'done' | 'failed' | 'empty',
  over: Partial<Record<StepName, StepState>> = {}
): Promise<void> {
  await updateStatus(ref, {
    state,
    error: state === 'failed' ? 'boom' : null,
    attempts: 1,
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'done',
      moments: 'done',
      stills: 'done',
      clip: 'done',
      ...over,
    },
  });
}

it('by default retries only failed comments, from transcribe', async () => {
  const video = await seedVideo();
  const failed = await seedComment({ video });
  await finished(failed.ref, 'failed', { transcribe: 'failed' });
  await fill(failed.dir);
  const done = await seedComment({ video });
  await finished(done.ref, 'done');
  await fill(done.dir);

  const jobs = await prepareReprocess(video.videoId);
  expect(jobs).toEqual([{ ref: failed.ref, fromStep: 'transcribe' }]);

  // Raw captures and the assembled audio stay; everything from transcribe on is cleared.
  expect(present(failed.dir)).toEqual(['audio.webm', 'audio16k.wav', 'events.json']);
  expect(present(done.dir)).toEqual(DERIVED);
  expect(await readStatus(failed.ref)).toMatchObject({
    state: 'queued',
    error: null,
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'pending',
      moments: 'pending',
      stills: 'pending',
      clip: 'pending',
    },
  });
  expect((await readStatus(done.ref))?.state).toBe('done');
});

it('starts earlier when an earlier step is the one that failed', async () => {
  const { ref, video } = await seedComment();
  await finished(ref, 'failed', { audio: 'failed', silence: 'skipped', transcribe: 'skipped' });
  expect(await prepareReprocess(video.videoId)).toEqual([{ ref, fromStep: 'audio' }]);
});

it('an explicit step applies to every finished comment and clears only later outputs', async () => {
  const video = await seedVideo();
  const done = await seedComment({ video });
  await finished(done.ref, 'done');
  await fill(done.dir);
  const receiving = await seedComment({ video, state: 'receiving' });
  const empty = await seedComment({ video });
  await finished(empty.ref, 'empty', {
    transcribe: 'skipped',
    moments: 'skipped',
    stills: 'skipped',
    clip: 'skipped',
  });

  const jobs = await prepareReprocess(video.videoId, { fromStep: 'stills' });
  expect(jobs.map((j) => j.ref.commentId)).toEqual([done.ref.commentId]);
  expect(present(done.dir)).toEqual([
    'audio.webm',
    'audio16k.wav',
    'events.json',
    'transcript.json',
    'moments.json',
  ]);
  expect(await readStatus(done.ref)).toMatchObject({
    state: 'queued',
    steps: { moments: 'done', stills: 'pending', clip: 'pending' },
  });
  expect((await readStatus(receiving.ref))?.state).toBe('receiving');
  // A silent comment has nothing to render: only a rerun from the start can change that.
  expect((await readStatus(empty.ref))?.state).toBe('empty');

  const again = await prepareReprocess(video.videoId, { fromStep: 'audio' });
  expect(again.map((j) => j.ref.commentId).sort()).toEqual(
    [done.ref.commentId, empty.ref.commentId].sort()
  );
  expect(again.every((j) => j.fromStep === 'audio')).toBe(true);
});

it('picks one comment by id whatever its state', async () => {
  const video = await seedVideo();
  const a = await seedComment({ video });
  await finished(a.ref, 'done');
  const b = await seedComment({ video });
  await finished(b.ref, 'done');

  expect(await prepareReprocess(video.videoId, { commentId: a.ref.commentId })).toEqual([
    { ref: a.ref, fromStep: 'transcribe' },
  ]);
  expect((await readStatus(b.ref))?.state).toBe('done');
  expect(await prepareReprocess(video.videoId, { commentId: 'not-a-uuid' })).toEqual([]);
});

it('filters by version', async () => {
  const video = await seedVideo();
  const v1 = await seedComment({ video });
  await finished(v1.ref, 'failed', { stills: 'failed' });
  const v2 = await seedComment({ video, meta: { version: 2 } });
  await finished(v2.ref, 'failed', { stills: 'failed' });

  const jobs = await prepareReprocess(video.videoId, { version: 2 });
  expect(jobs).toEqual([{ ref: v2.ref, fromStep: 'transcribe' }]);
});

it('leaves out comments the caller says are busy', async () => {
  const { ref, video } = await seedComment();
  await finished(ref, 'failed', { transcribe: 'failed' });
  expect(await prepareReprocess(video.videoId, {}, () => true)).toEqual([]);
  expect((await readStatus(ref))?.state).toBe('failed');
});

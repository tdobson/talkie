import { resetConfigForTests } from '@/lib/config';
import { withTmpData } from '@/test/helpers/tmpData';
import type { CommentRef } from '@/lib/types';
import { waitForLock } from './leader';
import { readPipelineStatus, isWorkingOn } from './pipeline-status';
import { getQueue } from './queue';
import { readStatus, updateStatus } from './status';
import { type StepFn, steps } from './steps';
import { PROBE, seedComment } from './testutil';
import { checkForStalls, pickUpWork, publishStatus, STALL_GRACE_MS } from './worker';

const original = { ...steps };
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  process.env.TRANSCRIBER = 'fake';
  resetConfigForTests();
  await waitForLock();
  for (const name of ['audio', 'silence', 'transcribe', 'moments', 'stills', 'clip'] as const) {
    steps[name] = vi.fn<StepFn>(async () => {});
  }
});
afterEach(async () => {
  Object.assign(steps, original);
  delete process.env.TRANSCRIBER;
  resetConfigForTests();
  await cleanup();
});

it('finds queued comments on disk and works through them, clip after', async () => {
  const { ref } = await seedComment();
  await updateStatus(ref, { state: 'queued' });
  await pickUpWork();
  await getQueue().idle();
  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    steps: { stills: 'done', clip: 'done' },
  });
});

it('a comment never waits behind a slow clip', async () => {
  let release: () => void = () => {};
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  steps.clip = vi.fn<StepFn>(() => blocked);
  const first = await seedComment();
  await updateStatus(first.ref, {
    state: 'done',
    steps: { audio: 'done', silence: 'done', transcribe: 'done', moments: 'done', stills: 'done' },
  });
  getQueue().enqueue({ ...first.ref, clip: true } as CommentRef);
  await new Promise((r) => setTimeout(r, 20));

  const second = await seedComment();
  await updateStatus(second.ref, { state: 'queued' });
  await pickUpWork();
  // The clip is still rendering; the new comment is done anyway.
  await getQueue().comments.idle();
  expect((await readStatus(second.ref))?.state).toBe('done');
  expect(getQueue().clips.running()?.job.commentId).toBe(first.ref.commentId);

  // The server can see what is being worked on.
  await publishStatus();
  const status = await readPipelineStatus();
  expect(status?.clips.running?.commentId).toBe(first.ref.commentId);
  expect(isWorkingOn(status, first.ref.commentId)).toBe(true);
  expect(isWorkingOn(status, second.ref.commentId)).toBe(false);
  release();
  await getQueue().idle();
});

it('gives up on a clip after two attempts instead of retrying for ever', async () => {
  steps.clip = vi.fn<StepFn>(async () => {
    throw new Error('ffmpeg failed');
  });
  const { ref } = await seedComment();
  for (let i = 0; i < 4; i++) {
    // As after each restart: the clip is still pending, so it is picked up again.
    await updateStatus(ref, { state: 'done', steps: { stills: 'done', clip: 'pending' } });
    await pickUpWork();
    await getQueue().idle();
  }
  expect(steps.clip).toHaveBeenCalledTimes(2);
  expect((await readStatus(ref))?.steps.clip).toBe('failed');
});

it('marks a job stalled once it has run longer than its film plus 30 minutes', async () => {
  let release: () => void = () => {};
  steps.transcribe = vi.fn<StepFn>(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  const { ref } = await seedComment();
  await updateStatus(ref, { state: 'queued' });
  await pickUpWork();
  await new Promise((r) => setTimeout(r, 20));
  const since = getQueue().comments.running()?.since ?? 0;
  const filmMs = PROBE.duration * 1000;

  expect(await checkForStalls(getQueue(), since + filmMs + STALL_GRACE_MS - 1000)).toBe(false);
  const logs: string[] = [];
  expect(
    await checkForStalls(getQueue(), since + filmMs + STALL_GRACE_MS + 1000, (m) => logs.push(m))
  ).toBe(true);
  const status = await readStatus(ref);
  expect(status).toMatchObject({ state: 'failed', steps: { transcribe: 'failed' } });
  expect(status?.error).toMatch(/Stalled/);
  expect(logs[0]).toMatch(/Stalled/);
  release();
  await getQueue().idle();
});

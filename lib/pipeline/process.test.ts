import { existsSync } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resetConfigForTests } from '@/lib/config';
import { audioDuration } from '@/lib/media/ops';
import { fx } from '@/lib/media/testutil';
import { versionDir } from '@/lib/storage/paths';
import type { CaptureEvent, Moment, Transcript } from '@/lib/types';
import eventsBasic from '@/test/fixtures/events-basic.json';
import { withTmpData } from '@/test/helpers/tmpData';
import { processComment, resumeStep } from './process';
import { readStatus, updateStatus } from './status';
import { type StepFn, steps } from './steps';
import { setTranscriberForTests } from './steps/transcribe';
import { asWebm, seedComment } from './testutil';

const events = eventsBasic as CaptureEvent[];
const original = { ...steps };
let cleanup: () => Promise<void>;
let speech: Buffer;

beforeAll(async () => {
  speech = await readFile(fx('speech-like.webm'));
});

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  process.env.TRANSCRIBER = 'fake';
  resetConfigForTests();
  // Rendering belongs to another module; here the render steps only record that they ran.
  steps.stills = vi.fn<StepFn>(async () => {});
  steps.clip = vi.fn<StepFn>(async () => {});
});

afterEach(async () => {
  Object.assign(steps, original);
  setTranscriberForTests(null);
  delete process.env.TRANSCRIBER;
  resetConfigForTests();
  await cleanup();
});

const json = async <T>(path: string) => JSON.parse(await readFile(path, 'utf8')) as T;

it('processes a seeded comment end to end with the fake transcriber', async () => {
  const { ref, dir } = await seedComment({ audio: speech, parts: 3, events });
  await processComment(ref, { includeClip: false });

  const s = await readStatus(ref);
  expect(s).toMatchObject({
    state: 'done',
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'done',
      moments: 'done',
      stills: 'done',
      clip: 'pending',
    },
    error: null,
    attempts: 1,
  });
  expect((await json<Moment[]>(join(dir, 'moments.json'))).length).toBeGreaterThan(0);

  // The chunks are joined in sequence order into the original recording.
  expect((await readFile(join(dir, 'audio.webm'))).equals(speech)).toBe(true);
  expect(await audioDuration(join(dir, 'audio16k.wav'))).toBeCloseTo(3, 1);
  // The event batches are merged and sorted by time.
  const merged = await json<CaptureEvent[]>(join(dir, 'events.json'));
  expect(merged).toHaveLength(events.length);
  expect(merged.map((e) => e.t)).toEqual([...events.map((e) => e.t)].sort((a, b) => a - b));
  expect((await json<Transcript>(join(dir, 'transcript.json'))).words).toHaveLength(15);

  expect(steps.stills).toHaveBeenCalledTimes(1);
  expect(steps.clip).not.toHaveBeenCalled();
});

it('renders the clip as a separate, later pass', async () => {
  const { ref } = await seedComment({ audio: speech, events });
  await processComment(ref, { includeClip: false });
  await processComment(ref, { fromStep: 'clip' });

  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    steps: { stills: 'done', clip: 'done' },
    attempts: 1,
  });
  expect(steps.stills).toHaveBeenCalledTimes(1);
  expect(steps.clip).toHaveBeenCalledTimes(1);
});

it('gives every step the comment context', async () => {
  const { ref, dir } = await seedComment({ audio: speech, events });
  await processComment(ref);

  expect(steps.clip).toHaveBeenCalledTimes(1);
  const ctx = vi.mocked(steps.stills).mock.calls[0][0];
  expect(ctx.ref).toEqual(ref);
  expect(ctx.dir).toBe(dir);
  expect(ctx.meta.commentId).toBe(ref.commentId);
  expect(ctx.probe).toMatchObject({ width: 640, height: 360, fps: 25 });
  expect(typeof ctx.log).toBe('function');
});

it('marks silent comments empty and skips the rest', async () => {
  const { ref, dir } = await seedComment({ audio: await asWebm(fx('silence.wav')), events });
  await processComment(ref);

  expect(await readStatus(ref)).toMatchObject({
    state: 'empty',
    steps: {
      audio: 'done',
      silence: 'done',
      transcribe: 'skipped',
      moments: 'skipped',
      stills: 'skipped',
      clip: 'skipped',
    },
    error: null,
  });
  expect(existsSync(join(dir, 'transcript.json'))).toBe(false);
  expect(existsSync(join(dir, 'moments.json'))).toBe(false);
  expect(steps.stills).not.toHaveBeenCalled();
});

it('a failed transcription fails the comment but the later steps still run', async () => {
  setTranscriberForTests({
    transcribe: async () => {
      throw new Error('Groq transcription failed (429): slow down');
    },
  });
  const { ref, dir } = await seedComment({ audio: speech, events });
  await processComment(ref, { includeClip: false });

  expect(await readStatus(ref)).toMatchObject({
    state: 'failed',
    steps: { audio: 'done', transcribe: 'failed', moments: 'done', stills: 'done' },
    error: 'Groq transcription failed (429): slow down',
  });
  // Without word timings there are still pointer moments.
  const moments = await json<Moment[]>(join(dir, 'moments.json'));
  expect(moments.length).toBeGreaterThan(0);
  expect(moments.some((m) => m.kinds.includes('word'))).toBe(false);
});

it('retrying from transcribe repairs a failed comment without redoing the audio', async () => {
  setTranscriberForTests({
    transcribe: async () => {
      throw new Error('down');
    },
  });
  const { ref, dir } = await seedComment({ audio: speech, events });
  await processComment(ref, { includeClip: false });
  const assembledAt = (await stat(join(dir, 'audio.webm'))).mtimeMs;

  setTranscriberForTests(null);
  await processComment(ref, { fromStep: 'transcribe', includeClip: false });

  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    steps: { transcribe: 'done', moments: 'done', stills: 'done' },
    error: null,
    attempts: 2,
  });
  expect((await stat(join(dir, 'audio.webm'))).mtimeMs).toBe(assembledAt);
  const moments = await json<Moment[]>(join(dir, 'moments.json'));
  expect(moments.some((m) => m.kinds.includes('word'))).toBe(true);
});

it('keeps the first error when several steps fail', async () => {
  steps.stills = vi.fn<StepFn>(async () => {
    throw new Error('sharp exploded');
  });
  steps.clip = vi.fn<StepFn>(async () => {
    throw new Error('ffmpeg exploded');
  });
  const { ref } = await seedComment({ audio: speech, events });
  await processComment(ref);

  expect(await readStatus(ref)).toMatchObject({
    state: 'failed',
    steps: { moments: 'done', stills: 'failed', clip: 'failed' },
    error: 'sharp exploded',
  });
});

it('stops when the audio cannot be assembled', async () => {
  const { ref } = await seedComment({ audio: Buffer.from('this is not audio'), events });
  await processComment(ref);

  const s = await readStatus(ref);
  expect(s).toMatchObject({
    state: 'failed',
    steps: { audio: 'failed', silence: 'skipped', transcribe: 'skipped', clip: 'skipped' },
  });
  expect(s?.error).toBeTruthy();
});

it('fails cleanly when a chunk is missing', async () => {
  const { ref, dir } = await seedComment({ audio: speech, events });
  await rm(join(dir, 'chunks', '1.bin'));
  await processComment(ref);

  expect(await readStatus(ref)).toMatchObject({
    state: 'failed',
    steps: { audio: 'failed' },
    error: expect.stringMatching(/chunk 1 is missing/i),
  });
});

it('general comments get audio and a transcript but no moments or renders', async () => {
  const { ref, dir } = await seedComment({
    audio: speech,
    events,
    meta: { kind: 'general', pausedAtVideoTime: null },
  });
  await processComment(ref);

  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    steps: { transcribe: 'done', moments: 'done', stills: 'skipped', clip: 'skipped' },
  });
  expect(await json<Moment[]>(join(dir, 'moments.json'))).toEqual([]);
  expect(steps.stills).not.toHaveBeenCalled();
  expect(steps.clip).not.toHaveBeenCalled();
});

it('names recordings from Safari audio.mp4', async () => {
  const { ref, dir } = await seedComment({
    audio: speech,
    events,
    meta: { audioMime: 'audio/mp4;codecs=mp4a.40.2' },
  });
  await processComment(ref, { includeClip: false });

  expect(existsSync(join(dir, 'audio.mp4'))).toBe(true);
  expect(existsSync(join(dir, 'audio.webm'))).toBe(false);
});

it('a step that needs the probe fails with a clear message when probe.json is missing', async () => {
  steps.stills = vi.fn<StepFn>(async (ctx) => {
    void ctx.probe.width;
  });
  const { ref, video } = await seedComment({ audio: speech, events });
  await rm(join(versionDir(video.videoId, 1), 'probe.json'));
  await processComment(ref, { includeClip: false });

  expect(await readStatus(ref)).toMatchObject({
    state: 'failed',
    steps: { moments: 'done', stills: 'failed' },
    error: expect.stringMatching(/probe\.json/),
  });
});

it('fails a comment that has no meta.json', async () => {
  const { ref, dir } = await seedComment({ audio: speech, events });
  await rm(join(dir, 'meta.json'));
  await processComment(ref);
  expect(await readStatus(ref)).toMatchObject({
    state: 'failed',
    error: expect.stringMatching(/meta\.json/),
  });
});

it('resumeStep picks the first step still pending', async () => {
  const { ref } = await seedComment();
  const fresh = await readStatus(ref);
  if (!fresh) throw new Error('no status');
  expect(resumeStep(fresh)).toBe('audio');
  const part = await updateStatus(ref, {
    steps: { audio: 'done', silence: 'done', transcribe: 'failed' },
  });
  expect(resumeStep(part)).toBe('moments');
  const all = await updateStatus(ref, { steps: { moments: 'done', stills: 'done' } });
  expect(resumeStep(all)).toBe('clip');
});

it('a clip pass leaves the state alone when the comment was re-queued while it rendered', async () => {
  const { ref } = await seedComment({ state: 'done' });
  await updateStatus(ref, {
    steps: { audio: 'done', silence: 'done', transcribe: 'done', moments: 'done', stills: 'done' },
  });
  // What a reprocess does while the clip is still rendering.
  steps.clip = vi.fn<StepFn>(async () => {
    await updateStatus(ref, {
      state: 'queued',
      steps: { transcribe: 'pending', moments: 'pending', stills: 'pending', clip: 'pending' },
    });
  });

  await processComment(ref, { fromStep: 'clip', includeClip: true });

  const s = await readStatus(ref);
  expect(s).toMatchObject({
    state: 'queued',
    steps: { transcribe: 'pending', moments: 'pending', stills: 'pending', clip: 'pending' },
  });
  // The re-queued job still starts where the reprocess asked it to.
  expect(s && resumeStep(s)).toBe('transcribe');
});

describe('a comment recorded with no microphone', () => {
  const seedSilent = () =>
    seedComment({ audio: Buffer.alloc(0), parts: 1, events, meta: { micLost: true } });

  it('keeps its pointing: moments and stills are made, the audio steps are skipped', async () => {
    const { ref, dir } = await seedSilent();
    await processComment(ref, { includeClip: false });

    expect(await readStatus(ref)).toMatchObject({
      state: 'done',
      steps: {
        audio: 'done',
        silence: 'skipped',
        transcribe: 'skipped',
        moments: 'done',
        stills: 'done',
        clip: 'skipped',
      },
      error: null,
    });
    expect(await json<CaptureEvent[]>(join(dir, 'events.json'))).toHaveLength(events.length);
    const moments = await json<Moment[]>(join(dir, 'moments.json'));
    expect(moments.some((m) => m.kinds.includes('click'))).toBe(true);
    expect(existsSync(join(dir, 'transcript.json'))).toBe(false);
    expect(steps.stills).toHaveBeenCalledTimes(1);
    expect(steps.clip).not.toHaveBeenCalled();
  });

  it('has no audio to work out its length from, so it uses the events', async () => {
    const { ref, dir } = await seedComment({
      audio: Buffer.alloc(0),
      parts: 1,
      events,
      meta: { micLost: true, durationMs: null },
    });
    await processComment(ref, { includeClip: false });
    expect((await readStatus(ref))?.state).toBe('done');
    expect((await json<Moment[]>(join(dir, 'moments.json'))).length).toBeGreaterThan(0);
  });

  it('can be reprocessed from transcribe without failing', async () => {
    const { ref } = await seedSilent();
    await processComment(ref, { includeClip: false });
    await processComment(ref, { fromStep: 'transcribe', includeClip: true });
    expect(await readStatus(ref)).toMatchObject({
      state: 'done',
      steps: { transcribe: 'skipped', moments: 'done', stills: 'done', clip: 'skipped' },
      error: null,
    });
    expect(steps.clip).not.toHaveBeenCalled();
  });
});

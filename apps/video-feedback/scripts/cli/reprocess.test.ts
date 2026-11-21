import { resetConfigForTests } from '@/lib/config';
import { readStatus, updateStatus } from '@/lib/pipeline/status';
import { steps } from '@/lib/pipeline/steps';
import { seedComment } from '@/lib/pipeline/testutil';
import { withTmpData } from '@/test/helpers/tmpData';
import { main, parseCli } from './reprocess';

const original = { ...steps };
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  process.env.TRANSCRIBER = 'fake';
  resetConfigForTests();
});

afterEach(async () => {
  Object.assign(steps, original);
  delete process.env.TRANSCRIBER;
  resetConfigForTests();
  await cleanup();
});

it('parses the options', () => {
  const id = '11111111-2222-4333-8444-555555555555';
  expect(
    parseCli(['launch-film-ab12', '--version', '2', '--comment', id, '--from-step', 'stills'])
  ).toEqual({
    videoId: 'launch-film-ab12',
    opts: { version: 2, commentId: id, fromStep: 'stills' },
  });
  expect(parseCli(['launch-film-ab12'])).toEqual({ videoId: 'launch-film-ab12', opts: {} });
});

it.each([
  [[]],
  [['a', 'b']],
  [['../etc']],
  [['launch-film-ab12', '--version', 'two']],
  [['launch-film-ab12', '--comment', 'nope']],
  [['launch-film-ab12', '--from-step', 'everything']],
  [['launch-film-ab12', '--unknown']],
])('rejects bad arguments %j with usage and exit code 2', async (argv) => {
  const lines: string[] = [];
  expect(await main(argv, (l) => lines.push(l))).toBe(2);
  expect(lines.join('\n')).toContain('Usage: yarn reprocess');
});

it('reports an unknown video', async () => {
  const lines: string[] = [];
  expect(await main(['no-such-video'], (l) => lines.push(l))).toBe(1);
  expect(lines[0]).toMatch(/No video/);
});

it('runs failed comments again, clip included, with progress lines', async () => {
  const ran: string[] = [];
  for (const name of ['transcribe', 'moments', 'stills', 'clip'] as const) {
    steps[name] = async (ctx) => {
      ran.push(name);
      ctx.log('ok');
    };
  }
  const { ref, video } = await seedComment();
  await updateStatus(ref, {
    state: 'failed',
    error: 'boom',
    attempts: 1,
    steps: { audio: 'done', silence: 'done', transcribe: 'failed', moments: 'done' },
  });

  const lines: string[] = [];
  expect(await main([video.videoId], (l) => lines.push(l))).toBe(0);
  expect(ran).toEqual(['transcribe', 'moments', 'stills', 'clip']);
  expect(await readStatus(ref)).toMatchObject({
    state: 'done',
    steps: { transcribe: 'done', clip: 'done' },
  });
  expect(lines[0]).toBe(`[1/1] ${ref.commentId}: from transcribe`);
  expect(lines).toContain(`  ${ref.commentId} stills: ok`);
  expect(lines).toContain(`[1/1] ${ref.commentId}: done`);
  expect(lines.at(-1)).toBe('Reprocessed 1 comments, 0 failed.');

  lines.length = 0;
  expect(await main([video.videoId], (l) => lines.push(l))).toBe(0);
  expect(lines).toEqual(['Nothing to reprocess.']);
});

it('exits 1 when a comment still fails', async () => {
  steps.transcribe = async () => {
    throw new Error('still down');
  };
  steps.moments = steps.stills = steps.clip = async () => {};
  const { ref, video } = await seedComment();
  await updateStatus(ref, { state: 'failed', steps: { audio: 'done', transcribe: 'failed' } });

  const lines: string[] = [];
  expect(await main([video.videoId], (l) => lines.push(l))).toBe(1);
  expect(lines).toContain(`[1/1] ${ref.commentId}: failed (still down)`);
});

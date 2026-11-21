import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resetConfigForTests } from '@/lib/config';
import { SEED, seedExport, seedRef, setSeedStatus, VIDEO_ID } from '@/test/fixtures/export-seed';
import { withTmpData } from '@/test/helpers/tmpData';
import { main, parseCli } from './export';

const NOW = new Date('2026-11-21T14:05:00.000Z');
let dir: string;
let out: string;
let cleanup: () => Promise<void>;

beforeEach(async () => {
  ({ dir, cleanup } = await withTmpData());
  out = join(dir, 'out');
  await mkdir(out);
  await seedExport();
});

afterEach(async () => {
  resetConfigForTests();
  await cleanup();
});

const run = async (argv: string[]) => {
  const lines: string[] = [];
  const code = await main(argv, (l) => lines.push(l), NOW);
  return { code, lines };
};

it('parses the options', () => {
  expect(parseCli([VIDEO_ID])).toEqual({
    videoId: VIDEO_ID,
    out: null,
    opts: { version: 'latest', clips: false, since: null, partial: false },
  });
  expect(
    parseCli([
      VIDEO_ID,
      '--version',
      'all',
      '--clips',
      '--partial',
      '--since',
      '2026-11-20T11:04:00Z',
      '--out',
      '/tmp/x',
    ])
  ).toEqual({
    videoId: VIDEO_ID,
    out: '/tmp/x',
    opts: { version: 'all', clips: true, since: '2026-11-20T11:04:00.000Z', partial: true },
  });
  expect(parseCli([VIDEO_ID, '--version', '2']).opts.version).toBe(2);
});

it.each([
  [[]],
  [['a', 'b']],
  [['../etc']],
  [[VIDEO_ID, '--version', 'two']],
  [[VIDEO_ID, '--since', 'yesterday']],
  [[VIDEO_ID, '--unknown']],
])('rejects bad arguments %j with usage and exit code 2', async (argv) => {
  const { code, lines } = await run(argv);
  expect(code).toBe(2);
  expect(lines.join('\n')).toContain('Usage: yarn export');
});

it('writes the zip into the --out directory and prints its path', async () => {
  const { code, lines } = await run([VIDEO_ID, '--out', out]);
  const path = join(out, `${VIDEO_ID}-v2-20261121-1405.zip`);
  expect(code).toBe(0);
  expect(lines).toEqual([path]);
  expect((await readFile(path)).subarray(0, 2).toString()).toBe('PK');
});

it('writes to a named .zip file, making its folder', async () => {
  const path = join(out, 'nested', 'feedback.zip');
  const { code, lines } = await run([VIDEO_ID, '--version', 'all', '--out', path]);
  expect(code).toBe(0);
  expect(lines).toEqual([path]);
  expect(existsSync(path)).toBe(true);
});

it('reports an unknown video or version', async () => {
  expect(await run(['no-such-video', '--out', out])).toMatchObject({ code: 1 });
  const { code, lines } = await run([VIDEO_ID, '--version', '9', '--out', out]);
  expect(code).toBe(1);
  expect(lines[0]).toMatch(/no version 9/);
});

it('stops while comments are processing unless --partial', async () => {
  await setSeedStatus(seedRef(SEED.dev, SEED.devScrolled), { state: 'queued' });
  const { code, lines } = await run([VIDEO_ID, '--out', out]);
  expect(code).toBe(1);
  expect(lines[0]).toMatch(/1 comment is still being processed/);
  expect(lines.join('\n')).not.toContain('—');
  expect((await run([VIDEO_ID, '--out', out, '--partial'])).code).toBe(0);
});
